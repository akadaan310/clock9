/** ListOps: a typed list-pipeline grammar for small `solve(xs: list[int])` tasks.
 * Browser-safe: no Node imports. Semantics follow Python (floor division and
 * modulo round toward -inf; integers are exact, so the interpreter uses BigInt).
 */
export type PredName = 'even' | 'odd' | 'pos' | 'neg' | 'nonzero' | 'gt' | 'lt' | 'ge' | 'le' | 'eq' | 'ne' | 'div';
export type FnName = 'add' | 'sub' | 'mul' | 'mod' | 'floordiv' | 'square' | 'neg' | 'abs';
export type Pred = { p: PredName; k?: number };
export type Fn = { f: FnName; k?: number };
export type Stage =
  | { op: 'filter'; pred: Pred }
  | { op: 'map'; fn: Fn }
  | { op: 'sort'; desc: boolean }
  | { op: 'take'; k: number }
  | { op: 'drop'; k: number }
  | { op: 'reverse' }
  | { op: 'distinct' };
export type Terminal = 'list' | 'sum' | 'product' | 'count' | 'max' | 'min' | 'first' | 'last';
export type Pipeline = { stages: Stage[]; terminal: Terminal };
export type RetType = 'list[int]' | 'int' | 'int | None';

export const GRAMMAR_VERSION = 'listops/1.0';
export const MAX_STAGES = 5;
export const PRED_NULLARY: PredName[] = ['even', 'odd', 'pos', 'neg', 'nonzero'];
export const PRED_INT: PredName[] = ['gt', 'lt', 'ge', 'le', 'eq', 'ne'];
export const FN_NULLARY: FnName[] = ['square', 'neg', 'abs'];
export const FN_INT: FnName[] = ['add', 'sub', 'mul'];
export const FN_POS: FnName[] = ['mod', 'floordiv'];
export const TERMINALS: Terminal[] = ['list', 'sum', 'product', 'count', 'max', 'min', 'first', 'last'];

export function terminalType(t: Terminal): RetType {
  if (t === 'list') return 'list[int]';
  if (t === 'sum' || t === 'product' || t === 'count') return 'int';
  return 'int | None';
}

/** Parse the declared return type out of a `def solve(xs: list[int]) -> T:` signature. */
export function signatureType(signature: string): RetType | null {
  const m = /->\s*(.+?)\s*:\s*$/.exec(signature.trim());
  const t = m?.[1]?.replace(/\s+/g, ' ');
  return t === 'list[int]' || t === 'int' || t === 'int | None' ? t : null;
}

const isInt = (k: unknown, lo: number, hi: number): k is number =>
  typeof k === 'number' && Number.isInteger(k) && k >= lo && k <= hi;

/** Admissibility: syntax, operand ranges, stage budget. Returns diagnostics (empty = admitted). */
export function validate(p: Pipeline): string[] {
  const d: string[] = [];
  if (!p || !Array.isArray(p.stages)) return ['shape'];
  if (p.stages.length > MAX_STAGES) d.push('stage_budget');
  p.stages.forEach((s, i) => {
    switch (s.op) {
      case 'filter': {
        const { p: name, k } = s.pred ?? ({} as Pred);
        if (PRED_NULLARY.includes(name)) { if (k !== undefined) d.push(`pred_arity_${i}`); }
        else if (PRED_INT.includes(name)) { if (!isInt(k, -99, 99)) d.push(`pred_operand_${i}`); }
        else if (name === 'div') { if (!isInt(k, 1, 99)) d.push(`pred_operand_${i}`); }
        else d.push(`pred_unknown_${i}`);
        break;
      }
      case 'map': {
        const { f, k } = s.fn ?? ({} as Fn);
        if (FN_NULLARY.includes(f)) { if (k !== undefined) d.push(`fn_arity_${i}`); }
        else if (FN_INT.includes(f)) { if (!isInt(k, -99, 99)) d.push(`fn_operand_${i}`); }
        else if (FN_POS.includes(f)) { if (!isInt(k, 1, 99)) d.push(`fn_operand_${i}`); }
        else d.push(`fn_unknown_${i}`);
        break;
      }
      case 'sort': if (typeof s.desc !== 'boolean') d.push(`sort_flag_${i}`); break;
      case 'take': case 'drop': if (!isInt(s.k, 0, 99)) d.push(`${s.op}_operand_${i}`); break;
      case 'reverse': case 'distinct': break;
      default: d.push(`stage_unknown_${i}`);
    }
  });
  if (!TERMINALS.includes(p.terminal)) d.push('terminal_unknown');
  return d;
}

