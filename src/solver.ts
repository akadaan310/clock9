/** CLOCK9/0.2 hybrid solver for `solve(xs: list[int])` code tasks. Browser-safe:
 * models and the independent executor are injected; with neither, it is a pure
 * symbolic grammar compiler that refuses what it cannot admit.
 */
import { Clock, type Beat, type Budget, type Source } from './clock.js';
import { NGram } from './ngram.js';
import {
  GRAMMAR_VERSION, canonical, compilePython, fnv1a, fromDsl, gbnf, interpret, sameValue,
  signatureType, toDsl, typecheck, type Pipeline, type RetType,
} from './listops/ast.js';
import { PARSER_VERSION, candidates, normalize } from './listops/parse.js';
import { MACRO_LIBRARY_VERSION, mine, type Macro } from './listops/macros.js';
import type { ModelAdapter, Completion } from './neural/adapter.js';

export type Example = { input: number[]; output: unknown };
export type Task = { id: string; prompt: string; signature: string; visible: Example[] };
export type ExecResult = { pass: boolean; passed: number; total: number; error?: string; ms: number };
export interface Executor { id: string; run(code: string, tests: Example[]): Promise<ExecResult> }

export type ResolvedBy = 'grammar' | 'cache' | 'neural-dsl' | 'neural-python' | 'fallback-python';
export type SolveResult = {
  taskId: string; status: 'solved' | 'refused';
  resolvedBy: ResolvedBy | null; code: string | null; dsl: string | null; refusal: string | null;
  witness: {
    grammarVersion: string; parserVersion: string; ngramCorpusHash: string; macroLibrary: string;
    interpreterVisible: boolean | null; executor: string | null; executorVisible: ExecResult | null;
    candidatesTried: number; candidatesPassingVisible: number;
  };
  beats: Beat[];
  cost: { modelCalls: number; promptTokens: number; genTokens: number; modelMs: number; wallMs: number; calls: (Completion & { role: string })[] };
};

export type SolverOptions = {
  grammar: boolean;              // B0/B4: symbolic request grammar
  cache: boolean;                // B4+: verified-program cache keyed by request
  dslModel?: ModelAdapter;       // grammar-constrained neural proposal (GBNF over ListOps)
  pythonModel?: ModelAdapter;    // free Python proposal
  fallbackModel?: ModelAdapter;  // larger model, only if everything above failed
  executor?: Executor;           // independent check of generated source (sandboxed Python)
  train: { prompt: string; dsl: string }[]; // ONLY the train split
  budget?: Budget; seed?: number; fewShot?: number;
};

const pyRepr = (v: unknown): string =>
  v === null ? 'None' : v === true ? 'True' : v === false ? 'False'
  : Array.isArray(v) ? `[${v.map(pyRepr).join(', ')}]` : String(v);
export const exampleLines = (t: Task) => t.visible.map(e => `solve(${pyRepr(e.input)}) == ${pyRepr(e.output)}`).join('\n');

export function pythonUserPrompt(t: Task): string {
  return `${t.prompt}\n\nExamples:\n${exampleLines(t)}\n\nWrite the Python function \`${t.signature}\`. ` +
    'Reply with a single ```python code block containing only the function.';
}
export const DSL_SPEC = [
  'A ListOps program is a sequence of stages separated by " | " and ending in a terminal.',
  'Stages: filter even|odd|pos|neg|nonzero; filter gt|lt|ge|le|eq|ne K; filter div K; map square|neg|abs; map add|sub|mul K; map mod|floordiv K; sort asc|desc; take K; drop K; reverse; distinct.',
  'Terminals: list, sum, product, count, max, min, first, last (max/min/first/last return None for an empty list).',
].join('\n');
export function dslUserPrompt(t: Task, shots: { prompt: string; dsl: string }[]): string {
  const ex = shots.map(s => `Request: ${s.prompt}\nProgram: ${s.dsl}`).join('\n\n');
  return `${DSL_SPEC}\n\n${ex}\n\nRequest: ${t.prompt}\nExamples:\n${exampleLines(t)}\nProgram:`;
}
/** Extract the first fenced python block (or the whole reply if unfenced). */
export function extractCode(reply: string): string {
  const m = /```(?:python|py)?\s*\n([\s\S]*?)```/.exec(reply);
  return (m ? m[1]! : reply).trim() + '\n';
}

