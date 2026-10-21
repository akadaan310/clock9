/** Build tasks/listops_blind.jsonl: model-written paraphrases of the `id` split.
 * Written after parser v1.0 was frozen; the parser author does not read it before
 * scoring. Labels (AST, tests) are inherited from the source task, so a paraphrase
 * that changed the meaning is label noise shared equally by every arm. */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LlamaServer, MODELS } from './llama.js';
import { loadListOps, ROOT } from './tasks.js';

const src = loadListOps().filter(t => t.split === 'id');
const m = new LlamaServer({ name: 'qwen2.5-coder-1.5b-q4km', model: `${MODELS}/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`, port: 8092 });
await m.start();
const out: string[] = [];
for (const t of src) {
  const c = await m.complete({
    user: 'Rewrite the following programming task in your own words, as one or two plain English sentences. ' +
      'Keep exactly the same meaning, the same numbers, and the same order of steps. Refer to the input list as xs. ' +
      'Reply with only the rewritten task.\n\nTask: ' + t.prompt,
    maxTokens: 120, seed: 9,
  });
  const row: Record<string, unknown> = { ...t, id: t.id.replace("id-", "blind-"), split: "blind", prompt: c.text.trim().replace(/\s+/g, " "), source_id: t.id };
  out.push(JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(k => [k, row[k]]))));
}
await m.stop();
const file = path.join(ROOT, 'tasks', 'listops_blind.jsonl');
writeFileSync(file, out.join('\n') + '\n');
console.log(JSON.stringify({ file: 'listops_blind.jsonl', n: out.length, sha256: createHash('sha256').update(out.join('\n') + '\n').digest('hex'), generator: 'qwen2.5-coder-1.5b-instruct-q4_k_m greedy seed 9' }));
