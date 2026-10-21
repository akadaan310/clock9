# 9LM / CLOCK9 — Grammar-Clocked Hybrid Generation
## Substrate University exploratory research lane, edition 0.1 (2026-10-21)

**Status:** runnable **non-neural** TypeScript proof-of-mechanism with a proposal interface for external tiny models; 22 automated checks. It is NOT a newly trained LLM, does NOT claim any real LLM inference speedup, and only compiles a tiny arithmetic/affine DSL. Benchmark numbers are host-local microbenchmarks of this tiny DSL, not Android measurements or language-model throughput.

**Intellectual lineage:** users' In-Grammar nine-pillar foundation (G×I), CGT operational grammars, Plicastratum fold/unfold and certification, SubstrateIO's event/transition structures, and PURL's address-as-program approach. These provide an architectural vocabulary. Established antecedents: n-gram backoff, suffix-array language models, speculative decoding, constrained decoding, macro-operators and partial evaluation. **Claims about novelty belong to the integration and must be established experimentally, not assumed.**

## 1. Research question (not a speedup announcement)

Can a small, CPU-friendly, grammar-clocked generator perform common **text, code and tool** tasks with lower end-to-end latency and equivalent or acceptably close task correctness compared with:

- a small neural model generating alone;
- a larger model generating alone;
- baseline n-gram speculative decoding;
- baseline grammar-constrained decoding;
- explicit retrieval/compilation without neural generation?

Two goals that must not be conflated:

**A. Lossless LLM inference acceleration.** A n-gram/small-model drafter proposes token continuations. A specified target-model verifier accepts/rejects drafts via a correct greedy or rejection-sampling procedure. With appropriate verified decoding, target output behavior/distribution is preserved. Speedup depends on accepted draft length, verification latency and hardware; CPU-only speculation can be slower.

**B. Hybrid task computation.** A typed grammar routes easy problems directly to exact tools/macro programs; a tiny model proposes harder language structures; a larger model is invoked only on unresolved cases. The resulting task distribution is intentionally *different* from one big model's outputs and must be evaluated for quality and side effects. This is where PURL/SEURL/SubstrateIO methods can contribute meaningfully.

## 2. Formal operational model

Each domain has `D = (Σ, Q, G, I, M, R, C, E, V)`:

- `Σ` typed alphabets and foldable macro letters;
- `Q` current task/solver state, not an assumed persistent AI identity;
- `G` generative admissibility grammar;
- `I` contextual ranker/backoff n-gram distribution, optionally conditioned on a tiny neural model;
- `M` reusable certified macro library with explicit unfold rules and stable versions;
- `R` selected resolver/operator adapters (PURL/SEURL-compatible, read-only discovery separated from effects);
- `C` a clocked scheduler of computational **events** (not real-time waiting or mystical periodicity);
- `E` evidence / source / provenance ledger;
- `V` independent type, test, semantic and authority validators.

For the **hybrid task** mode, a conceptual choice rule is:

`y* = argmax_{y ∈ L(G), V(y) = PASS} [log I_ngram(y|context) + λ log q_small(y|context) + η reuse(y) - μ measured_cost(y)]`

This expression is a research proposal, not currently implemented as a differentiable optimizer. If a component is missing, weights and score calibration must be explicitly handled; do not assume N-gram and neural probabilities have matching calibration. Inference costs, search costs, network costs and verification costs belong in measured_cost. For execution with side effects, evaluation `V(y)` occurs **before commit**.

For **lossless speculation**, do NOT use an approximate grammar-scored argmax to claim identical distribution to the unmodified model. Implement target-model acceptance under the relevant established proof; constraints then define a newly constrained target distribution if applied.

## 3. Connection to our nine In-Grammar pillars

| Pillar | Proposed hybrid role | Test |
|---|---|---|
| P1 Alphabet tower | Fold repeated code/word patterns into unfoldable plicae | roundtrip and composition identity |
| P2 Definitional graph | Dictionary→glossary grounding for entity types | no ungrounded references / held-out QA |
| P3 Glossary field | Task-specific meanings and preference shift | domain disambiguation |
| P4 Grammar × In-Grammar | Typed candidate generation with conditional ranking | valid rate and next-step ranking |
| P5 Charts | Embeddings, n-gram tables and ASTs as declared lossy/exact views | reconstruction loss, invariants |
| P6 Discourse grammar | Typed dialogue/tool act sequences | route correctness |
| P7 Event history | Task-level, version-pinned witnesses and branch choice | replay and provenance; not an AI continuity product |
| P8 Program addresses | Pure explain/resolve; authorization for effects | address roundtrip, no implicit writes |
| P9 Admissibility | Refusal on invalid op/inverse/resource | sound diagnostics, held-out tests |

