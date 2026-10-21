#!/usr/bin/env python3
"""Build the frozen CLOCK9 code-task suite ("ListOps").

Every task asks for `def solve(xs: list[int])`. Expected outputs are computed by
`reference_eval` below: an independent Python implementation of the ListOps
semantics (the TypeScript compiler under src/ is NOT used to make tests).

Splits
  train : template-generated; the ONLY split the parser / n-gram / few-shot
          retrieval may be developed or trained on.
  id    : held-out instances from the same templates (new parameters).
  para  : held-out hand-written paraphrases (different phrasing, word order).
  oog   : out-of-grammar tasks the ListOps DSL cannot express; hand-written
          reference solutions. A correct symbolic system must refuse these.

Each task has 2 visible examples (shown to every arm, neural or symbolic) and
hidden tests (used only for scoring). Run: python3 -I tasks/build_tasks.py
"""
import hashlib
import json
import random
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "listops.jsonl"

# ---------------------------------------------------------------- semantics
def pred(p, x):
    k = p.get("k")
    return {
        "even": lambda: x % 2 == 0, "odd": lambda: x % 2 != 0,
        "pos": lambda: x > 0, "neg": lambda: x < 0, "nonzero": lambda: x != 0,
        "gt": lambda: x > k, "lt": lambda: x < k, "ge": lambda: x >= k,
        "le": lambda: x <= k, "eq": lambda: x == k, "ne": lambda: x != k,
        "div": lambda: x % k == 0,
    }[p["p"]]()

def fn(f, x):
    k = f.get("k")
    return {
        "add": lambda: x + k, "sub": lambda: x - k, "mul": lambda: x * k,
        "mod": lambda: x % k, "floordiv": lambda: x // k,
        "square": lambda: x * x, "neg": lambda: -x, "abs": lambda: abs(x),
    }[f["f"]]()

def reference_eval(ast, xs):
    v = list(xs)
    for s in ast["stages"]:
        op = s["op"]
        if op == "filter": v = [x for x in v if pred(s["pred"], x)]
        elif op == "map": v = [fn(s["fn"], x) for x in v]
        elif op == "sort": v = sorted(v, reverse=s.get("desc", False))
        elif op == "take": v = v[: s["k"]]
        elif op == "drop": v = v[s["k"]:]
        elif op == "reverse": v = v[::-1]
        elif op == "distinct":
            seen, out = set(), []
            for x in v:
                if x not in seen: seen.add(x); out.append(x)
            v = out
        else: raise ValueError(op)
    t = ast["terminal"]
    if t == "list": return v
    if t == "sum": return sum(v)
    if t == "product":
        r = 1
        for x in v: r *= x
        return r
    if t == "count": return len(v)
    if t == "max": return max(v) if v else None
    if t == "min": return min(v) if v else None
    if t == "first": return v[0] if v else None
    if t == "last": return v[-1] if v else None
    raise ValueError(t)

RET = {"list": "list[int]", "sum": "int", "product": "int", "count": "int",
       "max": "int | None", "min": "int | None", "first": "int | None", "last": "int | None"}

# ---------------------------------------------------------------- inputs
def gen_inputs(rng, n):
    fixed = [[], [0], [-3, 3], [5, 5, -2, 8, 1], [-10, -7, 4, 9, 2, 2, 6, -1]]
    out = [list(x) for x in fixed]
    while len(out) < n:
        out.append([rng.randint(-10, 10) for _ in range(rng.randint(0, 8))])
    return out

def visible_inputs(rng):
    return [[rng.randint(-9, 9) for _ in range(rng.randint(4, 7))] for _ in range(2)]

# ---------------------------------------------------------------- train templates
FILTER_T = {
    "even": "keep only the even numbers", "odd": "keep only the odd numbers",
    "pos": "keep only the positive numbers", "neg": "keep only the negative numbers",
    "nonzero": "remove the zeros", "gt": "keep only numbers greater than {k}",
    "lt": "keep only numbers less than {k}", "ge": "keep only numbers greater than or equal to {k}",
    "le": "keep only numbers less than or equal to {k}", "eq": "keep only numbers equal to {k}",
    "ne": "remove every number equal to {k}", "div": "keep only numbers divisible by {k}",
}
MAP_T = {
    "add": "add {k} to each number", "sub": "subtract {k} from each number",
    "mul": "multiply each number by {k}", "mod": "replace each number by its remainder modulo {k}",
    "floordiv": "floor-divide each number by {k}", "square": "square each number",
    "neg": "negate each number", "abs": "take the absolute value of each number",
}
TERM_T = {
    "list": "return the resulting list", "sum": "return the sum",
    "product": "return the product", "count": "return how many numbers remain",
    "max": "return the largest number (or None if there are none)",
    "min": "return the smallest number (or None if there are none)",
    "first": "return the first number (or None if there are none)",
    "last": "return the last number (or None if there are none)",
}