const tokens = (s: string) => {
  const w = normalize(s).split(/[^a-z0-9-]+/).filter(Boolean);
  return new Set([...w, ...w.slice(1).map((x, i) => `${w[i]}_${x}`)]);
};
/** n-gram (uni+bigram) Jaccard retrieval over the train split. */
export function retrieve(train: { prompt: string; dsl: string }[], query: string, k: number) {
  const q = tokens(query);
  return train.map(e => {
    const s = tokens(e.prompt);
    let inter = 0; for (const x of q) if (s.has(x)) inter++;
    return { e, sim: inter / (q.size + s.size - inter || 1) };
  }).sort((a, b) => b.sim - a.sim || a.e.prompt.localeCompare(b.e.prompt)).slice(0, k);
}
export const stageTokens = (p: Pipeline) => [
  ...p.stages.map(s => s.op === 'filter' ? `filter:${s.pred.p}` : s.op === 'map' ? `map:${s.fn.f}` : s.op === 'sort' ? `sort:${s.desc ? 'desc' : 'asc'}` : s.op),
  `=>${p.terminal}`,
];

export class HybridSolver {
  readonly ngram = new NGram(3);
  readonly cache = new Map<string, { code: string; dsl: string; taskId: string }>();
  readonly verified: { id: string; program: Pipeline }[] = [];
  macros: Macro[] = [];
  constructor(readonly opt: SolverOptions) {
    for (const e of opt.train) this.ngram.observe(stageTokens(fromDsl(e.dsl)));
  }
  private key(t: Task) { return fnv1a(canonical({ p: normalize(t.prompt), s: t.signature, v: t.visible })); }
  private visibleOk(p: Pipeline, t: Task) { return t.visible.every(e => sameValue(interpret(p, e.input), e.output)); }

