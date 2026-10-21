# CLOCK9/0.2 research matrix — measured results

Checkpoint of the first session of the CLOCK9 / 9LM lane (2026-10-21). Every number
below was measured in this repository on one host, and each links to its raw file.
Proposals and measurements are kept apart, and negative results are kept.

**Host.** 4 vCPU Intel Xeon @ 2.1 GHz (AVX-512, AVX-VNNI), 15 GiB RAM, no GPU, Linux 6.18
cloud VM ([`results/s0/machine.txt`](results/s0/machine.txt)). Node 22.22, TypeScript 5.6.3,
Python 3.13. llama.cpp `d454a204` (CPU, `GGML_NATIVE=ON`) — [`results/s4/versions.txt`](results/s4/versions.txt).
Run-to-run variance on this shared VM is visible: 1.5B decode at depth 0 measured 15.5 tok/s in
one session and 20.7 in another. Compare arms only within the same run/table.

**Models (real weights, real inference; nothing simulated)**

| model | source (pinned revision) | file sha256 | licence | file size | peak RSS served (ctx 4096) |
|---|---|---|---|---|---|
| Qwen2.5-Coder-0.5B-Instruct Q4_K_M | `Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF@ebb2015` | `1d9614638d18…4ff32` | Apache-2.0 | 491 MB | 764–1491 MiB |
| Qwen2.5-Coder-1.5B-Instruct Q4_K_M | `Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF@f86cb2c` | `cc324af070c2…bb046` | Apache-2.0 | 1117 MB | 2086–3688 MiB |
| 1.5B target + 0.5B draft (one process) | — | — | — | — | 2751–4995 MiB |

Peak RSS is the process's VmHWM. It grows over a long run (KV cache, compute buffers,
mmap residency), so weight-file size is not peak inference RAM. Qwen3-0.6B and SmolLM2-360M
were **not** run in this session.

## Stage status

| stage | status | evidence |
|---|---|---|
| S0 baseline | **done.** v0.1 unchanged: 22/22 checks, demo, bench (0.030 ms/proposal mean, ~33k proposals/s; tiny DSL only) | [`results/s0`](results/s0) |
| S1 two grammars | **done.** Code: typed ListOps grammar plus English request grammar (parser v1.0, frozen before held-out scoring). Text: glossary grammar over a commit-pinned snapshot of the public Substrate University glossary (93 terms, 137 senses). Records carry grammar version, n-gram corpus hash and derivation. Held-out text/code routing 10/10 + 10/10 | `src/listops`, `src/text`, [`tasks/glossary_snapshot.json`](tasks/glossary_snapshot.json) |
| S2 clocked search | **done.** Bounded FIFO event queue, AbortSignal cancellation, beat and deadline budgets, per-beat source attribution, macro promotion from ≥2 verified witnesses with exact fold/unfold, n-gram preference changing the selection while the admitted set stays fixed, explicit refusals | `src/clock.ts`, `src/solver.ts`, tests |
| S3 small-model adapter | **done.** Real llama-server adapter with explicit ChatML template, greedy, seed 9, 1 slot, 4 threads; measures load, prefill, decode, CPU-s, peak RSS | [`harness/llama.ts`](harness/llama.ts) |
| S4 inference comparisons | **done** for plain, 4 n-gram speculators, 0.5B neural drafter and GBNF-constrained decoding. EAGLE not run (no compatible head for Qwen2.5-Coder-1.5B). XGrammar not run; llama.cpp GBNF was used | [`results/s4`](results/s4) |
| S5 code correctness | **done.** 140 ListOps tasks + all 164 HumanEval tasks; sandboxed execution; arms B0–B6 + ablations; negatives below | [`results/s5`](results/s5) |
| S6 university integration | **not started, deliberately.** The site repo is read-only from this session, and its AGENTS.md forbids model-provider calls. A standalone in-browser console (symbolic only) was verified in Chromium at 375 px and 1280 px | [`web/index.html`](web/index.html), [`results/browser`](results/browser) |