def rand_stage(rng):
    r = rng.random()
    if r < 0.4:
        p = rng.choice(list(FILTER_T))
        d = {"p": p}
        if p == "div": d["k"] = rng.randint(2, 5)
        elif p in ("gt", "lt", "ge", "le", "eq", "ne"): d["k"] = rng.randint(-3, 5)
        return {"op": "filter", "pred": d}
    if r < 0.8:
        f = rng.choice(list(MAP_T))
        d = {"f": f}
        if f in ("mod", "floordiv"): d["k"] = rng.randint(2, 5)
        elif f in ("add", "sub", "mul"): d["k"] = rng.randint(2, 9)
        return {"op": "map", "fn": d}
    r2 = rng.random()
    if r2 < 0.3: return {"op": "sort", "desc": rng.random() < 0.4}
    if r2 < 0.55: return {"op": "take", "k": rng.randint(1, 4)}
    if r2 < 0.75: return {"op": "drop", "k": rng.randint(1, 3)}
    if r2 < 0.88: return {"op": "reverse"}
    return {"op": "distinct"}

def stage_text(s):
    op = s["op"]
    if op == "filter": return FILTER_T[s["pred"]["p"]].format(k=s["pred"].get("k"))
    if op == "map": return MAP_T[s["fn"]["f"]].format(k=s["fn"].get("k"))
    if op == "sort": return "sort the numbers in descending order" if s.get("desc") else "sort the numbers in ascending order"
    if op == "take": return f"keep only the first {s['k']} numbers"
    if op == "drop": return f"drop the first {s['k']} numbers"
    if op == "reverse": return "reverse the order"
    if op == "distinct": return "remove duplicates, keeping the first occurrence"

def template_prompt(ast):
    steps = [stage_text(s) for s in ast["stages"]]
    body = ", then ".join(steps)
    return f"Given a list of integers xs, {body}, and {TERM_T[ast['terminal']]}."

# ---------------------------------------------------------------- held-out paraphrases (hand-written)
F = lambda p, k=None: {"op": "filter", "pred": {"p": p, **({"k": k} if k is not None else {})}}
M = lambda f, k=None: {"op": "map", "fn": {"f": f, **({"k": k} if k is not None else {})}}
A = lambda term, *st: {"stages": list(st), "terminal": term}
PARA = [
    ("Compute the total of the squares of all even entries in xs.", A("sum", F("even"), M("square"))),
    ("How many elements of xs are strictly positive?", A("count", F("pos"))),
    ("Return the biggest odd value in xs, or None when xs has no odd values.", A("max", F("odd"))),
    ("Double every element of xs and give back the new list.", A("list", M("mul", 2))),
    ("Sum up the numbers in xs that exceed 3.", A("sum", F("gt", 3))),
    ("Give me the list of xs's negative values, each made positive.", A("list", F("neg"), M("abs"))),
    ("Return xs sorted from largest to smallest.", A("list", {"op": "sort", "desc": True})),
    ("What is the product of the nonzero items in xs?", A("product", F("nonzero"))),
    ("Return the smallest number among those in xs that are multiples of 3, or None if none are.", A("min", F("div", 3))),
    ("Increase each value by 5, then keep the ones above 7, and count them.", A("count", M("add", 5), F("gt", 7))),
    ("Return the last element of xs after sorting it ascending, or None for an empty list.", A("last", {"op": "sort", "desc": False})),
    ("Produce the unique values of xs in order of first appearance.", A("list", {"op": "distinct"})),
    ("Add together the first three items of xs.", A("sum", {"op": "take", "k": 3})),
    ("Ignore the first two numbers of xs and return the sum of what is left.", A("sum", {"op": "drop", "k": 2})),
    ("Return xs backwards.", A("list", {"op": "reverse"})),
    ("For each x in xs compute x mod 4; return the list of results.", A("list", M("mod", 4))),
    ("Tally the entries of xs that equal 2.", A("count", F("eq", 2))),
    ("Return the sum of the absolute values of xs.", A("sum", M("abs"))),
    ("Subtract 1 from every number, drop anything negative, and return what remains.", A("list", M("sub", 1), F("ge", 0))),
    ("Find the maximum of the squares of xs, or None if xs is empty.", A("max", M("square"))),
    ("Return the first number in xs that is at most -2, or None if there is no such number.", A("first", F("le", -2))),
    ("Triple each odd number in xs (discarding the evens) and return their total.", A("sum", F("odd"), M("mul", 3))),
    ("Return the number of distinct values in xs.", A("count", {"op": "distinct"})),
    ("Flip the sign of every element and then sort ascending; return the list.", A("list", M("neg"), {"op": "sort", "desc": False})),
    ("Return the two largest values of xs in descending order (fewer if xs is short).", A("list", {"op": "sort", "desc": True}, {"op": "take", "k": 2})),
    ("Halve each number using integer floor division and add the results.", A("sum", M("floordiv", 2))),
    ("Return the multiplication of all items of xs that are less than zero.", A("product", F("lt", 0))),
    ("Filter xs down to values different from 0 and different from 1, then return the list.", A("list", F("nonzero"), F("ne", 1))),
    ("Give the final element among the even numbers of xs, or None.", A("last", F("even"))),
    ("What do you get if you add 2 to each number of xs and then multiply each by 3? Return the list.", A("list", M("add", 2), M("mul", 3))),
    ("Return how many numbers in xs are between 1 and 5 inclusive.", A("count", F("ge", 1), F("le", 5))),
    ("Square the elements, remove repeats, and return the list in ascending order.", A("list", M("square"), {"op": "distinct"}, {"op": "sort", "desc": False})),
    ("Return the minimum of xs, or None if xs is empty.", A("min")),
    ("Compute the sum of xs after replacing each element x by x - 4.", A("sum", M("sub", 4))),
    ("Keep the elements of xs that are divisible by 2 and by 3, and return them as a list.", A("list", F("div", 2), F("div", 3))),
    ("Return the sum of the last three elements of xs.", None),  # OOG-ish phrasing: not expressible without reverse; filled below
    ("Return the length of xs.", A("count")),
    ("Return every element of xs except the first one, in reverse order.", A("list", {"op": "drop", "k": 1}, {"op": "reverse"})),
    ("Take the odd values of xs, subtract 1 from each, and return the largest result or None.", A("max", F("odd"), M("sub", 1))),
    ("Return the product of (x + 1) over all x in xs.", A("product", M("add", 1))),
]
# "sum of the last three" is expressible as reverse -> take 3 -> sum; keep it as a harder paraphrase.
PARA[35] = (PARA[35][0], A("sum", {"op": "reverse"}, {"op": "take", "k": 3}))

