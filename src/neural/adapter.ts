/** Browser-safe contract for an OPTIONAL local open-weight model. CLOCK9 never
 * simulates a model: an adapter is either bound to a real backend or absent. */
export type CompletionRequest = {
  system?: string; user: string;
  grammar?: string;      // GBNF; constrains the target distribution (not lossless)
  maxTokens: number; seed: number; temperature?: number; // default 0 = greedy
};
export type Completion = {
  text: string; promptTokens: number; genTokens: number;
  ms: number;            // client-observed wall time of the request
  prefillMs: number; decodeMs: number;
  draftTokens?: number; draftAccepted?: number; // speculative decoding counters, if reported
  model: string; stop: string;
};
export interface ModelAdapter { id: string; complete(req: CompletionRequest): Promise<Completion> }
