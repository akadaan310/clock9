#!/usr/bin/env python3
"""Run untrusted generated Python against tests, isolated from this host.

Isolation (Linux): the caller launches this file under `unshare --net --mount`
(no network; private mount namespace in which every world-writable directory is
covered by a read-only empty tmpfs, so the candidate cannot create files); each candidate then runs in a fresh child process as uid/gid
65534 (nobody) in an empty temp dir with a cleared environment and rlimits:
CPU 5 s, address space 1 GiB, file size 0 (no file writes), 64 fds, 32 procs, wall 10 s.
This is a research sandbox, not a hardened jail (no seccomp; /proc and readable
system files remain visible).

stdin JSON:  {"mode": "io", "code": str, "tests": [{"input": [...], "output": ...}]}
         or  {"mode": "humaneval", "program": str}
stdout JSON: {"pass": bool, "passed": int, "total": int, "error": str|None, "ms": float}
"""
import json
import os
import resource
import subprocess
import sys
import time

RUNNER_IO = r'''
import json, sys
spec = json.loads(sys.stdin.read())
ns = {}
try:
    exec(compile(spec["code"], "<candidate>", "exec"), ns)
    f = ns["solve"]
except BaseException as e:
    print(json.dumps({"fatal": type(e).__name__ + ": " + str(e)[:200]})); sys.exit(0)
def same(a, b):
    if isinstance(b, bool) or isinstance(a, bool):
        return type(a) is type(b) and a == b
    if isinstance(b, float) or isinstance(a, float):
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) <= 1e-9
    if isinstance(b, list):
        return isinstance(a, (list, tuple)) and len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b
out = []
for t in spec["tests"]:
    try:
        out.append(bool(same(f(list(t["input"])), t["output"])))
    except BaseException as e:
        out.append(type(e).__name__)
print(json.dumps({"results": out}))
'''

def limits():
    os.setsid()
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    if os.getuid() == 0:
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
    resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))

def run_child(args, stdin_text, cwd):
    return subprocess.run(
        [sys.executable, "-I", "-S", *args], input=stdin_text, capture_output=True, text=True,
        cwd=cwd, env={"PATH": "/usr/bin:/bin", "PYTHONHASHSEED": "0"}, timeout=10, preexec_fn=limits,
    )

WORLD_WRITABLE = ["/tmp", "/var/tmp", "/dev/shm", "/run/lock", "/var/lib/php/sessions"]

def seal_filesystem():
    """Inside a private mount namespace (root only): hide world-writable dirs."""
    if os.getuid() != 0:
        return
    subprocess.run(["mount", "--make-rprivate", "/"], check=False, capture_output=True)
    for d in WORLD_WRITABLE:
        if os.path.isdir(d):
            subprocess.run(["mount", "-t", "tmpfs", "-o", "ro,size=4k,mode=755", "none", d], check=False, capture_output=True)

def main():
    spec = json.loads(sys.stdin.read())
    seal_filesystem()
    t0 = time.perf_counter()
    d = "/tmp"  # empty, read-only tmpfs after sealing
    if True:
        try:
            if spec["mode"] == "io":
                p = run_child(["-c", RUNNER_IO], json.dumps({"code": spec["code"], "tests": spec["tests"]}), d)
                try:
                    r = json.loads(p.stdout.strip().splitlines()[-1])
                except Exception:
                    r = {"fatal": ("no result; stderr=" + p.stderr[-200:]) if p.returncode else "no result"}
                if "fatal" in r:
                    res = {"pass": False, "passed": 0, "total": len(spec["tests"]), "error": r["fatal"]}
                else:
                    ok = [x is True for x in r["results"]]
                    errs = [x for x in r["results"] if x is not True and x is not False]
                    res = {"pass": all(ok) and len(ok) == len(spec["tests"]), "passed": sum(ok),
                           "total": len(spec["tests"]), "error": errs[0] if errs else None}
            else:  # humaneval: program contains candidate + test + check(entry_point)
                p = run_child(["-c", spec["program"]], "", d)
                res = {"pass": p.returncode == 0, "passed": int(p.returncode == 0), "total": 1,
                       "error": None if p.returncode == 0 else (p.stderr.strip().splitlines() or ["exit %d" % p.returncode])[-1][:200]}
        except subprocess.TimeoutExpired:
            res = {"pass": False, "passed": 0, "total": len(spec.get("tests", [1])), "error": "timeout"}
    res["ms"] = (time.perf_counter() - t0) * 1000
    print(json.dumps(res))

if __name__ == "__main__":
    main()
