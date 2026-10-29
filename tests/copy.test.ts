import { describe, expect, it } from 'vitest';
import { COPY } from '../src/core/copy.js';

/**
 * Captions break at phrase boundaries, authored in copy.ts ("\n"); the
 * renderer never re-wraps. These rules catch an awkward break:
 *  - a row may not end on a short word (1-3 letters) unless it ends a phrase
 *    (punctuation after it): "a / giant", "in / case";
 *  - a row may not end on a word that starts a new sentence: "It's / a";
 *  - a row may not start with the last word of a sentence begun above it:
 *    "a light / tonight.".
 * And long lines must be broken by hand (no automatic wrap to rely on).
 */
const PHRASE_END = /[.,;:!?…]['"”’]*$/;
const SENTENCE_END = /[.!?…]['"”’]*$/;
const bare = (w: string): string => w.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, '');

export function danglingBreaks(text: string): string[] {
  const rows = text.split('\n');
  const problems: string[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const words = rows[i].trim().split(/\s+/);
    const last = words[words.length - 1];
    const prev = words.length > 1 ? words[words.length - 2] : i > 0 ? rows[i - 1].trim().split(/\s+/).pop()! : '';
    const nextFirst = rows[i + 1].trim().split(/\s+/)[0];
    if (!PHRASE_END.test(last) && bare(last).length <= 3) problems.push(`row ${i + 1} ends on a short word "${last}"`);
    if (!PHRASE_END.test(last) && prev && SENTENCE_END.test(prev)) problems.push(`row ${i + 1} ends on a sentence start "${last}"`);
    if (SENTENCE_END.test(nextFirst) && !SENTENCE_END.test(last)) problems.push(`row ${i + 2} starts with a sentence's last word "${nextFirst}"`);
  }
  return problems;
}

const lines: [string, string][] = [];
const prompts: [string, string][] = [];
const captions: [string, string][] = [];
for (const [id, v] of Object.entries(COPY)) {
  if (typeof v === 'string') {
    if (!id.startsWith('TITLE')) lines.push([id, v]);
  } else {
    prompts.push([id, v[0]]);
    captions.push([id + ' (full)', v[1]]);
  }
}

describe('copy: line breaks', () => {
  it('the rules catch the breaks the review flagged', () => {
    expect(danglingBreaks('Pip crosses on tiptoe, in\ncase hands are ticklish.')).not.toEqual([]);
    expect(danglingBreaks("Pip stops shaking. It's\na pretty good song.")).not.toEqual([]);
    expect(danglingBreaks('Everyone has a light\ntonight. Almost everyone.')).not.toEqual([]);
    expect(danglingBreaks('A crocodile, a bridge, a\ngiant… and now, a branch.')).not.toEqual([]);
    expect(danglingBreaks('Lie flat. Be\nthe bridge.')).not.toEqual([]);
    expect(danglingBreaks('Lie flat.\nBe the bridge.')).toEqual([]);
  });

  it('no storyteller line, prompt or full caption breaks on a dangling word', () => {
    for (const [id, text] of [...lines, ...prompts, ...captions]) expect(danglingBreaks(text), id).toEqual([]);
  });

  // About 24 characters fit a ribbon row at full size; the few lines whose
  // phrase breaks need longer rows render slightly smaller (to 29 characters).
  const WIDE_OK = new Set(['P3', 'II4', 'F1']);
  // Two rows at most where a taller ribbon would meet the scene: the hub's
  // emblems, the finale's flitting and departing bird, and its last line.
  const TWO_ROWS = new Set(['H1', 'H2', 'H3', 'F1', 'F3', 'F4', 'F5', 'P2']);
  it('long lines are broken by hand, and no row is too long for the ribbon', () => {
    for (const [id, text] of lines) {
      if (text.length > 24) expect(text, id).toContain('\n');
      for (const row of text.split('\n')) expect(row.length, `${id}: ${row}`).toBeLessThanOrEqual(WIDE_OK.has(id) ? 29 : 24);
      expect(text.split('\n').length, id).toBeLessThanOrEqual(TWO_ROWS.has(id) ? 2 : 3);
    }
    for (const [id, text] of prompts) {
      // small caps: about 17 characters fit a row at full size (19 at a slight shrink)
      if (text.length > 19) expect(text, id).toContain('\n');
      for (const row of text.split('\n')) expect(row.length, `${id}: ${row}`).toBeLessThanOrEqual(19);
      expect(text.split('\n').length, id).toBeLessThanOrEqual(2);
    }
    for (const [id, text] of captions) expect(text.split('\n').length, id).toBeLessThanOrEqual(2);
  });
});
