/** Derive tables from results/s5/*-rows.json (no new measurements; pure arithmetic on rows).
 * Output: results/s5/analysis.json and results/s5/analysis.md */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadListOps } from './tasks.js';

type Row = { arm: string; id: string; split: string; status: string; resolvedBy: string | null; hiddenPass: boolean; wallMs: number; modelCpuSec: number; genTokens: number; promptTokens: number; modelCalls: number; pass?: number; beats?: { kind: string; source: string; t_ms: number }[] };
const dir = path.join(ROOT, 'results', 's5');
const load = (f: string) => (existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Row[] : []);
const lo = load('listops-rows.json').filter(r => r.arm !== 'B4' || r.pass === 1);
const lo2 = load('listops-rows.json').filter(r => r.arm === 'B4' && r.pass === 2);
const he = load('humaneval-rows.json');
const blind = loadListOps('listops_blind.jsonl');
const src = new Map(loadListOps().map(t => [t.id, t.prompt]));
const verbatim = new Set(blind.filter(t => src.get((t as unknown as { source_id: string }).source_id) === t.prompt).map(t => t.id));

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
function stats(R: Row[]) {
  const pass = R.filter(r => r.hiddenPass).length;
  const wall = R.reduce((a, r) => a + r.wallMs, 0), cpu = R.reduce((a, r) => a + r.modelCpuSec, 0);
  const solved = R.filter(r => r.status === 'solved');
  return {
    n: R.length, pass, passRate: +(pass / R.length).toFixed(3),
    refused: R.filter(r => r.status === 'refused').length,
    falseAccept: solved.filter(r => !r.hiddenPass).length,
    precision: solved.length ? +(solved.filter(r => r.hiddenPass).length / solved.length).toFixed(3) : null,
    meanWallMs: +(wall / R.length).toFixed(0), p50WallMs: +q(R.map(r => r.wallMs), 0.5).toFixed(0), p95WallMs: +q(R.map(r => r.wallMs), 0.95).toFixed(0),
    modelCpuSec: +cpu.toFixed(1), modelCpuSecPerCorrect: pass ? +(cpu / pass).toFixed(2) : null, wallSecPerCorrect: pass ? +(wall / 1000 / pass).toFixed(2) : null,
    genTokens: R.reduce((a, r) => a + r.genTokens, 0), modelCalls: R.reduce((a, r) => a + r.modelCalls, 0),
  };
}
const arms = (rows: Row[]) => [...new Set(rows.map(r => r.arm))];
const listopsTable = arms(lo).map(a => {
  const R = lo.filter(r => r.arm === a);
  const sp = (f: (r: Row) => boolean) => { const S = R.filter(f); return `${S.filter(r => r.hiddenPass).length}/${S.length}`; };
  return {
    arm: a, ...stats(R), id: sp(r => r.split === 'id'), para: sp(r => r.split === 'para'),
    blindTrue: sp(r => r.split === 'blind' && !verbatim.has(r.id)), blindVerbatim: sp(r => r.split === 'blind' && verbatim.has(r.id)), oog: sp(r => r.split === 'oog'),
    inGrammar: stats(R.filter(r => r.split !== 'oog')), outOfGrammar: stats(R.filter(r => r.split === 'oog')),
  };
});
const heTable = arms(he).map(a => ({ arm: a, ...stats(he.filter(r => r.arm === a)) }));

// Research question: cost of the hybrid (B6) vs model-alone (B1-1.5) as the in-grammar fraction f varies.
// Derived by reweighting MEASURED per-task means of the two task strata; not a new measurement.
const strat = (a: string, inG: boolean) => stats(lo.filter(r => r.arm === a && (r.split !== 'oog') === inG));
const mix = (a: string, f: number) => {
  const i = strat(a, true), o = strat(a, false);
  return { f, passRate: +(f * i.passRate + (1 - f) * o.passRate).toFixed(3), meanWallMs: +(f * i.meanWallMs + (1 - f) * o.meanWallMs).toFixed(0), modelCpuSecPerTask: +(f * i.modelCpuSec / i.n + (1 - f) * o.modelCpuSec / o.n).toFixed(2) };
};
const curve = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(f => ({ f, B6: mix('B6', f), B5: mix('B5', f), 'B1-1.5': mix('B1-1.5', f), 'B1-0.5': mix('B1-0.5', f), C1: mix('C1', f) }));