## 4. Clocked generation — a precise non-neural starting point

The bundled `src/clock9.ts` implements this actual sequence:

`context@0 -> draft@1 -> admission@2 -> compile@3 -> promote@4 -> witness@5`

The clock is an ordered event sequence, not a timer and not a new physical hypothesis. The tiny context N-gram samples an operator sequence in a *bounded DSL*; an independent affine summarizer compiles to TypeScript; verification compares interpreter and affine outputs; recurring operator pairs are certified and reversible; a `clock9://program/...` descriptor serializes the operation itself. Its checksum detects accidental alteration but is not cryptographic integrity or an authorization credential.

**Intentionally limited:** current toy ignores most free-text request semantics, knows four typed arithmetic ops, and uses a six-sequence curated training corpus. A `TinyModel` adapter is defined, but no neural weights are loaded. The output is **not** comparable to unrestricted coding agents. Its value is a tested boundary between proposal, syntax, computation and witness.

## 5. Highest-value research experiment: CODE

Choose held-out task sets with **typed, observable requirements**, not only output word similarity:

1. Plain Python/TS compile from fixed typed grammar.
2. Small code synthesis with unit tests and static typing.
3. Repository edits requiring AST transformations, imports and tests.
4. Tool workflows: read, validate, propose patch, check, commit (when authorized), preserving effect provenance.

Compare arms with exactly matching hardware/corpora/test budgets:

- **B0:** deterministic grammar/tool compiler (no model);
- **B1:** target GGUF model alone in llama.cpp;
- **B2:** target with llama.cpp ngram speculative decoding;
- **B3:** target with small neural draft model (if compatible);
- **B4:** domain grammar + suffix/backoff n-gram proposals + verified code macros;
- **B5:** B4 + small neural proposal model for uncertain steps;
- **B6:** B5 + optional larger-model fallback when budget explicitly permits.

For *lossless inference* compare acceptance lengths and the actual target-model decode law, not just text overlap. For *hybrid coding tasks*, compare test pass rate, executable correctness, patch size, rejection cause, time-to-correct-solution and end-to-end wall time. Run cold and warm model loads separately.

### CPU/phone candidates (verify exact conditions)

- `Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF`, Apache-2.0. Official Q4_K_M ~491MB, on-device **candidate** for coding; model memory plus KV/cache and runtime exceed file size. No claim it reaches a certain tokens/s or quality on Samsung A16 without a test.
- `Qwen/Qwen3-0.6B-GGUF`, Apache-2.0, comparison candidate for general writing.
- `HuggingFaceTB/SmolLM2-360M-Instruct`, Apache-2.0, comparison candidate for connective language.
- `llama.cpp`: official Android and Termux build paths, with N-gram speculation and optional neural drafters.

Try CPU-only, low-token baseline first; if the phone's RAM/thermal envelope is too tight, route non-neural computation entirely locally and make neural augmentation opt-in or remote. A fast deterministic lookup can be useful without suggesting that a small model replicates frontier quality.

## 6. Technical research anchors

- Infini-gram, *Scaling Unbounded n-gram Language Models to a Trillion Tokens*, 2024: https://arxiv.org/abs/2401.17377
- Speculative decoding, Leviathan et al., ICML 2023: https://proceedings.mlr.press/v202/leviathan23a.html
- llama.cpp official speculative implementations: https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md
- llama.cpp Android/Termux: https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md
- XGrammar, MLSys 2025: https://proceedings.mlsys.org/paper_files/paper/2025/hash/5c20ca4b0b20b0bd2f1d839dc605e70f-Abstract-Conference.html
- SpecDecode-Bench, production vLLM evaluation, 2026: https://specdecode-bench.github.io/
- Qwen official 0.5B coding GGUF: https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF
- Qwen3 0.6B GGUF: https://huggingface.co/Qwen/Qwen3-0.6B-GGUF
- SmolLM2 360M: https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct

**External performance caution:** published speculative speedup is workload/target/GPU-specific; production studies find verification dominates and gains shrink with larger batches. No borrowed metric is a CLOCK9 result.

## 7. What counts as frontier progress

- An empirically better **Pareto point** (quality vs latency vs peak RAM/energy) on held-out tasks.
- A reusable grammar/macro representation that generalizes across at least **text and code**, not a fixed toy demonstration.
- An execution/address layer where verified programs actually invoke tools safely with comparable correctness and better computational cost.
- Repeated trials and independent reproduction; counterexamples and cases where it is slower are fully retained.

Neither Turing completeness, infinite output variety, nor compact program addresses establish unlimited computation or P=NP. Performance and generality need measured limits.