# ---------------------------------------------------------------- out-of-grammar (hand-written refs)
OOG = [
    ("Return True if xs reads the same forwards and backwards, else False.", "bool",
     "def solve(xs):\n    return xs == xs[::-1]"),
    ("Return the list of running prefix sums of xs.", "list[int]",
     "def solve(xs):\n    out, s = [], 0\n    for x in xs:\n        s += x\n        out.append(s)\n    return out"),
    ("Return the second largest distinct value in xs, or None if there are fewer than two distinct values.", "int | None",
     "def solve(xs):\n    u = sorted(set(xs))\n    return u[-2] if len(u) >= 2 else None"),
    ("Return the length of the longest strictly increasing contiguous run in xs (0 for empty).", "int",
     "def solve(xs):\n    best = cur = 0\n    for i, x in enumerate(xs):\n        cur = cur + 1 if i and x > xs[i-1] else 1\n        best = max(best, cur)\n    return best"),
    ("Count pairs of indices i < j with xs[i] + xs[j] == 0.", "int",
     "def solve(xs):\n    return sum(1 for i in range(len(xs)) for j in range(i+1, len(xs)) if xs[i] + xs[j] == 0)"),
    ("Rotate xs left by 2 positions (for lists shorter than 2, rotate by len modulo) and return it.", "list[int]",
     "def solve(xs):\n    if not xs:\n        return []\n    k = 2 % len(xs)\n    return xs[k:] + xs[:k]"),
    ("Return the list of differences between consecutive elements (xs[i+1]-xs[i]).", "list[int]",
     "def solve(xs):\n    return [xs[i+1] - xs[i] for i in range(len(xs) - 1)]"),
    ("Return the index of the first maximum element of xs, or -1 if xs is empty.", "int",
     "def solve(xs):\n    return xs.index(max(xs)) if xs else -1"),
    ("Return the most frequent value in xs (smallest value on ties), or None if xs is empty.", "int | None",
     "def solve(xs):\n    if not xs:\n        return None\n    c = {}\n    for x in xs:\n        c[x] = c.get(x, 0) + 1\n    m = max(c.values())\n    return min(v for v in c if c[v] == m)"),
    ("Return True if xs is sorted in non-decreasing order, else False.", "bool",
     "def solve(xs):\n    return all(xs[i] <= xs[i+1] for i in range(len(xs) - 1))"),
    ("Return the sum of elements at even indices (0, 2, 4, ...).", "int",
     "def solve(xs):\n    return sum(xs[0::2])"),
    ("Return the elements of xs that are larger than every element before them.", "list[int]",
     "def solve(xs):\n    out = []\n    for x in xs:\n        if not out or x > out[-1]:\n            out.append(x)\n    return out"),
    ("Return the maximum sum of any contiguous non-empty sublist of xs, or 0 if xs is empty.", "int",
     "def solve(xs):\n    if not xs:\n        return 0\n    best = cur = xs[0]\n    for x in xs[1:]:\n        cur = max(x, cur + x)\n        best = max(best, cur)\n    return best"),
    ("Return xs with each element replaced by the number of elements in xs strictly smaller than it.", "list[int]",
     "def solve(xs):\n    return [sum(1 for y in xs if y < x) for x in xs]"),
    ("Interleave the first half and second half of xs (first half gets the extra element when odd).", "list[int]",
     "def solve(xs):\n    h = (len(xs) + 1) // 2\n    a, b = xs[:h], xs[h:]\n    out = []\n    for i in range(h):\n        out.append(a[i])\n        if i < len(b):\n            out.append(b[i])\n    return out"),
    ("Return the number of times the sign changes between consecutive nonzero elements of xs.", "int",
     "def solve(xs):\n    nz = [x for x in xs if x != 0]\n    return sum(1 for i in range(len(nz) - 1) if (nz[i] > 0) != (nz[i+1] > 0))"),
    ("Return the median of xs as a float (mean of the two middle values when even), or None if empty.", "float | None",
     "def solve(xs):\n    if not xs:\n        return None\n    s = sorted(xs)\n    n = len(s)\n    return float(s[n//2]) if n % 2 else (s[n//2 - 1] + s[n//2]) / 2"),
    ("Return the list of indices where xs has a negative value.", "list[int]",
     "def solve(xs):\n    return [i for i, x in enumerate(xs) if x < 0]"),
    ("Return xs with consecutive duplicate values collapsed to one.", "list[int]",
     "def solve(xs):\n    out = []\n    for x in xs:\n        if not out or out[-1] != x:\n            out.append(x)\n    return out"),
    ("Return the alternating sum xs[0] - xs[1] + xs[2] - ...", "int",
     "def solve(xs):\n    return sum(x if i % 2 == 0 else -x for i, x in enumerate(xs))"),
]

