# Lanternlight: Devpost page copy (final, Nov 12)

Copy for the Meta Horizon Start Developer Competition 2026 entry page. It is written to sell the
mixed reality on the first screen and to answer "why isn't this the hand-shadow game I've seen?".
No Quest 3 session happened, so every claim here is either shown in IWSDK's emulator (IWER) or
reported by our Quest 2 tester, and the page says which. The field-by-field paste sheet is
`../submission-2026-11/SUBMIT.md`.

---

## First screen

**Title:** Lanternlight

**Tagline (115 characters):**
> Mixed reality shadow theatre for Quest: your real hands cast shadows on your real wall, and the shadows come alive.

**Thumbnail:** `../submission-2026-11/thumbnail-3x2.png` (1200×800, the video at 0:12, emulator).
Two fingers make long ears and Pip the rabbit springs off their shadow, with the paper lantern on the
table below.

**First paragraph:**
> Put on your Quest, light a paper lantern on your own table, and your room's lights go down around a
> warm pool on your own wall. Raise your bare hand and its shadow is the star of a bedtime story: a
> crocodile for a hungry river, a bridge for a small rabbit, a giant on a moonlit hill. A crocodile, a
> bridge, a giant… and now, a branch.

**Not a puzzle in a virtual room: a bedtime story on your own wall.**

---

## What only mixed reality can do

- **Your wall is the stage.** Plane and mesh detection find the wall in front of you (and the free part
  of it above your desk or beside your monitor) and light it like a theatre. No room scan? The app
  opens Quest's room setup for you, once ("Let's find your walls").
- **The lantern sits on your real table.** It looks for every table or desk within reach and settles
  on it, beside your hands, not in their way.
- **Your room's lights go down, and come back up.** The room dims like a theatre's house lights when
  the show starts; at the end, the bird carries the lantern's light away and your own room returns,
  lit by a soft amber glow.
- **Distance is the mechanic.** Pull your hand back toward you and its shadow grows over Pip; reach
  for the wall and it shrinks again. The story teaches this in its first minute, and it is how you
  later become a giant big enough to scare the Moon Wolf. Only a tracked 3D hand can do that.
- **Your real hand stays in front.** The app writes your tracked hand's shape into the depth buffer,
  so the stage is drawn behind your real hand and the hand reads as a silhouette against the lamplit
  wall, as a shadow-puppeteer's hand does. This only runs on a headset, so the emulator video doesn't
  show it, and we haven't seen it on a Quest 3. If it ever looks wrong in your room, untick "Keep my
  real hand in front of the stage" under Settings on the start page (or open the link with
  `?occluder=0`).
- **A spark crosses your real room.** In the finale a spark leaves the real lantern on your table and
  arcs across the room to a paper bird perched on your finger's shadow.

## What you do

There is no score and there are no fail states: it is a short wind-down, a bedtime story you
perform with your hands.

1. **Prologue.** Reach into the light: there you are. Make two long ears: Pip springs off your fingers.
   Pull your hand back and you grow, looming over Pip, who ducks; reach for the wall and you shrink,
   and Pip hops back beside you.
2. **I · The Hungry River.** Your hand becomes a crocodile. Open wide and snap at the fireflies: each
   one you swallow keeps glowing in your throat, until the full crocodile drifts off as the river's
   night-light. Pip watches from the reeds.
3. **II · The Broken Bridge.** Lie your hand flat across the river and Pip crosses on tiptoe to the
   little light of home.
4. **III · The Moon Wolf.** Something is moving in the tall grass. Bring your hand toward you until
   your shadow is bigger than the wolf: its ears flatten, Pip trembles, the lamplight brightens, and
   the wolf bolts. Then the twist: it was only here to sing to the moon. The scariest shadow on the
   hill was yours.
5. **The Last Light.** A paper bird has nowhere to land. Hold one finger very still: it lands on your
   finger's shadow, takes a spark from your lantern and flies off to light someone else's way home.
   Pip is home. So are you.

## The first minute

- **About 5 s** from lighting the lantern to your own shadow on your wall (emulator run in the video).
- **About 10 s** to your first creature: Pip springs off your two fingers.
- **No tutorial screens.** The storyteller's lines say what to do; a faint ghost hand shows each shape,
  and extra hint words appear only if you pause.
- **About 25 s** to growing over Pip and shrinking again: the distance mechanic, taught by the story.

## How we tested it

- **In IWSDK's emulator (IWER):** scripted hand sequences play every tale and the finale; the video
  is one of those runs. A room sweep seats a player at 27 positions across simulated rooms: wherever
  the wall ahead can take the stage, it does, and every blocked seat (a window, a screen, furniture)
  shows a prompt to try another wall. 203 automated tests.
- **On a real headset:** one tester played the build on a Quest 2 (black-and-white passthrough). We
  have not tested on a Quest 3 or 3S. Their favourite part was the shadow growing and shrinking as
  their hand moved, so the story now teaches that first. They also found it a little laggy on
  Quest 2: the crocodile costume trailed the hand by about a quarter of a second, and now it doesn't.

## Built with

- **Immersive Web SDK (IWSDK) 1.0.1**, WebXR `immersive-ar`, in the Meta Quest Browser: open a link,
  no install.
- **Hand tracking** (25 joints per hand) drives the shadow model: the shadow is cast from your tracked
  joints through a virtual light onto the wall, with a soft edge that sharpens a little as your hand
  nears the wall. Controllers work
  too, as shadow puppets on sticks.
- **Plane and mesh detection with semantic labels** (walls, tables, desks, windows, doors, screens),
  **room capture** from inside the session when there is no scan, and **hit-test** as a fallback.
- **Hand occlusion from the tracked joints** (written to depth only), so on a headset the virtual
  layers stay behind your real hand.
- **Adaptive quality:** 90 Hz requested on Quest 3/3S, quality driven by missed vsyncs.
- **Everything is generated at runtime:** paper-cut art, shaders and a procedural WebAudio
  soundtrack. No third-party art or audio.

## Accessibility

- Seated, no locomotion; every tale can be done with **one hand**, either hand.
- **Gentle mode** (bigger targets, stronger assists), **full captions** that explain each step,
  **high-contrast stage**, **reduced motion**, adjustable room dimming.
- No fail states: every beat has an assist (a paper plank for the bridge, a timid wolf, a bird that
  lands anyway).

## Track

**Entertainment**: an interactive bedtime story and shadow theatre, with no score and no fail states.
If the organisers place a hands-up experience in Gaming instead, that fits too.

## Links

- **Play (GitHub Pages):** https://lanternfields.github.io/lanternlight/ (open in the Meta Quest
  Browser)
- **Source:** https://github.com/lanternfields/lanternlight
- **Submitted build:** commit `673ec61` (live on GitHub Pages since Oct 30, unchanged since)

## Credits and licences

- Typeface: **EB Garamond** by Georg Duffner and Octavio Pardo (SIL Open Font License 1.1).
- Built on IWSDK (MIT) and three.js (MIT). Two Lucide icons (ISC). WebXR Input Profiles models (MIT)
  in the emulator and the virtual theatre.
- **Built with AI assistance** (Claude Code, Anthropic): concept, code, tests and documentation. A
  human directed the project. The video is a screen capture of the app running in IWSDK's emulator
  (IWER) with scripted hand poses, with the app's own procedural sound. No AI-generated video.
