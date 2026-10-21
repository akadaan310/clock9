/** `clock9://listops/<version>/<dsl>.<fnv1a>` — a LOCAL experimental scheme (not PURL,
 * not SEURL, not registered). Resolution is pure: it decodes, checks and explains a
 * program, and never executes it. Execution needs a separately passed Executor
 * capability; possessing an address grants nothing. The checksum detects accidental
 * corruption only; it is not integrity against an adversary or an authorization token.
 */
import { canonical, fnv1a, fromDsl, toDsl, validate, compilePython, GRAMMAR_VERSION, type Pipeline } from './listops/ast.js';

const PREFIX = `clock9://listops/${GRAMMAR_VERSION.split('/')[1]}/`;
export function address(p: Pipeline): string {
  if (validate(p).length) throw Error('Invalid program');
  const dsl = toDsl(p);
  return `${PREFIX}${encodeURIComponent(dsl)}.${fnv1a(dsl)}`;
}
export type Resolved = { program: Pipeline; dsl: string; explain: string[]; effects: 'none' };
export function resolve(addr: string): Resolved {
  if (!addr.startsWith(PREFIX)) throw Error('Unsupported address (scheme/version)');
  const rest = addr.slice(PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot < 0) throw Error('Missing checksum');
  let dsl: string;
  try { dsl = decodeURIComponent(rest.slice(0, dot)); } catch { throw Error('Invalid encoding'); }
  if (fnv1a(dsl) !== rest.slice(dot + 1)) throw Error('Checksum mismatch');
  const program = fromDsl(dsl);
  if (toDsl(program) !== dsl) throw Error('Noncanonical program text');
  const explain = [`grammar ${GRAMMAR_VERSION}`, ...program.stages.map((s, i) => `stage ${i + 1}: ${canonical(s)}`), `terminal: ${program.terminal}`, `compiles to ${compilePython(program).split('\n').length - 1} lines of Python`];
  return { program, dsl, explain, effects: 'none' };
}
