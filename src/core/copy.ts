/**
 * Every word that appears on the stage, in ONE table keyed by the line IDs of
 * the script (hackathons/meta-a3/STORY_V2.md): P prologue, H hub, I/II/III
 * the tales, F the finale, plus the hand prompts and the title cards.
 *
 * An empty string means "no line here": the storyteller skips it, so a beat
 * can carry an ID a script leaves silent. Changing the words is a change to
 * this file only. (The landing page's words live in index.html.)
 *
 * Line breaks are authored ("\n"), at phrase boundaries: the renderer never
 * re-wraps a line (a row too wide for the ribbon makes the whole line a
 * little smaller instead). tests/copy.test.ts rejects rows that end on a
 * dangling word.
 */

/** A hand prompt: [short small caps, the full-captions version]. */
export type Prompt = readonly [string, string];

export interface Copy {
  P1: string;
  P2: string;
  P3: string;
  H1: string;
  H2: string;
  H3: string;
  I1: string;
  I2: string;
  I3: string;
  I4: string;
  I5: string;
  II1: string;
  II2: string;
  II3: string;
  II4: string;
  II5: string;
  III1: string;
  III2: string;
  III3: string;
  III4: string;
  III5: string;
  F1: string;
  F2: string;
  F3: string;
  F4: string;
  F5: string;
  /** Title cards (drawn in small caps above the emblem). */
  TITLE_I: string;
  TITLE_II: string;
  TITLE_III: string;
  TITLE_F: string;
  /** Hand prompts. */
  REACH: Prompt;
  EARS: Prompt;
  MENU: Prompt;
  SNAP: Prompt;
  BRIDGE: Prompt;
  CLOSER: Prompt;
  BIG: Prompt;
  FINGER: Prompt;
  /** A one-line system notice under the stage while Quest's room capture starts. */
  NOTICE_ROOM: string;
}

/** The script: STORY_V2.md section 3, verbatim (approved 2026-10-28). */
export const COPY: Copy = {
  P1: 'Out in the night,\neveryone is looking\nfor a little light.',
  P2: 'There you are.',
  P3: 'This is Pip. Pip is small,\nand the night is very large.',
  H1: 'Three stories tonight,\nthen bed.',
  H2: 'Another? All right.',
  H3: 'Just one more, then.',
  I1: 'Down at the river,\nthe fireflies\nare dancing…',
  I2: '…and someone\nwith a lot of teeth\nis hungry.',
  I3: 'Pip watches\nfrom the reeds.\nPip is not on the menu.',
  I4: "A swallowed firefly\ndoesn't go out.\nIt glows.",
  I5: 'The hungriest thing\nin the river\nis now its night-light.',
  II1: "Pip's door\nis the little light\nacross the river.",
  II2: 'But the bridge\nhas fallen in.',
  II3: 'The river lends a hand.\nWell, a plank.',
  II4: 'Pip crosses on tiptoe,\nin case hands are ticklish.',
  II5: 'Pip will tell everyone\nabout the hand\nthat held still.',
  III1: 'The moon is up.\nSomething is moving\nin the tall grass…',
  III2: 'Pip tries very hard\nto be small.',
  III3: 'But the wolf\nis only here\nto sing to the moon.',
  III4: 'The scariest shadow\non the hill is yours.',
  III5: "Pip stops shaking.\nIt's a pretty good song.",
  F1: 'Everyone has a light tonight.\nAlmost everyone.',
  F2: 'A crocodile, a bridge,\na giant…\nand now, a branch.',
  F3: "Off it goes, to light\nsomeone else's way home.",
  F4: 'Pip is home.\nSo are you.',
  F5: 'Goodnight.',
  TITLE_I: 'I · The Hungry River',
  TITLE_II: 'II · The Broken Bridge',
  TITLE_III: 'III · The Moon Wolf',
  TITLE_F: 'The Last Light',
  REACH: ['Reach into\nthe light', 'Raise one hand\nbetween the lantern and the wall'],
  EARS: ['Make two long ears', 'Hold up two fingers,\nlike rabbit ears'],
  MENU: ['Rest your shadow\non one', "Rest your hand's shadow\non a story's emblem to open it"],
  SNAP: ['Open wide… and snap', 'Open your hand like jaws,\nthen snap it shut on a firefly'],
  BRIDGE: ['Lie flat.\nBe the bridge.', 'Hold your hand flat and sideways\nso its shadow spans the river'],
  CLOSER: ['Bring it closer\nto you', 'Bring your hand back toward you:\nits shadow grows bigger'],
  BIG: ['Be bigger\nthan the wolf', 'Bring your hand back toward you,\nor raise both hands to make your shadow big'],
  NOTICE_ROOM: "Let's find your walls",
  FINGER: ['Hold one finger\nvery still', 'Hold up one pointing finger\nand keep it still so the bird can land'],
};

