# CLOCK9 / 9LM — grammar-clocked hybrid generation (research lane, edition 0.2)

An experimental Substrate University research lane. CLOCK9 is **not** a newly
trained language model. It combines:

- a **typed grammar** for a small code domain (ListOps: `solve(xs: list[int])`
  list pipelines) and a **text grammar** over the university's public glossary;
- **variable-order backoff n-grams** for ranking and retrieval;
- **certified reusable operations** (macros promoted only from independently
  verified programs, with exact fold/unfold);
- **optional real open-weight models** (Qwen2.5-Coder 0.5B / 1.5B Q4_K_M through
  a local `llama-server`), consulted only when the grammar cannot admit a program;
- **independent executable verification** (generated Python runs in a
  network-less, unprivileged, rlimited sandbox).

Every step is a recorded *beat* (`context → retrieve → draft → admit → compile →
verify → promote`, or `escalate` / `refuse`) that states which component produced
it: grammar, n-gram, cache, neural, tool, macro or fallback.

**Results, including the negative ones, are in [`research-matrix.md`](research-matrix.md).**

## Layout

| path | contents |
|---|---|
| `src/` | browser-safe core (no Node APIs, no network): `listops/` grammar + compiler + request parser + macros, `ngram.ts`, `clock.ts`, `solver.ts`, `text/glossary.ts`, `address.ts`, `router.ts`, `neural/adapter.ts` (interface only) |
| `harness/` | Node-only: `llama.ts` (real llama.cpp adapter + RSS/CPU metering), `sandbox.py` + `executor.ts`, `eval.ts` (arms B0–B6), `infer_bench.ts` (S4), `determinism.ts`, `demo.ts`, `make_blind.ts` |
| `tasks/` | frozen task suites + manifest with hashes; glossary snapshot |
| `results/` | raw logs and JSON for every stage (s0, s4, s5, demo, browser) |
| `web/index.html` | minimal in-browser research console (symbolic only) |
| `prototype/v0.1/` | the original CLOCK9/0.1 kernel, unchanged (22 checks) |
| `docs/` | `RESEARCH_BLUEPRINT.md`, `CLAUDE_CODE_EXPERIMENT.md` (the brief) |

## Reproduce

```sh
npm ci
npm test                 # 56 checks (core + sandbox integration)
npm run test:v01         # the original 22 checks (needs `npm i` in prototype/v0.1)
npm run demo             # writes results/demo/*

# Optional neural arms (local only; nothing is sent anywhere):
#  llama.cpp d454a204 built with: cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON -DLLAMA_CURL=OFF
#  models (sha256 in results/s4/versions.txt):
#   Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF @ebb2015 qwen2.5-coder-0.5b-instruct-q4_k_m.gguf
#   Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF @f86cb2c qwen2.5-coder-1.5b-instruct-q4_k_m.gguf
export LLAMA_BIN=/path/to/llama.cpp/build/bin CLOCK9_MODELS=/path/to/models
node dist/harness/infer_bench.js --n 20                                  # S4
node dist/harness/eval.js --suite listops                               # S5, all arms
node dist/harness/eval.js --suite humaneval --arms B1-0.5,B1-1.5,B3,C1  # S5, HumanEval
```

The sandbox requires Linux with `unshare` and root (it drops to uid 65534); it is
a research sandbox (namespaces + rlimits), not a hardened jail.

## Boundaries

- ListOps is a DSL chosen by the same agent that wrote the parser and most tasks;
  in-domain numbers measure coverage of that DSL, not general coding ability.
  HumanEval and the blind model-paraphrased split are the less biased checks.
- `clock9://` is a local experimental address syntax, not PURL/SEURL and not a
  registered scheme; its checksum is not a security mechanism.
- All timings are from one 4-vCPU x86 cloud VM (AVX-512), CPU only. Nothing here
  is an Android or phone measurement.
- Models: Apache-2.0 (Qwen2.5-Coder). HumanEval: MIT. Glossary text © its authors,
  quoted from the public Substrate University repository at a pinned commit.
