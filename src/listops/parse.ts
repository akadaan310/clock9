/** Request grammar: English task text -> admissible ListOps candidates.
 *
 * The grammar only EXTRACTS typed fragments (predicates, maps, structure, a
 * terminal). It does not decide their order: the scheduler enumerates the
 * admissible orderings, ranks them (textual order + n-gram preference) and lets
 * the visible examples admit or reject each one. If nothing is extracted, or no
 * ordering survives, the result is an explicit refusal — never a default program.
 *
 * Lexicon provenance: train-split templates + generic English synonyms, written
 * before the held-out splits were scored (see tasks/MANIFEST.md for the bias note).
 */
import type { Pipeline, Pred, Stage, Terminal, RetType } from './ast.js';
import { terminalType, typecheck } from './ast.js';

export const PARSER_VERSION = 'listops-nl/1.0';

export type Fragment = { kind: 'stage'; stages: Stage[]; at: number; text: string } | { kind: 'terminal'; terminal: Terminal; at: number; text: string };
export type Extraction = { fragments: Fragment[]; normalized: string };

const NUM_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
};
export function normalize(text: string): string {
  let t = ' ' + text.toLowerCase().replace(/[“”]/g, '"').replace(/\s+/g, ' ') + ' ';
  // number words -> digits, except "one" used as a pronoun ("the ones", "each one")
  t = t.replace(/\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, w => NUM_WORDS[w]!);
  t = t.replace(/\b(by|than|to|from|first|last) one\b/g, '$1 1');
  return t;
}

const NEGATORS = /\b(remove|removing|drop|dropping|discard|discarding|exclude|excluding|delete|without|except|ignore|ignoring|throw away|filter out|get rid of|not)\b[^,;]*$/;
function negate(p: Pred): Pred | null {
  const k = p.k;
  switch (p.p) {
    case 'even': return { p: 'odd' }; case 'odd': return { p: 'even' };
    case 'pos': return { p: 'le', k: 0 }; case 'neg': return { p: 'ge', k: 0 };
    case 'nonzero': return { p: 'eq', k: 0 };
    case 'gt': return { p: 'le', k }; case 'lt': return { p: 'ge', k };
    case 'ge': return { p: 'lt', k }; case 'le': return { p: 'gt', k };
    case 'eq': return k === 0 ? { p: 'nonzero' } : { p: 'ne', k }; case 'ne': return { p: 'eq', k };
    case 'div': return null;
  }
}

type Rule = { re: RegExp; make: (m: RegExpExecArray, before: string) => Stage[] | Terminal | null };
const I = (s: string | undefined) => Number(s);
const filt = (pred: Pred, before: string): Stage[] | null => {
  // polarity: a removal verb earlier in the same clause flips the predicate
  const clause = before.split(/,|;|\bthen\b|\band\b(?= (?:keep|return|count|sum|take))/).pop() ?? '';
  const q = NEGATORS.test(clause) ? negate(pred) : pred;
  return q ? [{ op: 'filter', pred: q }] : null;
};