Tests executed at commit time: **55/55** CLOCK9/0.2 checks ([`results/tests-0.2.txt`](results/tests-0.2.txt)) and **22/22** v0.1 checks.

## S4 — decoding on this CPU (20 prompts × 3 classes, greedy, n_predict 256)

Raw: [`results/s4/summary.json`](results/s4/summary.json), per-request [`raw-*.json`](results/s4).
"exact" means the generated text is identical to the same model's plain greedy decode.

| config | decode tok/s, all | listops (short) | humaneval | rewrite (copy-heavy) | draft accept rate | exact vs plain | CPU-s (60 req) | peak RSS MiB |
|---|---|---|---|---|---|---|---|---|
| 0.5B plain | 35.6 | 36.4 | 35.3 | 35.6 | — | 60/60 | 919 | 880 |
| 0.5B ngram-simple (default n12 m48) | 54.2 | 39.9 | 56.2 | 59.8 | 0.66 | 60/60 | 639 | 924 |
| 0.5B ngram-simple n4 m16 | 56.5 | 38.5 | 55.5 | 70.5 | 0.67 | 59/60 | 633 | 896 |
| 0.5B ngram-mod (n-match 8, 4–16) | **56.8** | 39.0 | 56.4 | 69.3 | 0.68 | 60/60 | 633 | 912 |
| 0.5B ngram-map-k n4 m16 | 37.8 | 37.6 | 37.1 | 38.8 | 0.37 | 59/60 | 877 | 897 |
| 1.5B plain | 16.6 | 16.5 | 16.4 | 16.8 | — | 60/60 | 1766 | 2481 |
| 1.5B ngram-simple n4 m16 | 33.1 | 19.7 | 30.4 | 44.8 | 0.65 | 58/60 | 986 | 2498 |
| 1.5B ngram-mod | **33.6** | 23.1 | 31.6 | 40.9 | 0.68 | 58/60 | 981 | 2514 |
| 1.5B + 0.5B draft, n_max 3 | 15.6 | 15.8 | 15.7 | 15.4 | **0.95** | 55/60 | 2032 | 3332 |
| 1.5B + 0.5B draft, n_max 8 | 19.3 | 16.6 | 19.7 | 19.7 | 0.88 | 55/60 | 1677 | 3337 |

Findings:
- **N-gram self-speculation is the clear CPU win.** It gives 1.6× decode on the 0.5B and 2.0× on the 1.5B. CPU work drops by about 30% and 44% respectively, at no measurable RAM cost. On short ListOps answers the gain is small (1.07–1.4×), because there is little to copy.
- **The neural drafter loses on this CPU.** The 0.5B drafts are accepted 88–95% of the time, yet decoding with them is 0.94× (n=3) to 1.16× (n=8) as fast as plain. They also cost 850 MiB more RSS and up to +15% CPU. A 0.5B drafter is too large relative to a 1.5B target when both share four cores.
- **On this backend, greedy speculation is not bit-exact.** Plain greedy re-runs reproduce exactly (5/5). Changing only the plain prefill batch shape (`-ub 16`) reproduces the same first divergence point in 2 of the 5 divergent prompts. So the divergences are float batch-shape effects at near-tied logits, not verifier errors: the method is lossless in exact arithmetic but not bit-identical in this ggml CPU implementation ([`determinism-control.json`](results/s4/determinism-control.json)). Also, `-b 1` aborts this llama.cpp build (`get_sub_batch` error).
- **Context curves** ([`llama-bench-pp-tg.json`](results/s4/llama-bench-pp-tg.json), [`llama-bench-tg-depth.json`](results/s4/llama-bench-tg-depth.json)):

| | prefill t/s @64 / 256 / 1024 / 4096 tokens | decode t/s @ depth 0 / 512 / 2048 / 4096 |
|---|---|---|
| 0.5B Q4_K_M | 286 / 286 / 268 / 212 | 47.6 / 34.6 / 22.6 / 15.6 |
| 1.5B Q4_K_M | 225 / 251 / 220 / 152 | 20.7 / 18.5 / 16.7 / 13.3 |

  At 4096 context the 0.5B decodes almost as slowly as the 1.5B (15.6 vs 13.3 tok/s). The small model's speed advantage is a short-context property on this host.

