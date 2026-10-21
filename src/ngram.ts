/** Variable-order backoff n-gram over string tokens (stupid backoff, Brants et al. 2007).
 * Transparent counts; scores are relative preferences, not calibrated probabilities. */
import { canonical, fnv1a } from './listops/ast.js';

export class NGram {
  private counts = new Map<string, Map<string, number>>();
  private totals = new Map<string, number>();
  private corpus: string[][] = [];
  constructor(readonly maxOrder = 3, readonly alpha = 0.4) {
    if (maxOrder < 1 || maxOrder > 16) throw Error('maxOrder out of range');
  }
  observe(tokens: string[]): void {
    this.corpus.push([...tokens]);
    const seq = ['<s>', ...tokens, '</s>'];
    for (let i = 1; i < seq.length; i++) {
      for (let n = 0; n <= Math.min(this.maxOrder - 1, i); n++) {
        const ctx = seq.slice(i - n, i).join(' ');
        const d = this.counts.get(ctx) ?? new Map<string, number>();
        d.set(seq[i]!, (d.get(seq[i]!) ?? 0) + 1);
        this.counts.set(ctx, d);
        this.totals.set(ctx, (this.totals.get(ctx) ?? 0) + 1);
      }
    }
  }
  /** Stupid-backoff score of `next` after `history`; returns the order actually used. */
  score(history: string[], next: string): { s: number; order: number } {
    let penalty = 1;
    for (let n = Math.min(this.maxOrder - 1, history.length); n >= 0; n--) {
      const ctx = history.slice(history.length - n).join(' ');
      const c = this.counts.get(ctx)?.get(next);
      if (c) return { s: penalty * c / this.totals.get(ctx)!, order: n + 1 };
      penalty *= this.alpha;
    }
    const vocab = this.counts.get('')?.size ?? 1;
    return { s: penalty / ((this.totals.get('') ?? 0) + vocab), order: 0 };
  }
  logScore(tokens: string[]): number {
    const seq = ['<s>', ...tokens, '</s>'];
    let lp = 0;
    for (let i = 1; i < seq.length; i++) lp += Math.log(this.score(seq.slice(0, i), seq[i]!).s);
    return lp;
  }
  /** Content hash of the training corpus, recorded in every output witness. */
  corpusHash(): string { return fnv1a(canonical({ maxOrder: this.maxOrder, alpha: this.alpha, corpus: this.corpus })); }
  size(): number { return this.corpus.length; }
}