// Ordered: earlier rules claim their character spans first.
const RULES: Rule[] = [
  // ---- structure with numbers
  { re: /\b(\d+) (?:largest|biggest|greatest|highest)\b/g, make: m => [{ op: 'sort', desc: true }, { op: 'take', k: I(m[1]) }] },
  { re: /\b(\d+) (?:smallest|lowest)\b/g, make: m => [{ op: 'sort', desc: false }, { op: 'take', k: I(m[1]) }] },
  { re: /\b(?:drop|skip|ignore|ignoring|remove|discard|without|except|excluding) (?:the )?first (\d+)\b(?: \w+)?/g, make: m => [{ op: 'drop', k: I(m[1]) }] },
  { re: /\b(?:drop|skip|ignore|remove|discard|without|except|excluding) (?:the )?first (?:one|element|item|number|value)\b/g, make: () => [{ op: 'drop', k: 1 }] },
  { re: /\bfirst (\d+)\b/g, make: m => [{ op: 'take', k: I(m[1]) }] },
  { re: /\blast (\d+)\b/g, make: m => [{ op: 'reverse' }, { op: 'take', k: I(m[1]) }, { op: 'reverse' }] },
  { re: /\bsort(?:ed|s|ing)?\b[^,;.]*?\b(descending|decreasing|largest to smallest|biggest to smallest|highest to lowest|high to low|reverse order)\b/g, make: () => [{ op: 'sort', desc: true }] },
  { re: /\b(?:in )?(?:descending|decreasing) order\b/g, make: () => [{ op: 'sort', desc: true }] },
  { re: /\bsort(?:ed|s|ing)?\b(?:[^,;.]*?\b(?:ascending|increasing|smallest to largest|low to high)\b(?: order)?)?/g, make: () => [{ op: 'sort', desc: false }] },
  { re: /\b(?:in )?(?:ascending|increasing) order\b/g, make: () => [{ op: 'sort', desc: false }] },
  // ---- predicates with numbers (longest phrases first)
  { re: /\bbetween (-?\d+) and (-?\d+)(?: \(?(inclusive|exclusive)\)?)?/g, make: (m, b) => m[3] === 'exclusive'
      ? [...filt({ p: 'gt', k: I(m[1]) }, b)!, ...filt({ p: 'lt', k: I(m[2]) }, b)!]
      : [...filt({ p: 'ge', k: I(m[1]) }, b)!, ...filt({ p: 'le', k: I(m[2]) }, b)!] },
  { re: /\b(?:greater|larger|bigger|more) than or equal to (-?\d+)/g, make: (m, b) => filt({ p: 'ge', k: I(m[1]) }, b) },
  { re: /\b(?:less|smaller|fewer) than or equal to (-?\d+)/g, make: (m, b) => filt({ p: 'le', k: I(m[1]) }, b) },
  { re: /\b(?:at least|no less than|not less than|>=) ?(-?\d+)/g, make: (m, b) => filt({ p: 'ge', k: I(m[1]) }, b) },
  { re: /\b(?:at most|no more than|not more than|<=) ?(-?\d+)/g, make: (m, b) => filt({ p: 'le', k: I(m[1]) }, b) },
  { re: /\b(?:greater|larger|bigger|more|higher) than (-?\d+)|\b(?:above|exceed|exceeds|exceeding|over) (-?\d+)|> ?(-?\d+)/g, make: (m, b) => filt({ p: 'gt', k: I(m[1] ?? m[2] ?? m[3]) }, b) },
  { re: /\b(?:less|smaller|lower|fewer) than (-?\d+)|\b(?:below|under) (-?\d+)|< ?(-?\d+)/g, make: (m, b) => filt({ p: 'lt', k: I(m[1] ?? m[2] ?? m[3]) }, b) },
  { re: /\b(?:different from|not equal to|other than|unequal to|!=) ?(-?\d+)/g, make: (m, b) => filt({ p: 'ne', k: I(m[1]) }, b) },
  { re: /\b(?:equal to|equals?|equalling|==) ?(-?\d+)/g, make: (m, b) => filt({ p: 'eq', k: I(m[1]) }, b) },
  { re: /\b(?:divisible by|multiples? of) (\d+)((?: (?:and|or) (?:by )?\d+)*)/g, make: (m, b) => {
      const ks = [I(m[1]), ...[...(m[2] ?? '').matchAll(/\d+/g)].map(x => I(x[0]))];
      return ks.flatMap(k => filt({ p: 'div', k }, b) ?? []);
    } },
  // ---- terminals that would otherwise be read as maps
  { re: /\badd (?:them|these|those|it all|everything|the results|the numbers|the values)?\s*(?:up|together)\b|\badd up\b|\badd the results\b/g, make: () => 'sum' },
  { re: /\bmultiply (?:them|these|all of them|everything|the results)? ?together\b|\bmultiplication of\b/g, make: () => 'product' },
  // ---- maps with numbers
  { re: /\badd (-?\d+) to\b|\bincrease[^,;.]*? by (-?\d+)|\bplus (-?\d+)|\bx ?\+ ?(-?\d+)|\bincrement[^,;.]*? by (-?\d+)/g, make: m => [{ op: 'map', fn: { f: 'add', k: I(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) } }] },
  { re: /\bsubtract (-?\d+) from\b|\bdecrease[^,;.]*? by (-?\d+)|\bminus (-?\d+)|\bx ?- ?(\d+)|\bdecrement[^,;.]*? by (-?\d+)/g, make: m => [{ op: 'map', fn: { f: 'sub', k: I(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) } }] },
  { re: /\bmultipl(?:y|ied)[^,;.]*? by (-?\d+)|\btimes (-?\d+)|\bx ?\* ?(-?\d+)/g, make: m => [{ op: 'map', fn: { f: 'mul', k: I(m[1] ?? m[2] ?? m[3]) } }] },
  { re: /\bfloor[- ]?divi(?:de|ded|sion)?[^,;.]*? by (\d+)|\binteger[- ]divi(?:de|ded|sion)?[^,;.]*? by (\d+)|\/\/ ?(\d+)/g, make: m => [{ op: 'map', fn: { f: 'floordiv', k: I(m[1] ?? m[2] ?? m[3]) } }] },
  { re: /\b(?:remainder|modulo|mod) (?:of )?(?:division by |when divided by )?(\d+)|% ?(\d+)/g, make: m => [{ op: 'map', fn: { f: 'mod', k: I(m[1] ?? m[2]) } }] },
  // ---- maps without numbers
  { re: /\bdoubl(?:e|ed|es|ing)\b/g, make: () => [{ op: 'map', fn: { f: 'mul', k: 2 } }] },
  { re: /\btripl(?:e|ed|es|ing)\b/g, make: () => [{ op: 'map', fn: { f: 'mul', k: 3 } }] },
  { re: /\bhalv(?:e|ed|es|ing)\b/g, make: () => [{ op: 'map', fn: { f: 'floordiv', k: 2 } }] },
  { re: /\bsquar(?:e|ed|es|ing)\b/g, make: () => [{ op: 'map', fn: { f: 'square' } }] },
  { re: /\bnegat(?:e|ed|es|ing)\b|\b(?:flip|change|invert|reverse) the sign\b/g, make: () => [{ op: 'map', fn: { f: 'neg' } }] },
  { re: /\babsolute values?\b|\babs\b|\bmagnitudes?\b/g, make: () => [{ op: 'map', fn: { f: 'abs' } }] },
  // ---- predicates without numbers
  { re: /\bnon-?zero\b/g, make: (_m, b) => filt({ p: 'nonzero' }, b) },
  { re: /\bzero(?:e?s)?\b/g, make: (_m, b) => filt({ p: 'eq', k: 0 }, b) },
  { re: /\b(?:strictly )?positive\b/g, make: (_m, b) => filt({ p: 'pos' }, b) },
  { re: /\bnegative\b|\bless than zero\b|\bbelow zero\b/g, make: (_m, b) => filt({ p: 'neg' }, b) },
  { re: /\bevens?\b/g, make: (_m, b) => filt({ p: 'even' }, b) },
  { re: /\bodds?\b/g, make: (_m, b) => filt({ p: 'odd' }, b) },
  // ---- structure without numbers
  { re: /\b(?:remove|removing|drop|discard|without) (?:the )?(?:duplicates?|repeats?|repeated values|repetitions)\b(?:,? keeping the first occurrences?)?|\bunique\b|\bdistinct\b|\bdeduplicat\w*/g, make: () => [{ op: 'distinct' }] },
  { re: /\brevers(?:e|ed|es|ing)\b|\bbackwards?\b/g, make: () => [{ op: 'reverse' }] },
  // ---- terminals
  { re: /\b(?:sum|total|add up)\b/g, make: () => 'sum' },
  { re: /\bproduct\b/g, make: () => 'product' },
  { re: /\bhow many\b|\bcount\b|\bnumber of\b|\btally\b|\blength of\b|\bsize of\b/g, make: () => 'count' },
  { re: /\b(?:largest|maximum|max|biggest|greatest|highest)\b/g, make: () => 'max' },
  { re: /\b(?:smallest|minimum|min|lowest)\b/g, make: () => 'min' },
  { re: /\bfirst\b/g, make: () => 'first' },
  { re: /\b(?:last|final)\b/g, make: () => 'last' },
  { re: /\b(?:resulting |new |the |as a )list\b|\blist of (?:results|values)\b/g, make: () => 'list' },
];

