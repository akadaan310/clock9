# CLOCK9/0.1 — Grammar-Clocked Hybrid Generation research seed

A standalone **CPU-only, dependency-free, browser-compatible TypeScript** experimental kernel inspired by In-Grammar, Plicastratum, and PURL. Deliberately limited: it does not yet contain a trained language model, real speculative decoding or a neural speedup benchmark. The optional `TinyModel` interface accepts proposals from an external model and subjects them to the same admission / verification.

## Commands (Node 22 + TypeScript CLI)

```sh
npm test
npm run demo
npm run bench
```

`npm test` compiles TypeScript and runs 22 automated checks. `npm run demo` generates one validated tiny affine transformation program, an address, and a clocked trace. `npm run bench` measures **only this tiny in-memory symbolic generator** on the current host. Nothing downloads or contacts the network.

Source: `src/clock9.ts`, `src/demo.ts`, `src/benchmark.ts`; tests in `tests/run.ts`.

Read `RESEARCH_BLUEPRINT.md` for primary literature, practical phone models and honest research boundaries. The Claude Code continuation lives in `CLAUDE_CODE_EXPERIMENT.md`.

**Version/purity:** all code generation is within a four-operator typed DSL; its emitted TS function is a compiled affine expression, not arbitrary code. The witness tests finite inputs, while the affine derivation is equivalent by the algebra of the admitted operators. `clock9://` is a local illustrative typed computational URI, not an independently registered internet scheme or security primitive.
