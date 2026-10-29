# Lanternlight: submission checklist and device-day checklist

Deadline: **Nov 18, 2026, 12:00 PT**. Winners around **Dec 11**. Freeze target: Nov 11.
Rules source: PLAN.md §1 (verified Oct 27; Devpost returned HTTP 403 to later checks, so re-read the
rules page in a browser before submitting).

Owner key: **H** = the human (accounts, device, submission), **A** = the build agent.

---

## 1. Now (blocking, human)

- [ ] **H** Eligibility: the "Start Member" forum flair and Meta Developer Access are in place
  (disqualifying if missing at submission time).
- [ ] **H** Devpost account and team entry created; the track chosen (Entertainment; Gaming is an
  acceptable reassignment).
- [ ] **H** The Quest 3 is set up for capture: Meta Quest Developer Hub (MQDH) or on-device recording
  at the highest resolution the device allows.

## 2. Device day (Quest 3, with `?tester=1`)

Open https://lanternfields.github.io/lanternlight/?tester=1 in the Meta Quest Browser. The Tester
card shows fps, mode, planes and a checklist. Keep a screenshot of anything below that fails.

**Performance (rubric floor: 60 fps on Quest)**
- [ ] Busiest scene: the Moon Wolf giant (two hands up, the ribbon up, the full-room dim). Record the
  HUD fps and frame times. Keep the still for Devpost.
- [ ] If 90 Hz is not rock-solid, request 72 Hz (`src/core/device.ts`, `preferredFrameRate`):
  stable beats high.
- [ ] Repeat the busiest scene on a **Quest 3S** if one is available (judges play on 3 and 3S).

**Scene understanding (changes B and C)**
- [ ] Lantern rests **on the real table**, not floating, at a desk and at a coffee table.
- [ ] Stage lands **on the real wall** in three rooms (bedroom, living room, office), including
  seated at a desk facing a wall with a monitor.
- [ ] **Clear Space Setup**, start the app: after about 3 s it says *Let's find your walls* and opens
  room capture; finish it and the stage moves onto the wall. Cancel it once too: the paper scroll
  works.
- [ ] A wall 3.5–4.5 m away and one about 0.6 m away both take the stage.

**Hands (change D)**
- [ ] **No virtual layer cuts over the real hand:** hand over the paper scroll, fingertip resting on
  the lantern (menu), the hand in front of the caption ribbon, and the giant beat. If the hand is
  cut off or the stage vanishes behind it wrongly, note where.
- [ ] The real hand reads as a dim, backlit silhouette against the lamplit wall.

**Tracking and feel**
- [ ] Croc bite registers on the first try, **3 of 3**, several times.
- [ ] Flat-hand bridge tracks when seen from above; Pip crosses with **no stall prompt** under the
  line.
- [ ] The giant: pulling the hand toward the face loses no tracking and **does not trigger the system
  pinch menu** (palm toward the face). If it does, reword the wolf prompt to lead with "raise both
  hands", or lower the size threshold.
- [ ] One still finger lands the bird within about 2 s (hold detection on real tracking jitter).
- [ ] Comfort: playable with an elbow resting on the table or armrest. Note any arm fatigue.
- [ ] Time a competent run: about 90 s or less per tale, **8 minutes or less** to "Goodnight." If
  over, trim line holds and bridge dead time first.

**The ending**
- [ ] The bird carries the spark; the lantern stays low and warm; the room's dimming lifts with a
  soft amber glow (on Quest 3 colour passthrough, and note how it looks on Quest 2 greyscale).
- [ ] Captions are legible at arm's length in the headset; audio levels are comfortable.

## 3. Footage (the video replaces the emulator capture)

Shoot every mixed-reality shot from the device. Light the real room brightly (the app supplies the
darkness), hold the head steady, look slightly above the hand, record each beat 5–10 times.

Shot list (each one proves something):
1. [ ] The lantern resting on a real table, not floating.
2. [ ] The stage on a real wall, with a real light switch or frame at the edge of the pool.
3. [ ] Hand and shadow in one frame, with a fast finger wiggle (latency).
4. [ ] The croc bite on the first try, three times in a row.
5. [ ] The flat-hand bridge seen from above; Pip crosses; no stall prompt.
6. [ ] The giant: hand pulled toward the face, crisp giant shadow, the wolf bolts.
7. [ ] No virtual layer over the real hand (scroll, lantern touch, giant).
8. [ ] The finale: the bird lands, the spark crosses the real room, the lights come back up.
9. [ ] The Tester HUD in the busiest scene at 72+ fps (90 if requested): a still for Devpost.
10. [ ] Seated comfort: elbow on the table.
11. [ ] Three rooms, one without Space Setup (room capture or the scroll).
12. [ ] A third-person phone shot from behind, in silhouette (no identifiable people).

Video structure (2:00–2:30, under 3:00): real-room cold open with the lantern blooming on the table
and the lights going down; the real hand rises and its shadow follows; Pip springs off two fingers
(title); the third-person silhouette shot with "Mixed reality · Meta Quest 3 · hands only · in the
browser"; four 3–4 s beats (a mouth · a bridge · a giant · a branch); the Moon Wolf nearly in full;
three rooms and the HUD; the finale with the lights coming up on the real room; end card with the
URL. Cut the landing page, the hub selection, the mannequin inset and every emulator shot (label any
that must stay "emulator"). Any voice-over: a human voice, not text-to-speech.

## 4. Before submission (A and H)

- [ ] **A** All tests green: `npm run typecheck`, `npm test`, `node e2e/run-all.mjs` (rooms sweep:
  lantern on a table whenever one is in reach; a wall stage in 85%+ of seats with a wall in range).
- [ ] **A** Fill the device-day blanks in `DEVPOST.md` (measured fps, time to finale, thumbnail).
- [ ] **A** Every claim in `DEVPOST.md` checked against the device-day results; anything not shown on
  device is removed or softened.
- [ ] **H** Video uploaded, **public**, on YouTube or Vimeo, under 3 minutes.
- [ ] **H** Devpost fields: tagline, description, thumbnail, video link, **GitHub Pages URL** (the
  WebXR "GitHub page" link) and the repository URL, track, built-with, team.
- [ ] **H** Assets and licences listed (EB Garamond OFL, IWSDK and three.js MIT, Lucide ISC, WebXR
  Input Profiles MIT); AI assistance disclosed (README, landing page, Devpost).

## 5. Build freeze (disqualifying if broken)

The judged build must not change from the deadline until winners are announced (~Dec 11). Every push
to `main` redeploys GitHub Pages, and the workflow can also be started by hand.

- [ ] **A** Final deploy from `main`; check the live site plays end to end on the Quest.
- [ ] **A** Tag it: `git tag submission <sha>` and push the tag; put the SHA on the Devpost page.
- [ ] **H** After the final deploy, **disable the Pages workflow** (Actions → Deploy to GitHub Pages
  → Disable workflow) **or** protect `main` until Dec 11.
- [ ] **A/H** Nobody pushes to `main` between Nov 18 12:00 PT and ~Dec 11. Docs or fixes go on
  another branch and are not merged.
- [ ] **H** Check the site still loads on ~Dec 1 (GitHub Pages, pinned CDN assets).
