/** S5: end-to-end code correctness and cost, arms B0..B6 on identical tasks/host.
 *
 * ListOps arms (tasks: id, para, blind, oog):
 *   B0      symbolic grammar compiler only (no model); refuses what it cannot admit
 *   B4      B0 + verified-program cache, run as a stream where every task recurs once
 *   B1-0.5  Qwen2.5-Coder-0.5B Q4_K_M alone, single greedy shot (free Python)
 *   B1-1.5  Qwen2.5-Coder-1.5B Q4_K_M alone, single greedy shot
 *   B3      1.5B target + 0.5B draft (draft-simple, greedy => same text as B1-1.5)
 *   G-0.5   0.5B under GBNF(ListOps) only (grammar-constrained decoding, no parser)
 *   C1      0.5B Python -> visible-example check -> 1.5B fallback (no grammar; ablation)
 *   B5      grammar -> 0.5B GBNF DSL -> 0.5B Python, each gated by visible examples
 *   B6      B5 -> 1.5B Python fallback
 *   B2-0.5/B2-1.5  model alone with llama.cpp ngram-mod speculation;  B6n  B6 on ngram-mod servers
 * HumanEval arms: B1-0.5, B1-1.5, B2-1.5, B3, C1, C1n (C1 on ngram-mod servers) (visible = docstring examples). B0/B4/B5's
 * ListOps grammar has no HumanEval coverage by construction (reported, not run).
 *
 * Hidden tests are used ONLY for scoring, after the arm has produced its answer.
 * Usage: node dist/harness/eval.js --suite listops|humaneval --arms B0,B5 [--limit N]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { LlamaServer, MODELS } from './llama.js';
import { PythonSandbox } from './executor.js';
import { loadHumanEval, loadListOps, trainPairs, ROOT, type ListOpsTask, type HumanEvalTask } from './tasks.js';
import { heUser, heProgram, heVisibleProgram } from './humaneval.js';
import { HybridSolver, extractCode, pythonUserPrompt, type SolveResult } from '../src/solver.js';
import type { CompletionRequest, ModelAdapter } from '../src/neural/adapter.js';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const suite = arg('--suite') ?? 'listops';
const arms = (arg('--arms') ?? 'B0,B4,B1-0.5,B1-1.5,B3,G-0.5,C1,B5,B6').split(',');
const limit = Number(arg('--limit') ?? 1e9);
const tag = arg('--tag') ?? '';
const M05 = `${MODELS}/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf`;
const M15 = `${MODELS}/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`;
const sandbox = new PythonSandbox();

// ------------------------------------------------------------ servers (lazy, measured)
const NGRAM = ['--spec-type', 'ngram-mod', '--spec-ngram-mod-n-match', '8', '--spec-ngram-mod-n-min', '4', '--spec-ngram-mod-n-max', '16'];
const SERVER_CFG: Record<string, { model: string; extra: string[] }> = {
  'q0.5': { model: M05, extra: [] },
  'q1.5': { model: M15, extra: [] },
  'q1.5+d0.5': { model: M15, extra: ['-md', M05, '--spec-type', 'draft-simple', '--spec-draft-n-max', '3'] },
  // best n-gram speculation config from S4 (results/s4/summary.json)
  'q0.5+ng': { model: M05, extra: NGRAM },
  'q1.5+ng': { model: M15, extra: NGRAM },
};
const servers = new Map<string, LlamaServer>();
const loads: Record<string, number> = {};
let nextPort = 8200;
async function server(name: string): Promise<LlamaServer> {
  let s = servers.get(name);
  if (!s) {
    const c = SERVER_CFG[name]!;
    s = new LlamaServer({ name, model: c.model, port: nextPort++, extra: c.extra });
    loads[name] = await s.start();
    servers.set(name, s);
  }
  return s;
}
/** Wraps a server so per-task CPU seconds of the model process are attributed. */
class Metered implements ModelAdapter {
  cpu = 0;
  constructor(readonly s: LlamaServer) {}
  get id() { return this.s.id; }
  async complete(req: CompletionRequest) {
    const c0 = this.s.stats().cpuSec;
    const r = await this.s.complete(req);
    this.cpu += this.s.stats().cpuSec - c0;
    return r;
  }
}

type Row = {
  arm: string; suite: string; id: string; split: string; status: 'solved' | 'refused';
  resolvedBy: string | null; hiddenPass: boolean; hiddenDetail: string; wallMs: number; modelMs: number;
  modelCalls: number; promptTokens: number; genTokens: number; modelCpuSec: number; pass?: number;
  beats?: SolveResult['beats']; code: string | null; dsl?: string | null; witness?: SolveResult['witness'];
};

