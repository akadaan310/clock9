/** Certified reusable operations (Plicastratum-style fold/unfold) over ListOps stages.
 *
 * A macro is promoted only from programs that were independently VERIFIED, and only
 * when the same contiguous stage word occurs in at least `minWitnesses` distinct
 * verified programs. Its type is fixed (list[int] -> list[int]); unfolding is exact
 * substitution, so fold(unfold(p)) and unfold(fold(p)) are identities.
 */
import type { Pipeline, Stage } from './ast.js';
import { canonical, fnv1a, interpret, validate } from './ast.js';

export const MACRO_LIBRARY_VERSION = 'listops-macros/1.0';
export type Macro = { glyph: string; body: Stage[]; type: 'list[int] -> list[int]'; witnesses: string[]; certificate: string };
export type FoldedStage = Stage | { op: 'macro'; glyph: string };
export type Folded = { stages: FoldedStage[]; terminal: Pipeline['terminal'] };

const certify = (body: Stage[], witnesses: string[]) => fnv1a(canonical({ v: MACRO_LIBRARY_VERSION, body, witnesses: [...witnesses].sort() }));

export function mine(verified: { id: string; program: Pipeline }[], minLen = 2, maxLen = 3, minWitnesses = 2): Macro[] {
  const seen = new Map<string, { body: Stage[]; ids: Set<string> }>();
  for (const { id, program } of verified) {
    const st = program.stages;
    for (let n = minLen; n <= maxLen; n++) for (let i = 0; i + n <= st.length; i++) {
      const body = st.slice(i, i + n);
      const key = canonical(body);
      const e = seen.get(key) ?? { body, ids: new Set<string>() };
      e.ids.add(id); seen.set(key, e);
    }
  }
  return [...seen.values()]
    .filter(e => e.ids.size >= minWitnesses)
    .sort((a, b) => b.ids.size - a.ids.size || b.body.length - a.body.length || canonical(a.body).localeCompare(canonical(b.body)))
    .map((e, i) => {
      const witnesses = [...e.ids].sort();
      return { glyph: `M${i + 1}`, body: e.body, type: 'list[int] -> list[int]' as const, witnesses, certificate: certify(e.body, witnesses) };
    });
}

export function checkMacro(m: Macro): void {
  if (certify(m.body, m.witnesses) !== m.certificate) throw Error(`Invalid macro certificate: ${m.glyph}`);
  if (m.witnesses.length < 2) throw Error(`Macro lacks independent witnesses: ${m.glyph}`);
  if (validate({ stages: m.body, terminal: 'list' }).length) throw Error(`Macro body inadmissible: ${m.glyph}`);
}

/** Greedy longest-first fold of macro bodies into glyphs. */
export function fold(p: Pipeline, lib: Macro[]): Folded {
  lib.forEach(checkMacro);
  const byLen = [...lib].sort((a, b) => b.body.length - a.body.length);
  const out: FoldedStage[] = [];
  for (let i = 0; i < p.stages.length;) {
    const m = byLen.find(m => canonical(p.stages.slice(i, i + m.body.length)) === canonical(m.body));
    if (m) { out.push({ op: 'macro', glyph: m.glyph }); i += m.body.length; }
    else out.push(p.stages[i++]!);
  }
  return { stages: out, terminal: p.terminal };
}
export function unfold(f: Folded, lib: Macro[]): Pipeline {
  const stages: Stage[] = [];
  for (const s of f.stages) {
    if (s.op === 'macro') {
      const m = lib.find(x => x.glyph === s.glyph);
      if (!m) throw Error(`Unknown macro ${s.glyph}`);
      checkMacro(m);
      stages.push(...m.body.map(x => structuredClone(x)));
    } else stages.push(s);
  }
  return { stages, terminal: f.terminal };
}
/** Semantic witness that folding preserved behaviour on given inputs (exact BigInt compare). */
export function foldWitness(p: Pipeline, lib: Macro[], inputs: number[][]): boolean {
  const q = unfold(fold(p, lib), lib);
  return canonical(q) === canonical(p) && inputs.every(xs => canonical(String(interpret(p, xs))) === canonical(String(interpret(q, xs))));
}