## S5 — end-to-end code tasks (B0–B6 on identical tasks, prompts, decoding and host)

Every arm sees the same request and the same 2 visible examples. Hidden tests (25 per
ListOps task; HumanEval's official `check`) are run in the sandbox **only after** the arm
answers. Wall time = time to produce the answer, including the arm's own sandbox
verification, excluding final scoring and model load. Raw rows (with code, DSL, beats and
witnesses) are in [`results/s5/*-rows.json`](results/s5); tables come from
[`harness/analyze.ts`](harness/analyze.ts).

**ListOps** (140 eval tasks: `id` 40 template held-out, `para` 40 hand-written paraphrases,
`blind` 40 model-written paraphrases (29 true paraphrases + 11 that the 1.5B copied
verbatim), `oog` 20 out-of-grammar)

| arm | what it is | pass | id | para | blind (true) | oog | refused | false accept | precision | wall ms mean / p50 / p95 | model CPU-s | CPU-s per correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **B0** | grammar compiler only | 114 (81.4%) | 40/40 | 39/40 | 24/29 | 0/20 | 25 | **1** | **0.991** | **75 / 88 / 110** | **0** | **0** |
| B4 | B0 + verified cache (stream, each task twice) | 114 (81.4%) | 40/40 | 39/40 | 24/29 | 0/20 | 25 | 1 | 0.991 | 78 / 91 / 112 | 0 | 0 |
| B1-0.5 | 0.5B alone | 70 (50.0%) | 16/40 | 26/40 | 16/29 | 11/20 | 0 | 70 | 0.500 | 1867 / 1532 / 3363 | 1020 | 14.6 |
| B1-1.5 | 1.5B alone | 85 (60.7%) | 21/40 | 30/40 | 11/29 | 17/20 | 0 | 55 | 0.607 | 3439 / 3036 / 4774 | 1882 | 22.1 |
| B2-1.5 | 1.5B + ngram-mod speculation | 85 (60.7%) | 21/40 | 30/40 | 11/29 | 17/20 | 0 | 55 | 0.607 | 1970 / 1850 / 3428 | 1079 | 12.7 |
| B3 | 1.5B + 0.5B draft | 85 (60.7%) | 21/40 | 30/40 | 11/29 | 17/20 | 0 | 55 | 0.607 | 3725 / 3360 / 5144 | 2024 | 23.8 |
| G-0.5 | 0.5B under GBNF(ListOps), no parser | 10 (7.1%) | 3/40 | 4/40 | 2/29 | 0/20 | 130 | 0 | 1.000 | 2391 / 2359 / 3367 | 1253 | 125.3 |
| C1 | 0.5B → visible check → 1.5B (no grammar) | 85 (60.7%) | 20/40 | 30/40 | 17/29 | 16/20 | 30 | 25 | 0.773 | 3669 / 3079 / 6452 | 1946 | 22.9 |
| B5 | grammar → 0.5B GBNF DSL → 0.5B Python | 126 (90.0%) | 40/40 | 39/40 | 25/29 | 11/20 | 11 | 3 | 0.977 | 908 / 100 / 4971 | 436 | 3.5 |
| B6 | B5 → 1.5B Python fallback | 131 (93.6%) | 40/40 | 39/40 | 25/29 | 16/20 | 4 | 5 | 0.963 | 1226 / 99 / 8401 | 606 | 4.6 |
| **B6n** | B6 on ngram-mod servers | **131 (93.6%)** | 40/40 | 39/40 | 25/29 | 16/20 | 4 | 5 | 0.963 | 839 / 85 / 5293 | 404 | **3.1** |

B6 and B6n produced identical code on 140/140 tasks, as did B1-1.5 and B2-1.5. On these short
outputs speculation changed only the cost. Peak RSS: grammar-only arms never load a model
(Node process only); 0.5B server 764–1255 MiB; 1.5B server 2087–2664 MiB.

**HumanEval** (164 tasks, pass@1, greedy). The ListOps grammar has **no coverage** here: B0/B4/B5
would refuse every task, so the cascade arms use only the docstring examples as visible checks
(the extractor finds evidence for 134/164 tasks; canonical solutions pass 130/134 of them, and
the 4 misses are errors in HumanEval's own docstrings).

| arm | pass@1 | false accept | wall ms mean / p50 / p95 | model calls | gen tokens | model CPU-s | CPU-s per correct |
|---|---|---|---|---|---|---|---|
| B1-0.5 | 93 (56.7%) | 71 | 6960 / 6216 / 14911 | 164 | 35402 | 4484 | 48.2 |
| B1-1.5 | 115 (70.1%) | 49 | 11619 / 10703 / 20850 | 164 | 29352 | 7460 | 64.9 |
| B2-1.5 (ngram-mod) | 116 (70.7%) | 48 | **5889** / 5292 / 11188 | 164 | 29018 | **3764** | **32.4** |
| B3 (0.5B draft) | 115 (70.1%) | 49 | 12424 / 11150 / 23019 | 164 | 28795 | 7946 | 69.1 |
| C1 (0.5B → docstring check → 1.5B) | 118 (72.0%) | 46 | 10318 / 7733 / 24370 | 217 | 45233 | 6594 | 55.9 |
| **C1n** (C1 on ngram-mod servers) | **119 (72.6%)** | 45 | 6672 / 5162 / 15309 | 218 | 45248 | 4221 | 35.5 |

B2-1.5 vs B1-1.5: identical code on 143/164 tasks, with 5 pass/fail flips (net +1). This is the
batch-shape non-bit-exactness from S4, now visible in task outcomes.

### Evidence artifacts

- Generated code patch with an independently run test: [`results/demo/patch.diff`](results/demo/patch.diff). The test [`test_listops_patch.py`](results/demo/test_listops_patch.py) passes in the sandbox (25 hidden cases): [`patch-test-result.json`](results/demo/patch-test-result.json).
- Sourced short text passage: [`results/demo/text-passage.json`](results/demo/text-passage.json): "In Relational & Generative Mathematics, “Plicastratum” is glossed as follows: The stratified sequence of words and rules produced by successive folds. This is a house construction of Substrate University, not established mathematics. Related entries: fold, alphabet tower." Every sentence is tagged `authored-template` or `cited-glossary` with commit `6a0f5ea` and line number.
- Plicastratum fold/unfold trace: [`results/demo/fold-trace.json`](results/demo/fold-trace.json): `map neg | map neg | take 2 | reverse | sum` ⇄ `M1 | take 2 | reverse | sum`, with an identity and behaviour witness.
- Non-mutating address roundtrip: [`results/demo/address-roundtrip.json`](results/demo/address-roundtrip.json). `resolve()` reports `effects: none`; a test asserts it calls no executor.
- Clock trace with per-beat sources: [`results/demo/clock-trace.json`](results/demo/clock-trace.json).
- Browser (Chromium, Playwright 1.56.1): [`results/browser/mobile.png`](results/browser/mobile.png), [`desktop.png`](results/browser/desktop.png), [`browser-check.json`](results/browser/browser-check.json). No page errors, 0 off-origin requests, no horizontal overflow at 375 px, refusal path exercised. **This is a desktop Chromium emulating a phone viewport, not a physical-device test.**

## What the measurements say

1. **Inside its grammar, the symbolic path dominates on every axis we measured.** On the 120
   in-grammar ListOps tasks (id + para + blind, including the 11 verbatim blind copies), B0
   solves 114/120 with 0 false accepts, 0 model CPU and 87 ms mean wall. Of that time, ~0.6 ms
   is grammar search and the rest is the sandboxed Python verification. The 1.5B alone solves
   68/120 at 3.4 s and 23.6 model CPU-s per correct answer; with n-gram speculation (B2-1.5)
   it still solves 68/120, at 1.9 s and 13.0 CPU-s per correct. B6n solves 115/120 at 0.33 s
   mean and 0.96 CPU-s per correct. This advantage is bounded by the grammar's coverage. The
   grammar's author also wrote the `id`/`para` tasks; on the blind paraphrases it never saw it
   drops to 24/29.
2. **Outside its grammar, the hybrid costs more than the model alone and is no more accurate.**
   On the 20 out-of-grammar tasks, B6 passes 16/20 vs 17/20 for the 1.5B alone, at 5.9 s vs
   3.6 s mean wall and 22 vs 14 model CPU-s per task: the 0.5B tried first and failed. The
   grammar's own overhead before escalating is negligible (mean 1.7 ms, p95 2.6 ms over 50
   escalations). The cost is the 0.5B attempts and the per-attempt sandbox checks.
3. **Answer to the hand-off question (for this task distribution and host).** Reweighting the
   measured in-grammar and out-of-grammar per-task means (derived, not separately measured;
   [`analysis.md`](results/s5/analysis.md)), the best hybrid (B6n) versus the best model-only
   arm (B2-1.5, 1.5B with n-gram speculation):
   - **Accuracy:** B6n is ahead once ≳13% of tasks are in-grammar.
   - **Model CPU:** B6n is cheaper only above ≈44% in-grammar.
   - **Wall time:** B6n is faster only above ≈48% in-grammar.

   Grammar checking itself never "introduced more overhead than it saved": it is sub-millisecond.
   What can cost more than it saves is (a) independent verification at ~90 ms per sandboxed
   check, which exceeds the whole symbolic solve, and (b) a weak first-stage model ahead of
   the strong one on tasks the grammar cannot touch.
4. **Accepted macro lengths did not matter here, and the reason is itself a finding.** Only 2
   macros earned two verified witnesses from 60 random-template programs. The top one
   (`map neg | map neg`) is semantically the identity, so a certified macro can still be
   useless. The verified-program cache (B4, second pass: 115/115 hits) saved **no** wall
   time (76 vs 78 ms), because the search it skips takes 0.6 ms and the sandbox re-check it
   keeps takes ~90 ms. Reuse can only pay off where the skipped step is expensive, i.e.
   skipping a model call, which this task stream never needed.
5. **Grammar-constrained decoding alone is not enough for a 0.5B model.** Under GBNF the 0.5B
   always produced *syntactically* admissible ListOps, but only 10/140 were *semantically*
   right (G-0.5). Constraint guarantees form, not meaning. Inside B5/B6 the DSL proposer
   resolved **0** extra tasks; every non-grammar success came from free Python. The GBNF
   stage is pure cost in this configuration and is the first thing to remove or improve.
6. **Verification-routed cascades help a little, and only together with n-gram speculation.**
   On HumanEval, C1n reaches 72.6% (vs 70.1% for the 1.5B alone) at 0.57× its wall time and
   0.57× its CPU, but it is only +1.9 points over B2-1.5 (70.7%) and costs 12–13% more. The
   honest Pareto frontier on HumanEval is {B2-1.5, C1n}. Gains depend on docstring examples
   existing (134/164 tasks).
7. **False accepts are the real risk of any test-gated hybrid.** Two visible examples are weak
   evidence. B0's only false accept (out-of-grammar task oog-008) admitted `min` for "most frequent value (smallest on ties)" because both
   examples agreed with `min`. B6's 5 false accepts (that case, plus 4 model-written programs) all passed both visible
   examples and failed hidden ones. They are 5 of 136 accepted answers, compared with 55/140
   for the 1.5B alone (which never refuses).

## Negative and null results (kept)

- 0.5B neural drafter for the 1.5B on CPU: no speedup (0.94–1.16×) despite 88–95% acceptance; +850 MiB.
- `ngram-map-k`: barely faster than plain (1.06×).
- Speculative greedy decoding is not bit-exact on ggml-CPU (2–5 of 60 outputs differ; 5 HumanEval pass flips).
- GBNF-constrained 0.5B DSL proposals: 7.1% alone, 0 marginal contribution inside the hybrid.
- Verified-program cache: 0% wall-time gain on a fully repeated stream.
- Macro promotion: 2 macros from 60 programs, one semantically trivial.
- Hybrid on out-of-grammar tasks: slower, costlier and 1 point less accurate than the 1.5B alone.
- Blind paraphrase generation: 11/40 "paraphrases" were verbatim copies (reported as a separate column).
- `llama-server -b 1` aborts in this llama.cpp build.
- B1 models fail many trivial in-grammar tasks for mundane reasons (missing `from functools import reduce`, `min()` of an empty filter, wrong step order). These are real model errors, checked by reading the rows.

## Threats to validity

- ListOps, its `id`/`para` splits and the parser were written by the same agent. The parser author **had read** the hand-written `para` prompts before writing the lexicon (they were written first), so `para` (39/40) is optimistic. The `blind` split was generated after the parser froze (commit `7848ac0` precedes `bee31c4`) and was not read before scoring; its 24/29 is the fairer in-domain estimate.
- Single host, single seed, greedy decoding, n=140/164. With n=164, ±1.9 points on HumanEval is one task. Only the large gaps here (grammar vs model in-domain; speculation speedups) are well beyond noise.
- CPU-seconds of the model process are an energy *proxy* only; no RAPL counters exist on this VM. Sandbox and Node CPU are not included in "model CPU-s" (they are in wall time).
- Peak RSS rises across long runs; the per-arm values above come from servers shared across arms within a run.
- The sandbox (network/mount namespaces, uid 65534, rlimits, read-only tmpfs over world-writable dirs) is a research sandbox without seccomp, not a hardened jail.
- No Android or phone measurement was made. Nothing here says how this behaves on a Samsung A16 or any other device.

## Reproduce (exact commands)

```sh
git clone https://github.com/akadaan310/clock9 && cd clock9 && git checkout claude/eager-feynman-t3qz0q
npm ci && npm test                                     # 55 checks
(cd prototype/v0.1 && npm i --no-save typescript@5.6.3 && npm test)   # 22 checks
npm run demo && node harness/browser_check.mjs         # evidence; set PW=<path to playwright> if not global
# neural stages (see README for llama.cpp build + model download; export LLAMA_BIN, CLOCK9_MODELS)
node dist/harness/infer_bench.js --n 20
node dist/harness/determinism.js
node dist/harness/eval.js --suite listops
node dist/harness/eval.js --suite listops --arms B2-1.5,B6n --tag spec
node dist/harness/eval.js --suite humaneval --arms B1-0.5,B1-1.5,B3,C1
node dist/harness/eval.js --suite humaneval --arms B2-1.5,C1n --tag spec
node dist/harness/analyze.js
```

## Next experiments, each to be run only if the previous one earns it

1. Strengthen verification before widening generation: property-based tests derived from the
   typed spec (e.g. empty, singleton and sign-mixed inputs generated by the grammar itself) to
   cut false accepts, and measure the extra ~90 ms per check against the accuracy gained.
2. Run the cheap verifier in-process (a Pyodide or WASM Python, or a persistent sandbox worker)
   to remove the ~85 ms process spawn that dominates symbolic latency.
3. Drop the GBNF DSL stage, or replace it with retrieval of the nearest *verified* program plus
   an edit grammar. Re-measure B6n without it.
4. A real router: predict "in-grammar?" from the extraction before calling any model, so that
   out-of-grammar tasks go straight to the 1.5B+ngram (removes finding 2's penalty).
5. Broaden the code grammar to a second domain (string pipelines) and test whether macros or
   reuse ever save a *model call*, the only place reuse can pay.
6. Qwen3-0.6B / SmolLM2-360M comparison; physical-device (Termux) measurement before any phone claim.
7. S6: propose (via a PR to the site repo, by someone with write access) an optional
   symbolic-only "Computational Generator" room built from `src/` and `web/`. No model calls,
   matching the site's AGENTS.md.