async function scoreListOps(t: ListOpsTask, code: string | null) {
  if (!code) return { pass: false, detail: 'no answer' };
  const r = await sandbox.run(code, t.hidden);
  return { pass: r.pass, detail: `${r.passed}/${r.total}${r.error ? ' ' + r.error : ''}` };
}

// ------------------------------------------------------------ runners
async function runListOps(): Promise<Row[]> {
  const all = [...loadListOps(), ...loadListOps('listops_blind.jsonl')];
  const train = trainPairs(all);
  const evalTasks = all.filter(t => t.split !== 'train').slice(0, limit);
  const rows: Row[] = [];
  for (const arm of arms) {
    const t0 = performance.now();
    const m = async (n: string) => new Metered(await server(n));
    let solver: HybridSolver | null = null;
    let direct: Metered | null = null;
    if (arm === 'B0') solver = new HybridSolver({ grammar: true, cache: false, executor: sandbox, train });
    else if (arm === 'B4') solver = new HybridSolver({ grammar: true, cache: true, executor: sandbox, train });
    else if (arm === 'G-0.5') solver = new HybridSolver({ grammar: false, cache: false, dslModel: await m('q0.5'), executor: sandbox, train });
    else if (arm === 'C1') solver = new HybridSolver({ grammar: false, cache: false, pythonModel: await m('q0.5'), fallbackModel: await m('q1.5'), executor: sandbox, train });
    else if (arm === 'B5') { const a = await m('q0.5'); solver = new HybridSolver({ grammar: true, cache: false, dslModel: a, pythonModel: a, executor: sandbox, train }); }
    else if (arm === 'B6') { const a = await m('q0.5'); solver = new HybridSolver({ grammar: true, cache: false, dslModel: a, pythonModel: a, fallbackModel: await m('q1.5'), executor: sandbox, train }); }
    else if (arm === 'B6n') { const a = await m('q0.5+ng'); solver = new HybridSolver({ grammar: true, cache: false, dslModel: a, pythonModel: a, fallbackModel: await m('q1.5+ng'), executor: sandbox, train }); }
    else if (arm === 'B2-0.5') direct = await m('q0.5+ng');
    else if (arm === 'B2-1.5') direct = await m('q1.5+ng');
    else if (arm === 'B1-0.5') direct = await m('q0.5');
    else if (arm === 'B1-1.5') direct = await m('q1.5');
    else if (arm === 'B3') direct = await m('q1.5+d0.5');
    else throw Error(`unknown arm ${arm}`);
    const stream = arm === 'B4' ? [...evalTasks.map(t => ({ t, pass: 1 })), ...evalTasks.map(t => ({ t, pass: 2 }))] : evalTasks.map(t => ({ t, pass: 1 }));
    for (const { t, pass } of stream) {
      const cpu0 = [...servers.values()].reduce((a, s) => a + s.stats().cpuSec, 0);
      const w0 = performance.now();
      let row: Row;
      if (solver) {
        const r = await solver.solve(t);
        const sc = await scoreListOps(t, r.code);
        row = { arm, suite, id: t.id, split: t.split, status: r.status, resolvedBy: r.resolvedBy, hiddenPass: sc.pass, hiddenDetail: sc.detail, wallMs: r.cost.wallMs, modelMs: r.cost.modelMs, modelCalls: r.cost.modelCalls, promptTokens: r.cost.promptTokens, genTokens: r.cost.genTokens, modelCpuSec: 0, pass, beats: r.beats, code: r.code, dsl: r.dsl, witness: r.witness };
      } else {
        const c = await direct!.complete({ user: pythonUserPrompt(t), maxTokens: 384, seed: 9 });
        const code = extractCode(c.text);
        const wallMs = performance.now() - w0; // answer produced; scoring excluded
        const sc = await scoreListOps(t, code);
        row = { arm, suite, id: t.id, split: t.split, status: 'solved', resolvedBy: 'neural-python', hiddenPass: sc.pass, hiddenDetail: sc.detail, wallMs, modelMs: c.ms, modelCalls: 1, promptTokens: c.promptTokens, genTokens: c.genTokens, modelCpuSec: 0, code };
      }
      row.modelCpuSec = +([...servers.values()].reduce((a, s) => a + s.stats().cpuSec, 0) - cpu0).toFixed(2);
      rows.push(row);
    }
    console.log(JSON.stringify(summarize(rows.filter(r => r.arm === arm)), null, 0), `(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }
  return rows;
}

async function runHumanEval(): Promise<Row[]> {
  const tasks = loadHumanEval().slice(0, limit);
  const rows: Row[] = [];
  for (const arm of arms) {
    const t0 = performance.now();
    const chain: string[] = arm === 'B1-0.5' ? ['q0.5'] : arm === 'B1-1.5' ? ['q1.5'] : arm === 'B3' ? ['q1.5+d0.5'] : arm === 'C1' ? ['q0.5', 'q1.5'] : arm === 'B2-1.5' ? ['q1.5+ng'] : arm === 'C1n' ? ['q0.5+ng', 'q1.5+ng'] : [];
    if (!chain.length) { console.log(`skip ${arm}: no HumanEval coverage`); continue; }
    const ms = await Promise.all(chain.map(async n => new Metered(await server(n))));
    for (const t of tasks) {
      const cpu0 = [...servers.values()].reduce((a, s) => a + s.stats().cpuSec, 0);
      const w0 = performance.now();
      let code = '', modelMs = 0, pt = 0, gt = 0, calls = 0, by = '';
      for (let i = 0; i < ms.length; i++) {
        const c = await ms[i]!.complete({ user: heUser(t), maxTokens: 512, seed: 9 });
        calls++; modelMs += c.ms; pt += c.promptTokens; gt += c.genTokens;
        code = extractCode(c.text); by = i ? 'fallback-python' : 'neural-python';
        if (i === ms.length - 1) break;
        const vp = heVisibleProgram(t, code);
        const v = vp ? await sandbox.runProgram(vp) : null;
        if (!v || v.pass || v.error === 'NOEVIDENCE') break; // accept (verified, or no visible evidence)
      }
      const wallMs = performance.now() - w0; // answer produced; scoring excluded
      const r = await sandbox.runProgram(`${heProgram(t, code)}\n\n${t.test}\n\ncheck(${t.entry_point})\n`);
      rows.push({ arm, suite, id: t.task_id, split: 'humaneval', status: 'solved', resolvedBy: by, hiddenPass: r.pass, hiddenDetail: r.error ?? 'ok', wallMs, modelMs, modelCalls: calls, promptTokens: pt, genTokens: gt, modelCpuSec: +([...servers.values()].reduce((a, s) => a + s.stats().cpuSec, 0) - cpu0).toFixed(2), code });
    }
    console.log(JSON.stringify(summarize(rows.filter(r => r.arm === arm)), null, 0), `(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }
  return rows;
}

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
export function summarize(rows: Row[]) {
  const by = (f: (r: Row) => string) => { const m: Record<string, number> = {}; for (const r of rows) m[f(r)] = (m[f(r)] ?? 0) + 1; return m; };
  const splits = [...new Set(rows.map(r => r.split))];
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    arm: rows[0]?.arm, n: rows.length,
    passRate: +(rows.filter(r => r.hiddenPass).length / rows.length).toFixed(3),
    perSplit: Object.fromEntries(splits.map(s => { const R = rows.filter(r => r.split === s); return [s, `${R.filter(r => r.hiddenPass).length}/${R.length}`]; })),
    refused: rows.filter(r => r.status === 'refused').length,
    falseAccept: rows.filter(r => r.status === 'solved' && !r.hiddenPass).length,
    resolvedBy: by(r => r.resolvedBy ?? 'refused'),
    wallMs: { mean: +(sum(r => r.wallMs) / rows.length).toFixed(1), p50: +q(rows.map(r => r.wallMs), 0.5).toFixed(1), p95: +q(rows.map(r => r.wallMs), 0.95).toFixed(1), total: +sum(r => r.wallMs).toFixed(0) },
    modelCalls: sum(r => r.modelCalls), genTokens: sum(r => r.genTokens), promptTokens: sum(r => r.promptTokens), modelCpuSec: +sum(r => r.modelCpuSec).toFixed(1),
  };
}

const rows = suite === 'humaneval' ? await runHumanEval() : await runListOps();
const mem = Object.fromEntries([...servers.entries()].map(([k, s]) => [k, { loadMs: +loads[k]!.toFixed(0), peakRssMiB: +s.stats().hwmMiB.toFixed(0) }]));
for (const s of servers.values()) await s.stop();
const outDir = path.join(ROOT, 'results', 's5');
mkdirSync(outDir, { recursive: true });
const name = `${suite}${tag ? '-' + tag : ''}`;
const armsSummary = arms.map(a => rows.filter(r => r.arm === a)).filter(r => r.length).map(R => summarize(R));
const extra = suite === 'listops' && rows.some(r => r.arm === 'B4') ? { B4_byStreamPass: [1, 2].map(p => summarize(rows.filter(r => r.arm === 'B4' && r.pass === p))) } : {};
writeFileSync(path.join(outDir, `${name}-rows.json`), JSON.stringify(rows, null, 1));
writeFileSync(path.join(outDir, `${name}-summary.json`), JSON.stringify({ suite, arms: armsSummary, ...extra, servers: mem, nodePeakRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(0) }, null, 1));
console.log(JSON.stringify({ servers: mem, ...extra }, null, 0));
