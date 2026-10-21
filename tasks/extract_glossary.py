#!/usr/bin/env python3
"""Snapshot Substrate University's public glossary as data (the TS is parsed, never run).
usage: python3 -I tasks/extract_glossary.py <abedkadaancom checkout> <commit>"""
import json, re, sys, hashlib
root, commit = sys.argv[1], sys.argv[2]
src = open(f"{root}/src/content/glossary.ts", encoding="utf8").read()
labels = dict(re.findall(r"^\s+(\w+): '([^']+)',$", src[src.index("DOMAIN_LABELS"):src.index("export interface Sense")], re.M))
STR = r"'((?:[^'\\]|\\.)*)'"
unq = lambda s: s.encode().decode("unicode_escape").encode("latin-1").decode("utf8") if "\\" in s else s
terms = []
body = src[src.index("export const TERMS"):]
for m in re.finditer(r"\{ id: " + STR + r", term: " + STR + r", related: \[([^\]]*)\]", body):
    start = m.end()
    end = body.find("] },", start)
    chunk = body[start:end]
    line = src[:src.index("export const TERMS")].count("\n") + body[:m.start()].count("\n") + 1
    senses = []
    for s in re.finditer(r"s\(" + STR + r",\s*" + STR + r"(?:,\s*" + STR + r")?(?:,\s*" + STR + r")?\)", chunk):
        senses.append({"domain": s.group(1), "domainLabel": labels.get(s.group(1), s.group(1)), "text": unq(s.group(2)),
                       "status": s.group(3) or "established", "topic": s.group(4)})
    related = re.findall(STR, m.group(3))
    terms.append({"id": unq(m.group(1)), "term": unq(m.group(2)), "related": related, "senses": senses, "line": line})
snap = {"source": "https://github.com/akadaan310/abedkadaancom/blob/%s/src/content/glossary.ts" % commit,
        "commit": commit, "terms": terms}
data = json.dumps(snap, ensure_ascii=False, indent=1, sort_keys=True)
open("tasks/glossary_snapshot.json", "w", encoding="utf8").write(data + "\n")
print(len(terms), "terms", sum(len(t["senses"]) for t in terms), "senses", "sha256", hashlib.sha256((data + "\n").encode()).hexdigest())
