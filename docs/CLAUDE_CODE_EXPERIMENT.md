# CLAUDE CODE CLOUD — CLOCK9/9LM RESEARCH EXPERIMENT

**Purpose:** Build and evaluate a genuinely hybrid efficient generator (text, code and tools), beginning with code as the primary measurable use case, inside the research program of Substrate University. This is an experimental **additive** lane, not a replacement of the university's current design and not an amendment to its existing living-press or site constitution.

**Existing website:** https://github.com/akadaan310/abedkadaancom; branch as currently configured in GitHub (last inspected default `claude/new-session-xd8auu`, verify fresh). It is a Vite + React + TypeScript + Three.js browser application with `src/content/registry.ts`, `src/content/glossary.ts`, `src/math/fold.ts`, `src/books/compose.ts`, `src/pages/Scriptorium.tsx`, `src/pages/Harness.tsx`, and tests. DO NOT restore its old website/back-end. Keep all existing publications and the six academic divisions intact.

Read this file and `RESEARCH_BLUEPRINT.md`, run included CLOCK9 tests and demo, inspect the actual repo and current work, then implement an isolated research package under a logical experimental directory (suggested `src/research/clock9/` or a separate `packages/clock9`) that can be imported by the client without changing existing app routes prematurely. Work on a clean branch/working directory if another agent is actively editing; coordinate via the existing integrator.

## Non-negotiable experiment discipline

1. No invented claim of a new trained LLM. Treat CLOCK9/0.1 as a **non-neural** prototype and `TinyModel` as an **unbound adapter**. Real weights/inference must be separately installed and measured.
2. Respect the research scope of the six present university divisions. No reopening excluded academic subjects or user history. Work is for computational grammar and generated code/text.
3. Browser-native symbolic operation must work without login, backend, GPU or model download. Opt-in open-weight inference may use llama.cpp on an authorized local host/phone; do not install or activate paid APIs or request secrets.
4. Keep privacy: never send private code/prompts or corpus to a remote inference provider without explicit approval. Do not import private media or unrelated datasets.
5. The product must report whether a computation came from fixed grammar, n-gram retrieval, neural proposal, tool execution, or verified fallback. Never confuse proposal with measurement.
6. Preserve PURL/SEURL/SubstrateIO semantics by inspecting their real source definitions before writing integration adapters; example `clock9://` is a local experimental syntax, not a claim that PURL officially supports it.
7. Execution permissions are independent of the address, inference and citations. Tool calls need typed capabilities, bounded resources, cancellation and verifiable outcomes.
8. Only **real** tests and wall-clock benchmarks justify improvement claims. Compare with baselines on the same environment, corpus, prompts, and decoding settings.

## Deliver work in measurable stages

**S0: exact baseline.** Run `npm test`, `npm run demo`, `npm run bench` on this package and capture machine, versions and outputs. Existing 22 tests prove only the narrow DSL. Report measured outputs and limitations.

**S1: two real domain grammars.** Preserve the current typed arithmetic DSL. Build a small **text** grammar from public, sourced university glossary records and a **code** grammar with composable AST/type rules. Train/back off context n-grams from *allowed public examples*. Output records must include the grammar version, n-gram corpus hash and derivation witness. Add held-out text-vs-code tests; the generator cannot claim to satisfy a text request because it emits a fixed operation ignoring the request.

**S2: grammar-clocked search.** Implement a bounded event queue for `context→retrieve→draft→admit→compile→verify→promote`, with trace semantics and cancellation. Test that one small program produces a reusable promoted macro with exact unfolding, that contextual preferences alter selection without changing the admitted language, and that a failed lookup stays an explicit refusal/unresolved state.

**S3: actual small-model adapter.** Try Qwen2.5-Coder-0.5B-Instruct GGUF Q4_K_M (license and hashes pinned). Compare Qwen3-0.6B or SmolLM2 360M if CPU fits; do not treat quantized weight bytes as peak inference RAM. Integrate with llama.cpp or an equivalent permitted local backend; actually run sample prompts with explicit seeds, templates and batch settings; measure model-load, prefill, decode speed, RAM and energy proxy where available. The hybrid decides when to skip/consult it. No hardcoded simulation of neural results.

**S4: true inference comparisons.** Benchmark regular decoding versus `ngram-simple`/`ngram-mod` (from installed version's actual help flags), optional EAGLE/small drafter if compatible, and grammar-constrained decoding (XGrammar or suitable runtime). Instrument speculative **accepted draft tokens**, verifier work, output tokens/s and exactness under a defined greedy or probabilistic sampling policy. Do not claim identical output distribution when grammar changes the target distribution.

**S5: code correctness.** Evaluate small held-out code tasks with compile/typecheck/test results; add an AST inspector, constrained source transformation and real suite or property tests. Run user-generated code only in a genuinely isolated sandbox with filesystem/network budgets; browser demo must never execute arbitrary guest JS in the page's security context. Every promoted macro needs independent witnesses and known input types. Include negative results and a simple strong deterministic baseline.

**S6: university integration.** Only once a demonstrator genuinely passes S1–S5's relevant gates, add an optional `Living Press / Computational Generator` room in the existing Scriptorium or Division II. Visitors inspect each clock beat, sources, words, code, tests, errors and saved witness. Generated books distinguish authored content, cited research, computed examples and neural language proposals. Preserve the site's cinematic 3D campus and accessibility, ensure mobile responsiveness and browser-only fallback. Provide real screenshots and conformance logs. Do not promise Android-local LLM until verified on a physical device.

## Required final evidence

`research-matrix.md` comparing B0–B6; exact commands and commits; count of executed tests; failures; genuine model card and hashes if downloaded; latency, peak memory and throughput for both symbolic and neural pipelines; performance curves for short and long contexts; correctness and refusal rates; one generated code patch with a passing independently run test; one sourced short text passage; at least one Plicastratum fold/unfold trace; one nonmutating address roundtrip; mobile screenshot if client feature is implemented.

Prioritize **S0–S3 and code-correctness S5** over cosmetic site updates. A five-hour session may produce substantial results without completing every stage; report the exact checkpoint and continue only through authorized next session. Never declare a universal speedup, a new general-purpose LLM, unlimited computation or native-phone performance without evidence.

**Research question to leave the next investigator:** Under what distributions of tasks and accepted macro lengths does the hybrid reduce actual CPU work versus a quantized 0.5B model, and when does grammar checking introduce more overhead than it saves?
