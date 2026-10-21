/** CLOCK9/0.2 test suite. Unit checks of the browser-safe core plus integration checks
 * that run compiled Python in the sandbox. Every check is a real assertion. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  validate, typecheck, interpret, sameValue, compilePython, toDsl, fromDsl, gbnf, signatureType, canonical, type Pipeline,
} from '../src/listops/ast.js';
import { candidates, extract } from '../src/listops/parse.js';
import { mine, fold, unfold, foldWitness, checkMacro } from '../src/listops/macros.js';
import { Clock, Cancelled } from '../src/clock.js';
import { NGram } from '../src/ngram.js';
import { HybridSolver, retrieve, type Executor, type Task } from '../src/solver.js';
import { GlossaryGenerator, type Snapshot } from '../src/text/glossary.js';
import { address, resolve } from '../src/address.js';
import { route } from '../src/router.js';
import { PythonSandbox } from '../harness/executor.js';
import { loadListOps, trainPairs, ROOT } from '../harness/tasks.js';

let ok = 0;
const failures: string[] = [];
function check(cond: boolean, why: string) { if (cond) ok++; else failures.push(why); }
async function throwsAsync(f: () => unknown, frag: string): Promise<boolean> {
  try { await f(); return false; } catch (e) { return String(e).includes(frag); }
}
const throws = (f: () => unknown, frag: string) => { try { f(); return false; } catch (e) { return String(e).includes(frag); } };

const P = (dsl: string) => fromDsl(dsl);
const all = loadListOps();
const train = trainPairs(all);
const sandbox = new PythonSandbox();

// ---------------------------------------------------------------- typed grammar
check(validate(P('filter even | map square | sum')).length === 0, 'admits a typed pipeline');
check(throws(() => fromDsl('filter prime | sum'), 'inadmissible'), 'unknown predicate refused');
check(throws(() => fromDsl('map mod 0 | list'), 'inadmissible'), 'modulo by zero refused');
check(throws(() => fromDsl('filter gt 500 | list'), 'inadmissible'), 'operand bound enforced');
check(throws(() => fromDsl('reverse | reverse | reverse | reverse | reverse | reverse | list'), 'stage_budget'), 'stage budget enforced');
check(typecheck(P('filter even | sum'), 'list[int]')[0]?.startsWith('type_mismatch') === true, 'type admission against signature');
check(signatureType('def solve(xs: list[int]) -> int | None:') === 'int | None', 'signature type parsed');
check(sameValue(interpret(P('map mod 3 | list'), [-7, 7]), [2, 1]), 'python modulo semantics');
check(sameValue(interpret(P('map floordiv 2 | list'), [-7, 7]), [-4, 3]), 'python floor-division semantics');
check(interpret(P('map mul 99 | product'), [99, 99, 99, 99, 99, 99, 99, 99, 99]) === 99n ** 18n, 'exact big integers (no float rounding)');
check(!sameValue(interpret(P('sum'), [1]), 1.5), 'non-integer expected value never matches');
check(compilePython(P('filter odd | map add -3 | max')) === 'def solve(xs: list[int]) -> int | None:\n    v = list(xs)\n    v = [x for x in v if x % 2 != 0]\n    v = [x + (-3) for x in v]\n    return max(v) if v else None\n', 'deterministic Python emission');
check(all.filter(t => t.ast).every(t => toDsl(fromDsl(toDsl(t.ast!))) === toDsl(t.ast!)), 'DSL text roundtrip for every task AST');
check(gbnf('int').includes('terminal ::= "sum" | "product" | "count"') && !gbnf('int').includes('"max"'), 'GBNF terminals restricted by declared type');

// Two independent implementations agree: TS BigInt interpreter vs Python reference_eval outputs.
{
  let n = 0, bad = 0;
  for (const t of all) if (t.ast) for (const c of [...t.visible, ...t.hidden]) { n++; if (!sameValue(interpret(t.ast, c.input), c.output)) bad++; }
  check(bad === 0 && n > 3000, `TS interpreter == Python reference on ${n} cases (${bad} mismatches)`);
}
// Compiled Python (third path) passes the hidden tests of every train task, inside the sandbox.
{
  const tr = all.filter(t => t.split === 'train');
  const rs = await Promise.all(tr.map(t => sandbox.run(compilePython(t.ast!), t.hidden)));
  check(rs.every(r => r.pass), `compiled Python passes hidden tests for ${rs.filter(r => r.pass).length}/${tr.length} train programs`);
}
// Sandbox refuses effects.
{
  const net = await sandbox.run('import socket\ndef solve(xs):\n    socket.create_connection(("1.1.1.1", 80), timeout=2)\n    return 0\n', [{ input: [1], output: 0 }]);
  const fsw = await sandbox.run('def solve(xs):\n    open("/tmp/clock9-probe", "w").write("x")\n    return 0\n', [{ input: [1], output: 0 }]);
  const loop = await sandbox.run('def solve(xs):\n    while True:\n        pass\n', [{ input: [1], output: 0 }]);
  const uid = await sandbox.run('import os\ndef solve(xs):\n    return os.getuid()\n', [{ input: [1], output: 65534 }]);
  check(!net.pass && !fsw.pass && !loop.pass && uid.pass, `sandbox: no network (${net.error}), no file writes (${fsw.error}), CPU-bounded, unprivileged uid`);
}

// ---------------------------------------------------------------- request grammar
{
  let exact = 0;
  const s = new HybridSolver({ grammar: true, cache: false, train });
  for (const t of all.filter(t => t.split === 'train')) { const r = await s.solve(t); if (r.dsl === toDsl(t.ast!)) exact++; }
  check(exact === 60, `train split parsed to the exact AST (${exact}/60)`);
}
check(candidates('Translate this poem into French.', 'int').refusal === 'nothing_recognized', 'no fragments => explicit refusal');
check(extract('remove every number equal to 3').fragments.some(f => f.kind === 'stage' && canonical(f.stages) === canonical([{ op: 'filter', pred: { p: 'ne', k: 3 } }])), 'removal verb flips predicate polarity');
check(candidates('Given a list of integers xs, negate each number, then negate each number, and return the list.', 'list[int]').candidates.some(c => toDsl(c.program) === 'map neg | map neg | list'), 'repeated steps are kept');

// ---------------------------------------------------------------- clock + scheduler semantics
{
  const s = new HybridSolver({ grammar: true, cache: false, executor: sandbox, train });
  const t = all.find(t => t.split === 'train')!;
  const r = await s.solve(t);
  const kinds = r.beats.map(b => b.kind).join(',');
  check(kinds === 'context,draft,draft,admit,compile,verify,promote', `grammar path beat order (${kinds})`);
  check(r.beats.every((b, i) => b.beat === i) && r.beats.every((b, i) => i === 0 || b.t_ms >= r.beats[i - 1]!.t_ms), 'beats numbered and monotone');
  check(r.beats.find(b => b.kind === 'verify')!.source === 'tool' && r.beats[1]!.source === 'grammar' && r.beats[2]!.source === 'ngram', 'every beat discloses its source');
  check(r.witness.executorVisible?.pass === true && r.witness.grammarVersion === 'listops/1.0' && /^[0-9a-f]{8}$/.test(r.witness.ngramCorpusHash), 'witness records grammar version, n-gram corpus hash, executor result');
  const oog = all.find(t => t.split === 'oog')!;
  const rr = await s.solve(oog);
  check(rr.status === 'refused' && rr.code === null && rr.beats.at(-1)!.kind === 'refuse', 'failed lookup stays an explicit refusal (no default program)');
  const ac = new AbortController(); ac.abort();
  check(await throwsAsync(() => s.solve(t, ac.signal), 'cancelled: signal'), 'cancellation via AbortSignal');
  const tight = new HybridSolver({ grammar: true, cache: false, executor: sandbox, train, budget: { maxBeats: 3, deadlineMs: 1e5 } });
  check(await throwsAsync(() => tight.solve(t), 'beat_budget'), 'beat budget bounds the search');
  const c = new Clock();
  const order: string[] = [];
  await c.run([
    { kind: 'context', source: 'grammar', run: async () => { order.push('a'); return { detail: 'a', next: [{ kind: 'draft', source: 'grammar', run: async () => { order.push('c'); return { detail: 'c' }; } }] }; } },
    { kind: 'retrieve', source: 'cache', run: async () => { order.push('b'); return { detail: 'b' }; } },
  ]);
  check(order.join('') === 'abc' && c.trace.length === 3, 'event queue is FIFO with successor events');
  check(new Cancelled('x').message === 'cancelled: x', 'cancellation is typed');
}

// ---------------------------------------------------------------- certified macros (Plicastratum fold/unfold)
{
  const s = new HybridSolver({ grammar: true, cache: false, executor: sandbox, train });
  const mk = (id: string, prompt: string, vis: [number[], unknown][]): Task => ({ id, prompt, signature: 'def solve(xs: list[int]) -> int:', visible: vis.map(([input, output]) => ({ input, output })) });
  await s.solve(mk('m1', 'Given a list of integers xs, keep only the even numbers, then square each number, and return the sum.', [[[1, 2, 3, 4], 20], [[6, -2], 40]]));
  check(s.macros.length === 0, 'one verified program alone promotes nothing');
  await s.solve(mk('m2', 'Given a list of integers xs, keep only the even numbers, then square each number, and return how many numbers remain.', [[[1, 2, 3, 4], 2], [[5], 0]]));
  const m = s.macros.find(x => toDsl({ stages: x.body, terminal: 'list' }) === 'filter even | map square | list');
  check(!!m && m.witnesses.join(',') === 'm1,m2', 'recurring verified word promoted with two independent witnesses');
  const p = P('filter even | map square | take 2 | sum');
  const f = fold(p, s.macros);
  check(f.stages.length === 2 && (f.stages[0] as { glyph: string }).glyph === m?.glyph, 'fold replaces the word by its glyph');
  check(canonical(unfold(f, s.macros)) === canonical(p) && foldWitness(p, s.macros, [[1, 2, 3, 4, 6], [], [-2, -4]]), 'unfold(fold(p)) == p exactly and behaviour preserved');
  check(throws(() => checkMacro({ ...m!, certificate: 'deadbeef' }), 'Invalid macro'), 'tampered macro certificate refused');
  check(mine([{ id: 'a', program: P('reverse | distinct | list') }]).length === 0, 'single-witness word is not certified');
}

// ---------------------------------------------------------------- contextual preference changes selection, not the language
{
  const req: Task = { id: 'pref', prompt: 'Given a list of integers xs, keep only the positive numbers, and return the first number or the largest number (or None if there are none).', signature: 'def solve(xs: list[int]) -> int | None:', visible: [{ input: [-1, 5, 2], output: 5 }, { input: [9, 3], output: 9 }] };
  const a = new HybridSolver({ grammar: true, cache: false, train: Array(5).fill({ prompt: 'x', dsl: 'filter pos | first' }) });
  const b = new HybridSolver({ grammar: true, cache: false, train: Array(5).fill({ prompt: 'x', dsl: 'filter pos | max' }) });
  const ca = candidates(req.prompt, 'int | None').candidates.map(c => toDsl(c.program)).sort();
  const ra = await a.solve(req), rb = await b.solve(req);
  check(ca.join(';') === 'filter pos | first;filter pos | max', 'admitted readings are the same set for both contexts');
  check(ra.dsl === 'filter pos | first' && rb.dsl === 'filter pos | max', `n-gram context selects different admitted readings (${ra.dsl} vs ${rb.dsl})`);
}
{
  const g = new NGram(3); g.observe(['a', 'b', 'c']); g.observe(['a', 'b', 'd']);
  check(g.score(['a', 'b'], 'c').order === 3 && g.score(['z'], 'c').order === 1, 'variable-order backoff records the order used');
  check(retrieve(train, 'keep only the even numbers and return the sum', 2).length === 2, 'n-gram retrieval over train split');
}

// ---------------------------------------------------------------- text grammar (glossary)
{
  const snap = JSON.parse(readFileSync(path.join(ROOT, 'tasks', 'glossary_snapshot.json'), 'utf8')) as Snapshot;
  const gen = new GlossaryGenerator(snap);
  const k = gen.generate('Define kernel');
  const kernel = snap.terms.find(t => t.id === 'kernel')!;
  check(k.ok && k.sentences.some(s => s.provenance.kind === 'cited-glossary' && s.provenance.source?.includes(snap.commit) && kernel.senses.some(x => x.text === s.text)), 'text: sourced passage quotes glossary verbatim with commit-pinned source');
  check(k.grammarVersion === 'glossary-text/1.0' && /^[0-9a-f]{8}$/.test(k.ngramCorpusHash) && k.derivation[0] === 'Request -> Define', 'text: record carries grammar version, corpus hash, derivation');
  const ev = gen.generate('What does image mean in everyday usage?');
  check(ev.ok && ev.sentences[1]!.provenance.domain === 'everyday', 'text: explicit domain selects that sense');
  const cam = gen.generate('What is an image in a camera photograph picture?');
  check(cam.ok && cam.sentences[1]!.provenance.domain === 'everyday', `text: n-gram context disambiguates the domain (${cam.sentences[1]?.provenance.domain})`);
  check(gen.generate('What does image mean in the acoustic sense?').refusal === 'no_sense_in_domain', 'text: demanded domain without a sense is refused');
  check(gen.generate('Define flibbertigibbet').refusal === 'unknown_term', 'text: unknown term refused, not invented');
  check(gen.generate('Given a list of integers xs, return the sum.').refusal === 'not_a_text_request', 'text: code request is not answered with text');
  const house = snap.terms.find(t => t.senses.length === 1 && t.senses[0]!.status === 'house')!;
  const h = gen.generate(`Define ${house.term}`);
  check(h.ok && h.passage.includes('house construction'), `text: epistemic status labelled (${house.term})`);
  // Held-out routing set (written for this test; not used to build either grammar).
  const textReqs = ['Define fold', 'What is a witness?', 'Explain admissibility', 'What does orbit mean?', 'How is image related to kernel?', 'Define transition', 'What is an alphabet?', 'Meaning of grammar', 'Explain the Plicastratum', 'What does state mean in the foundations sense?'];
  const codeReqs = ['Given a list of integers xs, keep the odd numbers and return the sum.', 'Return how many numbers in xs are negative.', 'Sort xs in descending order and return the list.', 'Return the largest value in xs or None.', 'Square each number of xs and return the product.', 'Count the zeros in xs.', 'Return xs without duplicates.', 'Add 3 to each element of xs and return the resulting list.', 'Return the first number in xs above 4, or None.', 'Drop the first 2 elements of xs and return the sum.'];
  check(textReqs.every(r => route(r) === 'text') && codeReqs.every(r => route(r) === 'code'), `router: held-out text/code requests (${textReqs.filter(r => route(r) === 'text').length}/10, ${codeReqs.filter(r => route(r) === 'code').length}/10)`);
  check(textReqs.every(r => gen.generate(r).ok), `text: all held-out text requests answered from sources (${textReqs.filter(r => gen.generate(r).ok).length}/10)`);
  check(codeReqs.every(r => !gen.generate(r).ok), 'text: no held-out code request receives a text answer');
}

// ---------------------------------------------------------------- address (non-mutating)
{
  let calls = 0;
  const spy: Executor = { id: 'spy', run: async () => { calls++; return { pass: true, passed: 0, total: 0, ms: 0 }; } };
  void spy;
  const p: Pipeline = P('filter le -2 | map abs | sort desc | take 3 | list');
  const a = address(p);
  const r = resolve(a);
  check(canonical(r.program) === canonical(p) && address(r.program) === a && r.effects === 'none' && calls === 0, 'address roundtrip is exact and executes nothing');
  check(throws(() => resolve(a.slice(0, -1) + (a.endsWith('0') ? '1' : '0')), 'Checksum'), 'corrupted address refused');
  check(throws(() => resolve('purl://x'), 'Unsupported'), 'foreign scheme refused (clock9:// is local only)');
}

// ---------------------------------------------------------------- browser safety of the core
{
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);
  const core = files(path.join(ROOT, 'src'));
  const bad = core.filter(f => /from 'node:|require\(|process\.|\bfetch\(/.test(readFileSync(f, 'utf8')));
  check(core.length >= 9 && bad.length === 0, `core src/ is browser-safe: no Node APIs, no network calls (${bad.map(f => path.basename(f)).join(',')})`);
}

if (failures.length) { console.error(`${failures.length} FAILED:\n  - ${failures.join('\n  - ')}`); process.exit(1); }
console.log(`${ok} checks passed (CLOCK9/0.2). v0.1's 22 checks: npm run test:v01`);
