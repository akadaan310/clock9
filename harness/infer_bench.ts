/** S4: real llama.cpp decoding comparisons on this host.
 * Greedy (temperature 0, top_k 1), fixed seed, n_predict 256, cache_prompt off, 1 slot, 4 threads.
 * For every speculative config we report output exactness vs the SAME model's plain
 * decode: under greedy verification the text should be identical (lossless), and any
 * divergence is reported, not hidden.
 * Usage: node dist/harness/infer_bench.js [--n 20] [--only name,name]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { LlamaServer, MODELS } from './llama.js';
import { loadHumanEval, loadListOps, ROOT } from './tasks.js';
import { pythonUserPrompt } from '../src/solver.js';
import type { Completion } from '../src/neural/adapter.js';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const N = Number(arg('--n') ?? 20);
const only = arg('--only')?.split(',');
const M05 = `${MODELS}/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf`;
const M15 = `${MODELS}/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`;

const lo = loadListOps().filter(t => t.split === 'id').slice(0, N);
const he = loadHumanEval().slice(0, N);
const prompts = [
  ...lo.map(t => ({ cls: 'listops', id: t.id, user: pythonUserPrompt(t) })),
  ...he.map(t => ({ cls: 'humaneval', id: t.task_id, user: `Complete the following Python function. Reply with a single \`\`\`python code block containing the complete function.\n\n\`\`\`python\n${t.prompt}\`\`\`` })),
  ...he.map(t => ({ cls: 'rewrite', id: t.task_id, user: `Rewrite this Python function exactly, keeping every line the same but renaming the function to \`${t.entry_point}_v2\`. Reply with a single \`\`\`python code block.\n\n\`\`\`python\n${t.prompt}${t.canonical_solution}\`\`\`` })),
];

type Cfg = { name: string; model: string; base: string; extra: string[] };
const CFGS: Cfg[] = [
  { name: '0.5b-plain', model: M05, base: '0.5b-plain', extra: [] },
  { name: '0.5b-ngram-simple', model: M05, base: '0.5b-plain', extra: ['--spec-type', 'ngram-simple'] },
  { name: '0.5b-ngram-simple-n4m16', model: M05, base: '0.5b-plain', extra: ['--spec-type', 'ngram-simple', '--spec-ngram-simple-size-n', '4', '--spec-ngram-simple-size-m', '16', '--spec-draft-n-max', '16'] },
  { name: '0.5b-ngram-mod', model: M05, base: '0.5b-plain', extra: ['--spec-type', 'ngram-mod', '--spec-ngram-mod-n-match', '8', '--spec-ngram-mod-n-min', '4', '--spec-ngram-mod-n-max', '16'] },
  { name: '0.5b-ngram-map-k', model: M05, base: '0.5b-plain', extra: ['--spec-type', 'ngram-map-k', '--spec-ngram-map-k-size-n', '4', '--spec-ngram-map-k-size-m', '16', '--spec-draft-n-max', '16'] },
  { name: '1.5b-plain', model: M15, base: '1.5b-plain', extra: [] },
  { name: '1.5b-ngram-simple-n4m16', model: M15, base: '1.5b-plain', extra: ['--spec-type', 'ngram-simple', '--spec-ngram-simple-size-n', '4', '--spec-ngram-simple-size-m', '16', '--spec-draft-n-max', '16'] },
  { name: '1.5b-ngram-mod', model: M15, base: '1.5b-plain', extra: ['--spec-type', 'ngram-mod', '--spec-ngram-mod-n-match', '8', '--spec-ngram-mod-n-min', '4', '--spec-ngram-mod-n-max', '16'] },
  { name: '1.5b-draft0.5b-n3', model: M15, base: '1.5b-plain', extra: ['-md', M05, '--spec-type', 'draft-simple', '--spec-draft-n-max', '3'] },
  { name: '1.5b-draft0.5b-n8', model: M15, base: '1.5b-plain', extra: ['-md', M05, '--spec-type', 'draft-simple', '--spec-draft-n-max', '8'] },
];

const outDir = path.join(ROOT, 'results', 's4');
mkdirSync(outDir, { recursive: true });
const texts: Record<string, Record<string, string>> = {};
const summary: unknown[] = [];
let port = 8100;
for (const cfg of CFGS) {
  if (only && !only.includes(cfg.name)) continue;
  const s = new LlamaServer({ name: cfg.name, model: cfg.model, port: port++, extra: cfg.extra });
  const loadMs = await s.start();
  const cpu0 = s.stats().cpuSec;
  const rows: (Completion & { cls: string; id: string })[] = [];
  const t0 = performance.now();
  for (const p of prompts) rows.push({ ...(await s.complete({ user: p.user, maxTokens: 256, seed: 9 })), cls: p.cls, id: p.id });
  const wall = performance.now() - t0;
  const st = s.stats();
  await s.stop();
  texts[cfg.name] = Object.fromEntries(rows.map(r => [`${r.cls}:${r.id}`, r.text]));
  const per = (cls: string | null) => {
    const R = rows.filter(r => !cls || r.cls === cls);
    const gen = R.reduce((a, r) => a + r.genTokens, 0), dec = R.reduce((a, r) => a + r.decodeMs, 0);
    const dn = R.reduce((a, r) => a + (r.draftTokens ?? 0), 0), da = R.reduce((a, r) => a + (r.draftAccepted ?? 0), 0);
    const base = texts[cfg.base];
    const exact = base ? R.filter(r => base[`${r.cls}:${r.id}`] === r.text).length : null;
    return {
      cls: cls ?? 'all', n: R.length, genTokens: gen, decodeTokPerS: +(1000 * gen / dec).toFixed(2),
      e2eTokPerS: +(1000 * gen / R.reduce((a, r) => a + r.ms, 0)).toFixed(2),
      meanRequestMs: +(R.reduce((a, r) => a + r.ms, 0) / R.length).toFixed(1),
      prefillTokPerS: +(1000 * R.reduce((a, r) => a + r.promptTokens, 0) / R.reduce((a, r) => a + r.prefillMs, 0)).toFixed(1),
      draftTokens: dn, draftAccepted: da, acceptRate: dn ? +(da / dn).toFixed(3) : null,
      exactVsPlain: exact === null ? null : `${exact}/${R.length}`,
    };
  };
  const rec = { config: cfg.name, args: s.args().map(a => a.replace(MODELS + '/', '')), loadMs: +loadMs.toFixed(0), wallS: +(wall / 1000).toFixed(1), cpuSec: +(st.cpuSec - cpu0).toFixed(1), peakRssMiB: +st.hwmMiB.toFixed(0), classes: [per(null), per('listops'), per('humaneval'), per('rewrite')] };
  summary.push(rec);
  writeFileSync(path.join(outDir, `raw-${cfg.name}.json`), JSON.stringify(rows, null, 1));
  console.log(JSON.stringify(rec));
}
writeFileSync(path.join(outDir, `summary${only ? '-' + only.join('+') : ''}.json`), JSON.stringify({ host: '4 vCPU Xeon @2.1GHz (AVX-512), 15 GiB, CPU only', llamaCpp: process.env.LLAMA_COMMIT ?? 'see results/s4/versions.txt', nPerClass: N, sampling: 'greedy temp0 top_k1 seed9 n_predict256 cache_prompt=false', summary }, null, 1));