  async solve(task: Task, signal?: AbortSignal): Promise<SolveResult> {
    const clock = new Clock(this.opt.budget, signal);
    const want: RetType | null = signatureType(task.signature);
    const calls: (Completion & { role: string })[] = [];
    let tried = 0, passing = 0, interpOk: boolean | null = null, execRes: ExecResult | null = null;
    const done = (status: SolveResult['status'], resolvedBy: ResolvedBy | null, code: string | null, dsl: string | null, refusal: string | null): SolveResult => ({
      taskId: task.id, status, resolvedBy, code, dsl, refusal,
      witness: {
        grammarVersion: GRAMMAR_VERSION, parserVersion: PARSER_VERSION, ngramCorpusHash: this.ngram.corpusHash(),
        macroLibrary: `${MACRO_LIBRARY_VERSION}#${this.macros.length}`, interpreterVisible: interpOk,
        executor: this.opt.executor?.id ?? null, executorVisible: execRes, candidatesTried: tried, candidatesPassingVisible: passing,
      },
      beats: clock.trace,
      cost: {
        modelCalls: calls.length, promptTokens: calls.reduce((a, c) => a + c.promptTokens, 0),
        genTokens: calls.reduce((a, c) => a + c.genTokens, 0), modelMs: calls.reduce((a, c) => a + c.ms, 0),
        wallMs: clock.elapsed(), calls,
      },
    });
    /** Independent verification of SOURCE (not of the AST) on the visible examples. */
    const verifySource = async (code: string, source: Source): Promise<boolean> => {
      if (!this.opt.executor) { clock.record('verify', 'tool', 'no independent executor available (browser mode): interpreter witness only'); return true; }
      execRes = await this.opt.executor.run(code, task.visible);
      clock.record('verify', 'tool', `${this.opt.executor.id}: ${execRes.passed}/${execRes.total} visible${execRes.error ? ' error=' + execRes.error.slice(0, 80) : ''} (source from ${source})`);
      return execRes.pass;
    };
    const promote = (p: Pipeline, code: string) => {
      if (this.opt.cache) this.cache.set(this.key(task), { code, dsl: toDsl(p), taskId: task.id });
      this.verified.push({ id: task.id, program: p });
      this.ngram.observe(stageTokens(p));
      this.macros = mine(this.verified);
      clock.record('promote', 'macro', `cached=${this.opt.cache}; verified programs=${this.verified.length}; certified macros=${this.macros.length}`);
    };
    /** admit -> compile -> verify for one typed program; returns code or null. */
    const admitCompileVerify = async (p: Pipeline, source: Source): Promise<string | null> => {
      const diag = typecheck(p, want);
      if (diag.length) { clock.record('admit', 'grammar', `rejected ${toDsl(p)}: ${diag.join(',')}`); return null; }
      interpOk = this.visibleOk(p, task);
      clock.record('admit', 'tool', `interpreter on visible examples: ${interpOk ? 'PASS' : 'FAIL'} for ${toDsl(p)}`);
      if (!interpOk) return null;
      const code = compilePython(p);
      clock.record('compile', 'grammar', `${GRAMMAR_VERSION} -> python ${code.length} bytes`);
      return (await verifySource(code, source)) ? code : null;
    };

    clock.record('context', 'grammar', `task=${task.id}; declared type=${want ?? 'unknown'}; visible examples=${task.visible.length}`);
    // ---- retrieve: verified cache
    if (this.opt.cache) {
      const hit = this.cache.get(this.key(task));
      clock.record('retrieve', 'cache', hit ? `hit from ${hit.taskId}` : 'miss');
      if (hit) {
        const p = fromDsl(hit.dsl);
        interpOk = this.visibleOk(p, task);
        if (interpOk && await verifySource(hit.code, 'cache')) return done('solved', 'cache', hit.code, hit.dsl, null);
      }
    }
    // ---- draft (grammar): admissible readings ranked by textual order + n-gram preference
    if (this.opt.grammar) {
      const cs = candidates(task.prompt, want);
      clock.record('draft', 'grammar', `${cs.extraction.fragments.map(f => f.text).join(' / ') || '(none)'} -> ${cs.candidates.length} readings${cs.refusal ? ' refusal=' + cs.refusal : ''}`);
      // Textual order is primary (an explicit "then" is a requirement); the n-gram only breaks ties.
      const ranked = cs.candidates.map(c => ({ ...c, score: this.ngram.logScore(stageTokens(c.program)) }))
        .sort((a, b) => a.displacement - b.displacement || b.score - a.score);
      if (ranked.length) clock.record('draft', 'ngram', `ranked ${ranked.length}; top=${toDsl(ranked[0]!.program)} (score ${ranked[0]!.score.toFixed(2)})`);
      const pass = ranked.filter(c => this.visibleOk(c.program, task));
      tried += ranked.length; passing += pass.length;
      if (pass.length) {
        const code = await admitCompileVerify(pass[0]!.program, 'grammar');
        if (code) { promote(pass[0]!.program, code); return done('solved', 'grammar', code, toDsl(pass[0]!.program), null); }
      } else if (ranked.length) clock.record('admit', 'tool', `0/${ranked.length} readings consistent with visible examples`);
    }
    // ---- draft (neural, grammar-constrained)
    if (this.opt.dslModel) {
      const shots = retrieve(this.opt.train, task.prompt, this.opt.fewShot ?? 6);
      clock.record('retrieve', 'ngram', `few-shot ${shots.map(s => s.sim.toFixed(2)).join(',')}`);
      clock.record('escalate', 'neural', `${this.opt.dslModel.id} under GBNF(${GRAMMAR_VERSION}, type=${want})`);
      const c = await this.opt.dslModel.complete({ user: dslUserPrompt(task, shots.map(s => s.e)), grammar: gbnf(want), maxTokens: 64, seed: this.opt.seed ?? 9 });
      calls.push({ ...c, role: 'dsl' });
      clock.record('draft', 'neural', `"${c.text.trim().slice(0, 100)}" (${c.genTokens} tok, ${c.ms.toFixed(0)} ms)`);
      let p: Pipeline | null = null;
      try { p = fromDsl(c.text); } catch (e) { clock.record('admit', 'grammar', `unparseable: ${String(e).slice(0, 80)}`); }
      if (p) {
        tried++;
        const code = await admitCompileVerify(p, 'neural');
        if (code) { passing++; promote(p, code); return done('solved', 'neural-dsl', code, toDsl(p), null); }
      }
    }
    // ---- draft (neural, free Python), then larger fallback
    for (const [model, role, by] of [[this.opt.pythonModel, 'python', 'neural-python'], [this.opt.fallbackModel, 'fallback', 'fallback-python']] as const) {
      if (!model) continue;
      clock.record('escalate', role === 'fallback' ? 'fallback' : 'neural', `${model.id} free Python`);
      const c = await model.complete({ user: pythonUserPrompt(task), maxTokens: 384, seed: this.opt.seed ?? 9 });
      calls.push({ ...c, role });
      const code = extractCode(c.text);
      clock.record('draft', 'neural', `${code.split('\n').length} lines python (${c.genTokens} tok, ${c.ms.toFixed(0)} ms)`);
      if (await verifySource(code, 'neural')) return done('solved', by, code, null, null);
    }
    clock.record('refuse', 'grammar', 'unresolved: no admitted program passed the visible examples');
    return done('refused', null, null, null, 'unresolved');
  }
}
