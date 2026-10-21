/** P6 discourse routing: decide whether a request is a text (glossary) or code (ListOps)
 * act, or neither. Routing never answers; it only selects which grammar may try. */
import { extract } from './listops/parse.js';

export type Route = 'text' | 'code' | 'unknown';
export function route(request: string): Route {
  const r = request.trim();
  if (/^(?:define|what is|what are|explain|meaning of|what does|how (?:is|are) .+ (?:related|connected) to)\b/i.test(r)
      && !/\b(?:xs|list of integers|return|function|def )\b/i.test(r)) return 'text';
  const frags = extract(r).fragments;
  const codey = /\b(?:xs|list|integers|numbers|elements|return|function)\b/i.test(r);
  if (codey && frags.length) return 'code';
  return 'unknown';
}
