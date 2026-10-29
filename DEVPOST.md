# Lanternlight: Devpost page copy (draft)

Copy for the Meta Horizon Start Developer Competition 2026 entry page. It is written to sell the
mixed reality on the first screen and to answer "why isn't this the hand-shadow game I've seen?".
Items marked **[device day]** are filled in from the Quest 3 session (see
`SUBMISSION_CHECKLIST.md`).

---

## First screen

**Title:** Lanternlight

**Tagline (115 characters):**
> Mixed reality shadow theatre for Quest: your real hands cast shadows on your real wall, and the shadows come alive.

**Thumbnail [device day]:** a Quest 3 point-of-view still. A real hand makes two long ears, and Pip the
rabbit springs off their shadow on a real wall, with a real light switch or picture frame at the edge
of the lamplight and the paper lantern on a real table below.

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
- **Distance is the mechanic.** Bring your hand back toward you and its shadow grows: that is how you
  become a giant big enough to scare the Moon Wolf. Only a tracked 3D hand can do that.
- **Your real hand stays in front.** No virtual layer ever paints over your hand: it reads as a
  backlit silhouette against the lamplit wall, as a shadow-puppeteer's hand does.
- **A spark crosses your real room.** In the finale a spark leaves the real lantern on your table and
  arcs across the room to a paper bird perched on your finger's shadow.

## What you do

There is no score and there are no fail states: it is a seven-minute wind-down, a bedtime story you
perform with your hands.

1. **Prologue.** Reach into the light: there you are. Make two long ears: Pip springs off your fingers.
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

## The first five minutes

- **About 5 s** from lighting the lantern to your own shadow on your wall.
- **About 10 s** to your first creature: Pip springs off your two fingers.
- **Zero tutorial text.** A faint ghost hand shows each shape; words appear only if you pause.
- **[device day]** Time to finish all three tales and the finale, measured on Quest 3.

## Built with

- **Immersive Web SDK (IWSDK) 1.0.1**, WebXR `immersive-ar`, in the Meta Quest Browser: open a link,
  no install.
- **Hand tracking** (25 joints per hand) drives the shadow model: the shadow is cast from your tracked
  joints through a virtual lantern onto the wall, with a physically scaled soft edge. Controllers work
  too, as shadow puppets on sticks.
- **Plane and mesh detection with semantic labels** (walls, tables, desks, windows, doors, screens),
  **room capture** from inside the session when there is no scan, and **hit-test** as a fallback.
- **Depth-only hand occlusion**, so the virtual layers never cover your real hand.
- **Adaptive quality:** 90 Hz requested on Quest 3/3S, quality driven by missed vsyncs.
  **[device day]** Measured: __ fps on Quest 3 in the busiest scene (HUD still on this page).
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
- **Submitted build [submission day]:** tag `submission` at commit `________`

## Credits and licences

- Typeface: **EB Garamond** by Georg Duffner and Octavio Pardo (SIL Open Font License 1.1).
- Built on IWSDK (MIT) and three.js (MIT). Two Lucide icons (ISC). WebXR Input Profiles models (MIT)
  in the emulator and the virtual theatre.
- **Built with AI assistance** (Claude Code, Anthropic): concept, code, tests and documentation. A
  human directed the project. The video is real device footage; no AI-generated video.
