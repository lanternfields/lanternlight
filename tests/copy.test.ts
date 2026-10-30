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

  // The ribbon is two rows at most (a third row made heavy black blocks over the
  // stage). About 26 characters fit a row at full size; a line whose only good
  // phrase break needs a longer row renders a little smaller, never re-wrapped.
  // (III1 is said as two beats, III1a and III1b, so each fits at full size.)
  const LONG_ROW_OK: Record<string, number> = { P1: 30, II1: 30, I5: 32, F2: 31, P3: 28, II5: 28, II4: 27, I3: 27, F1: 29 };
  it('long lines are broken by hand into two rows, and no row is too long for the ribbon', () => {
    for (const [id, text] of lines) {
      if (text.length > 26) expect(text, id).toContain('\n');
      for (const row of text.split('\n')) expect(row.length, `${id}: ${row}`).toBeLessThanOrEqual(LONG_ROW_OK[id] ?? 26);
      expect(text.split('\n').length, id).toBeLessThanOrEqual(2);
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

describe('copy: system notices (shown in the prompt style under the stage)', () => {
  it('fit small-caps rows (19 characters) on at most two rows', () => {
    for (const [id, text] of lines) {
      if (!id.startsWith('NOTICE_')) continue;
      expect(text.split('\n').length, id).toBeLessThanOrEqual(2);
      for (const row of text.split('\n')) expect(row.length, `${id}: ${row}`).toBeLessThanOrEqual(19);
    }
  });
});
