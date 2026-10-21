/** HumanEval prompt, program assembly and visible-example (docstring) checks. */
import type { HumanEvalTask } from './tasks.js';

export const heUser = (t: HumanEvalTask) => `Complete the following Python function. Reply with a single \`\`\`python code block containing the complete function.\n\n\`\`\`python\n${t.prompt}\`\`\``;
export function heProgram(t: HumanEvalTask, code: string): string {
  const header = t.prompt.split('\n').filter(l => /^(from|import)\s/.test(l)).join('\n');
  const body = new RegExp(`def\\s+${t.entry_point}\\s*\\(`).test(code) ? `${header}\n${code}` : `${t.prompt}${code}`;
  return body;
}
/** Visible checks = examples written in the prompt's docstring (doctest `>>>` or `f(..) ==> / ➞ / => / == x`).
 * Parsed generically (no per-task rules); never filtered against reference solutions. */
const clean = (x: string) => x.replace(/\s+#.*$/, '').trim().replace(/[.,;]$/, '');
export function heVisible(t: HumanEvalTask): { expr: string; want: string }[] {
  const out: { expr: string; want: string }[] = [];
  const lines = t.prompt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]!.trim();
    const d = /^>>>\s*(.+)$/.exec(L);
    if (d) {
      const w = (lines[i + 1] ?? '').trim();
      const expr = clean(d[1]!);
      if (w && !w.startsWith('>>>') && !w.startsWith('"""') && !w.startsWith("'''")) out.push({ expr, want: clean(w) });
      else if (/[^=!<>]==[^=]/.test(expr)) out.push({ expr, want: 'True' });
      continue;
    }
    if (/^(?:async\s+)?def\s/.test(L)) continue; // the signature's `-> T` is not an example
    const e = new RegExp(`(${t.entry_point}\\(.*\\))\\s*(?:==>|=>|->|➞|==|returns|should return|should be)\\s*(.+?)\\s*$`).exec(L);
    if (e) {
      let want = clean(e[2]!);
      const eq = /^[^=]*[^=!<>]=([^=].*)$/.exec(want); // "19 - 5 - 6 = 8" -> "8"
      if (eq) want = eq[1]!.trim();
      out.push({ expr: clean(e[1]!), want });
    }
  }
  return out;
}
/** Each check is eval'd separately: a check whose expected value does not parse/evaluate is
 * skipped (no evidence); an exception in the candidate's call counts as a failure. */
export function heVisibleProgram(t: HumanEvalTask, code: string): string | null {
  const v = heVisible(t);
  if (!v.length) return null;
  const checks = v.map(x => `(${JSON.stringify(x.expr)}, ${JSON.stringify(x.want)})`).join(',\n    ');
  return `${heProgram(t, code)}\n\nimport sys as __s\n__g = dict(globals())\n__n = __ok = 0\nfor __e, __w in [\n    ${checks}\n]:\n    try:\n        compile(__e, '<visible>', 'eval')\n        __wv = eval(__w, __g)\n    except Exception:\n        continue\n    __n += 1\n    try:\n        __ok += (eval(__e, __g) == __wv)\n    except Exception:\n        pass\nif __n == 0:\n    print('NOEVIDENCE', file=__s.stderr); __s.exit(3)\nassert __ok == __n, f'{__ok}/{__n} visible'\n`;
}
