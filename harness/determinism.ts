/** S4 control: are speculative/plain divergences real, or plain-decode nondeterminism?
 * Re-runs plain decoding of the prompts on which any speculative config diverged, (a) as
 * before, (b) with -b/-ub 16 (different prefill batch shape; -b 1 aborts in this llama.cpp build: get_sub_batch error), and reports where texts first differ. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LlamaServer, MODELS } from './llama.js';
import { loadHumanEval, ROOT } from './tasks.js';

const dir = path.join(ROOT, 'results', 's4');
const raw = (n: string) => JSON.parse(readFileSync(path.join(dir, `raw-${n}.json`), 'utf8')) as { cls: string; id: string; text: string }[];
const plain = raw('1.5b-plain');
const specs = ['1.5b-draft0.5b-n3', '1.5b-draft0.5b-n8', '1.5b-ngram-simple-n4m16', '1.5b-ngram-mod'];
const div = new Map<string, string[]>();
for (const s of specs) raw(s).forEach((r, i) => { if (r.text !== plain[i]!.text) div.set(`${r.cls}:${r.id}`, [...(div.get(`${r.cls}:${r.id}`) ?? []), s]); });
const he = new Map(loadHumanEval().map(t => [t.task_id, t]));
const user = (id: string) => { const t = he.get(id)!; return `Complete the following Python function. Reply with a single \`\`\`python code block containing the complete function.\n\n\`\`\`python\n${t.prompt}\`\`\``; };
const firstDiff = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
const out: unknown[] = [];
for (const [variant, extra] of [['plain-rerun', []], ['plain-ubatch16', ['-b', '16', '-ub', '16']]] as const) {
  const s = new LlamaServer({ name: variant, model: `${MODELS}/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`, port: 8300 + out.length, extra: [...extra] });
  await s.start();
  for (const key of div.keys()) {
    const [cls, id] = [key.split(':')[0]!, key.slice(key.indexOf(':') + 1)];
    if (cls !== 'humaneval') continue;
    const r = await s.complete({ user: user(id), maxTokens: 256, seed: 9 });
    const base = plain.find(p => p.cls === cls && p.id === id)!.text;
    const specDiffs = div.get(key)!.map(sp => { const t = raw(sp).find(p => p.cls === cls && p.id === id)!.text; return { config: sp, firstDiffChar: firstDiff(t, base), equalsThisRun: t === r.text }; });
    out.push({ variant, key, equalsOriginalPlain: r.text === base, firstDiffChar: r.text === base ? null : firstDiff(r.text, base), baseLen: base.length, specDiffs });
  }
  await s.stop();
}
writeFileSync(path.join(dir, 'determinism-control.json'), JSON.stringify({ divergentPrompts: [...div.entries()], runs: out }, null, 1));
console.log(JSON.stringify(out));