export function extract(text: string): Extraction {
  const t = normalize(text);
  const taken = new Array<boolean>(t.length).fill(false);
  const fragments: Fragment[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(t); m; m = rule.re.exec(t)) {
      const s = m.index, e = s + m[0].length;
      if (m[0].length === 0) { rule.re.lastIndex++; continue; }
      let free = true;
      for (let i = s; i < e; i++) if (taken[i]) { free = false; break; }
      if (!free) continue;
      const made = rule.make(m, t.slice(0, s));
      if (made === null) continue;
      for (let i = s; i < e; i++) taken[i] = true;
      if (typeof made === 'string') fragments.push({ kind: 'terminal', terminal: made, at: s, text: m[0].trim() });
      else fragments.push({ kind: 'stage', stages: made, at: s, text: m[0].trim() });
    }
  }
  fragments.sort((a, b) => a.at - b.at);
  return { fragments, normalized: t.trim() };
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  const out: T[][] = [];
  xs.forEach((x, i) => { for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]); });
  return out;
}

export type Candidate = { program: Pipeline; displacement: number };
export type CandidateSet = { candidates: Candidate[]; extraction: Extraction; refusal: string | null };

/** All admissible, well-typed readings of the request; textual order first. */
export function candidates(text: string, want: RetType | null, maxGroups = 5): CandidateSet {
  const extraction = extract(text);
  // Repeated fragments are kept ("negate, then negate" is two stages). A deduplicated
  // variant is also offered (synonymous restatements, e.g. "odd ... discarding the evens").
  const groups: Stage[][] = extraction.fragments.flatMap(f => (f.kind === 'stage' ? [f.stages] : []));
  const seen = new Set<string>();
  const deduped = groups.filter(g => { const k = JSON.stringify(g); if (seen.has(k)) return false; seen.add(k); return true; });
  const variants = deduped.length < groups.length ? [groups, deduped] : [groups];
  let terms = [...new Set(extraction.fragments.filter(f => f.kind === 'terminal').map(f => (f as { terminal: Terminal }).terminal))];
  if (want) terms = terms.filter(t => terminalType(t) === want);
  if (!terms.length && want === 'list[int]') terms = ['list'];
  if (!terms.length) return { candidates: [], extraction, refusal: groups.length ? 'no_terminal_matching_declared_type' : 'nothing_recognized' };
  if (groups.length > maxGroups) return { candidates: [], extraction, refusal: 'too_many_fragments' };
  const out: Candidate[] = [];
  const keys = new Set<string>();
  variants.forEach((gs, variant) => {
    for (const term of terms) for (const perm of permutations(gs.map((g, i) => ({ g, i })))) {
      const program: Pipeline = { stages: perm.flatMap(x => x.g), terminal: term };
      const key = JSON.stringify(program);
      if (keys.has(key) || typecheck(program, want).length) continue;
      keys.add(key);
      const displacement = perm.reduce((acc, x, pos) => acc + Math.abs(x.i - pos), 0) + variant;
      out.push({ program, displacement });
    }
  });
  return { candidates: out, extraction, refusal: out.length ? null : 'no_admissible_reading' };
}
