/**
 * Every word that appears on the stage, in ONE table keyed by the line IDs of
 * the script (hackathons/meta-a3/STORY_V2.md): P prologue, H hub, I/II/III
 * the tales, F the finale, plus the hand prompts and the title cards.
 *
 * An empty string means "no line here": the storyteller skips it, so a beat
 * can carry an ID a script leaves silent. Changing the words is a change to
 * this file only. (The landing page's words live in index.html.)
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
}

/** The script: STORY_V2.md section 3, verbatim (approved 2026-10-28). */
export const COPY: Copy = {
  P1: 'Out in the night, everyone is looking for a little light.',
  P2: 'There you are.',
  P3: 'This is Pip. Pip is small, and the night is very large.',
  H1: 'Three stories tonight, then bed.',
  H2: 'Another? All right.',
  H3: 'Just one more, then.',
  I1: 'Down at the river, the fireflies are dancing…',
  I2: '…and someone with a lot of teeth is hungry.',
  I3: 'Pip watches from the reeds. Pip is not on the menu.',
  I4: "A swallowed firefly doesn't go out. It glows.",
  I5: 'The hungriest thing in the river is now its night-light.',
  II1: "Pip's door is the little light across the river.",
  II2: 'But the bridge has fallen in.',
  II3: 'The river lends a hand. Well, a plank.',
  II4: 'Pip crosses on tiptoe, in case hands are ticklish.',
  II5: 'Pip will tell everyone about the hand that held still.',
  III1: 'The moon is up. Something is moving in the tall grass…',
  III2: 'Pip tries very hard to be small.',
  III3: 'But the wolf is only here to sing to the moon.',
  III4: 'The scariest shadow on the hill is yours.',
  III5: "Pip stops shaking. It's a pretty good song.",
  F1: 'Everyone has a light tonight. Almost everyone.',
  F2: 'A crocodile, a bridge, a giant… and now, a branch.',
  F3: "Off it goes, to light someone else's way home.",
  F4: 'Pip is home. So are you.',
  F5: 'Goodnight.',
  TITLE_I: 'I · The Hungry River',
  TITLE_II: 'II · The Broken Bridge',
  TITLE_III: 'III · The Moon Wolf',
  TITLE_F: 'The Last Light',
  REACH: ['Reach into the light', 'Raise one hand between the lantern and the wall'],
  EARS: ['Make two long ears', 'Hold up two fingers, like rabbit ears'],
  MENU: ['Rest your shadow on one', "Rest your hand's shadow on a story's emblem to open it"],
  SNAP: ['Open wide… and snap', 'Open your hand like jaws, then snap it shut on a firefly'],
  BRIDGE: ['Lie flat. Be the bridge.', 'Hold your hand flat and sideways so its shadow spans the river'],
  CLOSER: ['Bring it closer to you', 'Bring your hand back toward you: its shadow grows bigger'],
  BIG: ['Be bigger than the wolf', 'Bring your hand back toward you, or raise both hands, to make your shadow big'],
  FINGER: ['Hold one finger very still', 'Hold up one pointing finger and keep it still so the bird can land'],
};