/** Type admission: an admitted program must also produce the signature's declared type. */
export function typecheck(p: Pipeline, want: RetType | null): string[] {
  const d = validate(p);
  if (d.length) return d;
  if (want && terminalType(p.terminal) !== want) return [`type_mismatch:${terminalType(p.terminal)}!=${want}`];
  return [];
}

// ------------------------------------------------------------------ interpreter (exact)
export type Value = bigint[] | bigint | null;
const pyMod = (a: bigint, b: bigint) => ((a % b) + b) % b;
const pyFloorDiv = (a: bigint, b: bigint) => (a - pyMod(a, b)) / b;

function predHolds(p: Pred, x: bigint): boolean {
  const k = BigInt(p.k ?? 0);
  switch (p.p) {
    case 'even': return pyMod(x, 2n) === 0n;
    case 'odd': return pyMod(x, 2n) !== 0n;
    case 'pos': return x > 0n;
    case 'neg': return x < 0n;
    case 'nonzero': return x !== 0n;
    case 'gt': return x > k; case 'lt': return x < k;
    case 'ge': return x >= k; case 'le': return x <= k;
    case 'eq': return x === k; case 'ne': return x !== k;
    case 'div': return pyMod(x, k) === 0n;
  }
}
function applyFn(f: Fn, x: bigint): bigint {
  const k = BigInt(f.k ?? 0);
  switch (f.f) {
    case 'add': return x + k; case 'sub': return x - k; case 'mul': return x * k;
    case 'mod': return pyMod(x, k); case 'floordiv': return pyFloorDiv(x, k);
    case 'square': return x * x; case 'neg': return -x; case 'abs': return x < 0n ? -x : x;
  }
}
export function interpret(p: Pipeline, xs: readonly number[]): Value {
  if (validate(p).length) throw Error('Invalid program');
  let v = xs.map(x => BigInt(x));
  for (const s of p.stages) {
    switch (s.op) {
      case 'filter': v = v.filter(x => predHolds(s.pred, x)); break;
      case 'map': v = v.map(x => applyFn(s.fn, x)); break;
      case 'sort': v = [...v].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); if (s.desc) v.reverse(); break;
      case 'take': v = v.slice(0, s.k); break;
      case 'drop': v = v.slice(s.k); break;
      case 'reverse': v = [...v].reverse(); break;
      case 'distinct': v = [...new Set(v)]; break;
    }
  }
  switch (p.terminal) {
    case 'list': return v;
    case 'sum': return v.reduce((a, b) => a + b, 0n);
    case 'product': return v.reduce((a, b) => a * b, 1n);
    case 'count': return BigInt(v.length);
    case 'max': return v.length ? v.reduce((a, b) => (b > a ? b : a)) : null;
    case 'min': return v.length ? v.reduce((a, b) => (b < a ? b : a)) : null;
    case 'first': return v[0] ?? null;
    case 'last': return v[v.length - 1] ?? null;
  }
}
/** Exact equality between an interpreter value and a JSON expected value. */
export function sameValue(got: Value, want: unknown): boolean {
  if (got === null) return want === null;
  if (Array.isArray(got)) return Array.isArray(want) && want.length === got.length && got.every((g, i) => sameValue(g, want[i]));
  return typeof want === 'number' && Number.isSafeInteger(want) && BigInt(want) === got;
}

