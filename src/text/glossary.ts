/** Text grammar over Substrate University's public glossary (snapshot pinned by commit).
 *
 *   Request  := Define | Relate
 *   Define   := ("define" | "what is" | "what does" T "mean" | "explain" | "meaning of") T ("in" D)?
 *   Relate   := "how is" T "related to" T
 *   Passage  := Lead · Sense · Status? · Related?   (every sentence carries provenance)
 *
 * Senses are never paraphrased: the passage quotes the glossary text and labels its
 * epistemic status, so the generator cannot assert anything the source does not.
 * Unknown terms, missing domain senses and non-text requests are explicit refusals.
 */
import { NGram } from '../ngram.js';

export const TEXT_GRAMMAR_VERSION = 'glossary-text/1.0';
export type Sense = { domain: string; domainLabel: string; text: string; status: string; topic: string | null };
export type Term = { id: string; term: string; related: string[]; senses: Sense[]; line: number };
export type Snapshot = { source: string; commit: string; terms: Term[] };
export type Sentence = { text: string; provenance: { kind: 'authored-template' | 'cited-glossary'; termId?: string; domain?: string; status?: string; source?: string } };
export type TextResult = {
  ok: boolean; refusal: string | null; passage: string; sentences: Sentence[];
  derivation: string[]; grammarVersion: string; ngramCorpusHash: string; snapshotCommit: string;
};

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2);
const STATUS_NOTE: Record<string, string> = {
  house: 'This is a house construction of Substrate University, not established mathematics.',
  mythology: 'This sense records mythology or folklore, not an established fact.',
};

export class GlossaryGenerator {
  private byDomain = new Map<string, NGram>();
  private all = new NGram(2);
  private names: { key: string; term: Term }[];
  constructor(readonly snap: Snapshot) {
    for (const t of snap.terms) for (const s of t.senses) {
      const g = this.byDomain.get(s.domain) ?? new NGram(2);
      g.observe(words(s.text)); this.byDomain.set(s.domain, g);
      this.all.observe(words(s.text));
    }
    this.names = snap.terms.flatMap(t => [{ key: t.term.toLowerCase(), term: t }, { key: t.id.toLowerCase().replace(/-/g, ' '), term: t }])
      .sort((a, b) => b.key.length - a.key.length);
  }
  corpusHash() { return this.all.corpusHash(); }
  /** Longest glossary term occurring as a whole phrase in the request. */
  findTerms(req: string): Term[] {
    let r = ` ${req.toLowerCase().replace(/[?.,!"“”']/g, ' ')} `;
    const out: Term[] = [];
    for (const { key, term } of this.names) {
      const i = r.indexOf(` ${key} `);
      if (i >= 0 && !out.includes(term)) { out.push(term); r = r.slice(0, i) + ' '.repeat(key.length + 2) + r.slice(i + key.length + 2); }
    }
    return out.sort((a, b) => req.toLowerCase().indexOf(a.term.toLowerCase()) - req.toLowerCase().indexOf(b.term.toLowerCase()));
  }
  private src(t: Term) { return `${this.snap.source}#L${t.line}`; }
  private result(ok: boolean, refusal: string | null, sentences: Sentence[], derivation: string[]): TextResult {
    return { ok, refusal, passage: sentences.map(s => s.text).join(' '), sentences, derivation, grammarVersion: TEXT_GRAMMAR_VERSION, ngramCorpusHash: this.corpusHash(), snapshotCommit: this.snap.commit };
  }
  /** Domain disambiguation: context words scored under each domain's backoff n-gram. */
  rankSenses(t: Term, context: string[]): { sense: Sense; score: number }[] {
    return t.senses.map(sense => {
      const g = this.byDomain.get(sense.domain)!;
      const score = context.reduce((a, w) => a + Math.log(g.score([], w).s), 0) / Math.max(1, context.length);
      return { sense, score };
    }).sort((a, b) => b.score - a.score || (a.sense.status === 'established' ? -1 : 1));
  }
  generate(request: string): TextResult {
    const d: string[] = [];
    const req = request.trim();
    const relate = /^how (?:is|are) (.+?) (?:related|connected) to (.+?)\??$/i.exec(req);
    const define = /^(?:define|what is|what are|explain|meaning of|what does)\b/i.test(req);
    if (!relate && !define) return this.result(false, 'not_a_text_request', [], ['Request: no Define/Relate production matched']);
    d.push(relate ? 'Request -> Relate' : 'Request -> Define');
    const terms = this.findTerms(req);
    if (!terms.length) return this.result(false, 'unknown_term', [], [...d, 'T: no glossary term found (refuse rather than invent)']);
    const t = terms[0]!;
    d.push(`T -> ${t.id}`);
    const domMatch = /\bin (?:the )?([a-z &]+?)(?: sense| domain| division)?\??$/i.exec(req);
    let sense: Sense | undefined;
    if (domMatch && !relate) {
      const want = domMatch[1]!.toLowerCase().trim();
      const hit = t.senses.find(s => s.domain === want || s.domainLabel.toLowerCase().includes(want));
      if (hit) { sense = hit; d.push(`D -> ${hit.domain} (explicit)`); }
      else if (!terms.slice(1).length) return this.result(false, 'no_sense_in_domain', [], [...d, `D: "${want}" not among ${t.senses.map(s => s.domain).join(',')}`]);
    }
    if (!sense) {
      const ctx = words(req).filter(w => !t.term.toLowerCase().split(/\s+/).includes(w) && !['define', 'what', 'does', 'mean', 'explain', 'related', 'meaning'].includes(w));
      const ranked = this.rankSenses(t, ctx);
      sense = ranked[0]!.sense;
      d.push(`D -> ${sense.domain} (n-gram context ${ranked.map(r => `${r.sense.domain}:${r.score.toFixed(2)}`).join(' ')})`);
    }
    const S: Sentence[] = [];
    S.push({ text: `In ${sense.domainLabel}, “${t.term}” is glossed as follows:`, provenance: { kind: 'authored-template' } });
    S.push({ text: sense.text, provenance: { kind: 'cited-glossary', termId: t.id, domain: sense.domain, status: sense.status, source: this.src(t) } });
    if (STATUS_NOTE[sense.status]) { S.push({ text: STATUS_NOTE[sense.status]!, provenance: { kind: 'authored-template', status: sense.status } }); d.push(`Status -> ${sense.status}`); }
    if (relate) {
      const u = terms[1];
      if (!u) return this.result(false, 'unknown_second_term', S, [...d, 'T2: not found']);
      const linked = t.related.includes(u.term) || t.related.includes(u.id) || u.related.includes(t.term) || u.related.includes(t.id);
      S.push({ text: linked ? `The glossary cross-links “${t.term}” and “${u.term}”.` : `The glossary records no direct cross-link between “${t.term}” and “${u.term}”.`, provenance: { kind: 'authored-template', source: this.src(t) } });
      d.push(`Related -> ${linked ? 'linked' : 'unlinked'}(${u.id})`);
    } else if (t.related.length) {
      S.push({ text: `Related entries: ${t.related.slice(0, 4).join(', ')}.`, provenance: { kind: 'cited-glossary', termId: t.id, source: this.src(t) } });
      d.push('Related -> list');
    }
    return this.result(true, null, S, d);
  }
}