// Grammar overhead: on tasks the grammar did NOT resolve, time spent before the first escalate beat.
const overhead = lo.filter(r => (r.arm === 'B5' || r.arm === 'B6') && r.resolvedBy !== 'grammar' && r.beats).map(r => r.beats!.find(b => b.kind === 'escalate')?.t_ms ?? r.wallMs);
const grammarSolved = lo.filter(r => r.arm === 'B0' && r.resolvedBy === 'grammar');
const grammarOverhead = {
  escalatedTasks: overhead.length, meanMsBeforeEscalation: +(overhead.reduce((a, b) => a + b, 0) / (overhead.length || 1)).toFixed(1), p95: +q(overhead, 0.95).toFixed(1),
  B0SolvedMeanMs: +(grammarSolved.reduce((a, r) => a + r.wallMs, 0) / grammarSolved.length).toFixed(1),
  B0SolvedMeanMsExcludingSandbox: +(grammarSolved.reduce((a, r) => a + (r.beats?.find(b => b.kind === 'compile')?.t_ms ?? 0), 0) / grammarSolved.length).toFixed(2),
};
const cache = { pass2: stats(lo2), resolvedBy: Object.fromEntries([...new Set(lo2.map(r => r.resolvedBy ?? 'refused'))].map(k => [k, lo2.filter(r => (r.resolvedBy ?? 'refused') === k).length])) };
const out = { verbatimBlind: verbatim.size, listopsTable, humanevalTable: heTable, curve, grammarOverhead, cache };
writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(out, null, 1));

const md: string[] = [];
md.push('| arm | pass | id | para | blind (true para) | blind (verbatim) | oog | refused | false accept | precision | mean / p50 / p95 wall ms | model CPU-s | CPU-s per correct |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of listopsTable) md.push(`| ${r.arm} | ${r.pass}/${r.n} (${(100 * r.passRate).toFixed(1)}%) | ${r.id} | ${r.para} | ${r.blindTrue} | ${r.blindVerbatim} | ${r.oog} | ${r.refused} | ${r.falseAccept} | ${r.precision ?? '—'} | ${r.meanWallMs} / ${r.p50WallMs} / ${r.p95WallMs} | ${r.modelCpuSec} | ${r.modelCpuSecPerCorrect ?? '—'} |`);
md.push('', '| HumanEval arm | pass@1 | false accept | mean / p50 / p95 wall ms | model calls | gen tokens | model CPU-s | CPU-s per correct |', '|---|---|---|---|---|---|---|---|');
for (const r of heTable) md.push(`| ${r.arm} | ${r.pass}/${r.n} (${(100 * r.passRate).toFixed(1)}%) | ${r.falseAccept} | ${r.meanWallMs} / ${r.p50WallMs} / ${r.p95WallMs} | ${r.modelCalls} | ${r.genTokens} | ${r.modelCpuSec} | ${r.modelCpuSecPerCorrect ?? '—'} |`);
md.push('', '| in-grammar fraction f | B6 pass / ms / CPU-s | B5 pass / ms / CPU-s | B1-1.5 pass / ms / CPU-s | B1-0.5 pass / ms / CPU-s | C1 pass / ms / CPU-s |', '|---|---|---|---|---|---|');
for (const c of curve) md.push(`| ${c.f} | ${[c.B6, c.B5, c['B1-1.5'], c['B1-0.5'], c.C1].map(x => `${x.passRate} / ${x.meanWallMs} / ${x.modelCpuSecPerTask}`).join(' | ')} |`);
writeFileSync(path.join(dir, 'analysis.md'), md.join('\n') + '\n');
console.log(md.join('\n')); console.log(JSON.stringify({ grammarOverhead, cache, verbatimBlind: verbatim.size }));