// ------------------------------------------------------------------ compilers
function pyPred(p: Pred): string {
  const k = p.k;
  switch (p.p) {
    case 'even': return 'x % 2 == 0'; case 'odd': return 'x % 2 != 0';
    case 'pos': return 'x > 0'; case 'neg': return 'x < 0'; case 'nonzero': return 'x != 0';
    case 'gt': return `x > ${k}`; case 'lt': return `x < ${k}`; case 'ge': return `x >= ${k}`;
    case 'le': return `x <= ${k}`; case 'eq': return `x == ${k}`; case 'ne': return `x != ${k}`;
    case 'div': return `x % ${k} == 0`;
  }
}
function pyFn(f: Fn): string {
  const k = f.k !== undefined && f.k < 0 ? `(${f.k})` : `${f.k}`;
  switch (f.f) {
    case 'add': return `x + ${k}`; case 'sub': return `x - ${k}`; case 'mul': return `x * ${k}`;
    case 'mod': return `x % ${k}`; case 'floordiv': return `x // ${k}`;
    case 'square': return 'x * x'; case 'neg': return '-x'; case 'abs': return 'abs(x)';
  }
}
/** Deterministic Python source for an admitted pipeline. */
export function compilePython(p: Pipeline): string {
  if (validate(p).length) throw Error('Invalid program');
  const lines = [`def solve(xs: list[int]) -> ${terminalType(p.terminal)}:`, '    v = list(xs)'];
  for (const s of p.stages) {
    switch (s.op) {
      case 'filter': lines.push(`    v = [x for x in v if ${pyPred(s.pred)}]`); break;
      case 'map': lines.push(`    v = [${pyFn(s.fn)} for x in v]`); break;
      case 'sort': lines.push(`    v = sorted(v${s.desc ? ', reverse=True' : ''})`); break;
      case 'take': lines.push(`    v = v[:${s.k}]`); break;
      case 'drop': lines.push(`    v = v[${s.k}:]`); break;
      case 'reverse': lines.push('    v = v[::-1]'); break;
      case 'distinct': lines.push('    v = list(dict.fromkeys(v))'); break;
    }
  }
  const ret: Record<Terminal, string[]> = {
    list: ['    return v'], sum: ['    return sum(v)'],
    product: ['    r = 1', '    for x in v:', '        r *= x', '    return r'],
    count: ['    return len(v)'],
    max: ['    return max(v) if v else None'], min: ['    return min(v) if v else None'],
    first: ['    return v[0] if v else None'], last: ['    return v[-1] if v else None'],
  };
  lines.push(...ret[p.terminal]);
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------ textual DSL (model-facing)
/** `filter even | map square | sum` — the surface syntax constrained decoding targets. */
export function toDsl(p: Pipeline): string {
  const parts = p.stages.map(s => {
    switch (s.op) {
      case 'filter': return `filter ${s.pred.p}${s.pred.k !== undefined ? ' ' + s.pred.k : ''}`;
      case 'map': return `map ${s.fn.f}${s.fn.k !== undefined ? ' ' + s.fn.k : ''}`;
      case 'sort': return `sort ${s.desc ? 'desc' : 'asc'}`;
      case 'take': case 'drop': return `${s.op} ${s.k}`;
      default: return s.op;
    }
  });
  return [...parts, p.terminal].join(' | ');
}
export function fromDsl(src: string): Pipeline {
  const parts = src.trim().split(/\s*\|\s*/);
  const term = parts.pop() as Terminal;
  const num = (t: string | undefined) => {
    if (t === undefined || !/^-?\d+$/.test(t)) throw Error(`bad integer: ${t}`);
    return Number(t);
  };
  const stages: Stage[] = parts.map(part => {
    const [op, a, b, ...rest] = part.split(/\s+/);
    if (rest.length) throw Error(`trailing tokens in "${part}"`);
    switch (op) {
      case 'filter': return { op, pred: b === undefined ? { p: a as PredName } : { p: a as PredName, k: num(b) } };
      case 'map': return { op, fn: b === undefined ? { f: a as FnName } : { f: a as FnName, k: num(b) } };
      case 'sort': if (a !== 'asc' && a !== 'desc') throw Error('sort flag'); return { op, desc: a === 'desc' };
      case 'take': case 'drop': return { op, k: num(a) };
      case 'reverse': case 'distinct': if (a !== undefined) throw Error(`${op} takes no operand`); return { op };
      default: throw Error(`unknown stage "${op}"`);
    }
  });
  const p = { stages, terminal: term };
  const d = validate(p);
  if (d.length) throw Error(`inadmissible: ${d.join(',')}`);
  return p;
}
/** GBNF for llama.cpp grammar-constrained decoding; language == validate()-admitted DSL strings
 * (operand magnitudes bounded to two digits). `want` restricts terminals to the declared type. */
export function gbnf(want: RetType | null = null): string {
  const terms = TERMINALS.filter(t => !want || terminalType(t) === want).map(t => `"${t}"`).join(' | ');
  return [
    `root ::= (stage " | "){0,${MAX_STAGES}} terminal`,
    'stage ::= "filter " pred | "map " fn | "sort " ("asc" | "desc") | "take " nat | "drop " nat | "reverse" | "distinct"',
    `pred ::= (${PRED_NULLARY.map(x => `"${x}"`).join(' | ')}) | (${PRED_INT.map(x => `"${x}"`).join(' | ')}) " " int | "div " pos`,
    `fn ::= (${FN_NULLARY.map(x => `"${x}"`).join(' | ')}) | (${FN_INT.map(x => `"${x}"`).join(' | ')}) " " int | (${FN_POS.map(x => `"${x}"`).join(' | ')}) " " pos`,
    'int ::= "-"? nat',
    'nat ::= [0-9] | [1-9] [0-9]',
    'pos ::= [1-9] | [1-9] [0-9]',
    `terminal ::= ${terms}`,
  ].join('\n') + '\n';
}

// ------------------------------------------------------------------ canonical form + hash
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const x = value as Record<string, unknown>;
    return `{${Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
/** FNV-1a 32-bit: detects accidental change; NOT a cryptographic integrity check. */
export function fnv1a(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}
