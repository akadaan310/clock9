/** The CLOCK9 clock: a bounded, cancellable event queue of computational beats.
 * A "beat" is one ordered, recorded event — not a timer. Every beat states which
 * kind of component produced it, so proposal is never confused with measurement.
 */
export type BeatKind = 'context' | 'retrieve' | 'draft' | 'admit' | 'compile' | 'verify' | 'promote' | 'escalate' | 'refuse' | 'resolve';
export type Source = 'grammar' | 'ngram' | 'cache' | 'neural' | 'tool' | 'macro' | 'fallback';
export type Beat = { beat: number; kind: BeatKind; source: Source; detail: string; t_ms: number };
export type ClockEvent = { kind: BeatKind; source: Source; run: () => Promise<{ detail: string; next?: ClockEvent[] }> };
export type Budget = { maxBeats: number; deadlineMs: number };

export class Cancelled extends Error {
  constructor(readonly reason: string) { super(`cancelled: ${reason}`); }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Clock {
  readonly trace: Beat[] = [];
  private readonly t0 = now();
  constructor(readonly budget: Budget = { maxBeats: 64, deadlineMs: 120_000 }, readonly signal?: AbortSignal) {}
  private check(): void {
    if (this.signal?.aborted) throw new Cancelled('signal');
    if (this.trace.length >= this.budget.maxBeats) throw new Cancelled('beat_budget');
    if (now() - this.t0 > this.budget.deadlineMs) throw new Cancelled('deadline');
  }
  /** Record a beat that was computed inline. */
  record(kind: BeatKind, source: Source, detail: string): void {
    this.check();
    this.trace.push({ beat: this.trace.length, kind, source, detail, t_ms: +(now() - this.t0).toFixed(3) });
  }
  /** Drain a FIFO queue; each event may enqueue successors. Cancellation is checked before every beat. */
  async run(initial: ClockEvent[]): Promise<Beat[]> {
    const queue = [...initial];
    while (queue.length) {
      this.check();
      const ev = queue.shift()!;
      const { detail, next } = await ev.run();
      this.record(ev.kind, ev.source, detail);
      if (next) queue.push(...next);
    }
    return this.trace;
  }
  elapsed(): number { return now() - this.t0; }
}