def mk(task_id, split, prompt, ast, rng, ret=None, ref_src=None):
    hidden_in = gen_inputs(rng, 25)
    vis_in = visible_inputs(rng)
    if ast is not None:
        f = lambda xs: reference_eval(ast, xs)
        ret = RET[ast["terminal"]]
    else:
        ns = {}
        exec(ref_src, ns)  # trusted, hand-written reference solutions in this file
        f = ns["solve"]
    return {
        "id": task_id, "split": split, "prompt": prompt,
        "signature": f"def solve(xs: list[int]) -> {ret}:",
        "visible": [{"input": x, "output": f(list(x))} for x in vis_in],
        "hidden": [{"input": x, "output": f(list(x))} for x in hidden_in],
        "ast": ast, "reference_python": ref_src,
    }

def main():
    rng = random.Random(9009)
    tasks = []
    seen = set()
    def unique_ast():
        while True:
            n = rng.choice([1, 2, 2, 3])
            ast = {"stages": [rand_stage(rng) for _ in range(n)],
                   "terminal": rng.choice(list(TERM_T))}
            key = json.dumps(ast, sort_keys=True)
            if key not in seen:
                seen.add(key)
                return ast
    for i in range(60):
        ast = unique_ast(); tasks.append(mk(f"train-{i:03d}", "train", template_prompt(ast), ast, rng))
    for i in range(40):
        ast = unique_ast(); tasks.append(mk(f"id-{i:03d}", "id", template_prompt(ast), ast, rng))
    for i, (p, ast) in enumerate(PARA):
        tasks.append(mk(f"para-{i:03d}", "para", p, ast, rng))
    for i, (p, ret, src) in enumerate(OOG):
        tasks.append(mk(f"oog-{i:03d}", "oog", p, None, rng, ret=ret, ref_src=src))
    lines = [json.dumps(t, sort_keys=True) for t in tasks]
    OUT.write_text("\n".join(lines) + "\n")
    digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
    counts = {}
    for t in tasks: counts[t["split"]] = counts.get(t["split"], 0) + 1
    print(json.dumps({"file": OUT.name, "sha256": digest, "counts": counts}))

if __name__ == "__main__":
    sys.exit(main())
