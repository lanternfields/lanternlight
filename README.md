# Lanternlight

**A hand-shadow theatre for your room.** A little paper lantern lights up beside you and turns
your real wall into a stage. Your hands cast shadows that come alive: make a rabbit and it hops
off your fingers, feed a crocodile made of your own hand, build a bridge with your palm so the
rabbit can get home.

Mixed reality WebXR for Meta Quest, built with Meta's **Immersive Web SDK (IWSDK) 1.0.1**.
Hands first (controllers become rod puppets), seated, about 10 minutes, no install: just a URL.

- Live build (after deploy): `https://lanternfields.github.io/lanternlight/`
- Tester mode: add `?tester=1` (FPS/device HUD + checklist). See [TESTER_GUIDE.md](TESTER_GUIDE.md).
- Force the VR "virtual theatre" fallback: add `?vr=1`.

## How it works

| Piece | What it does | Where |
|---|---|---|
| Stage placement | Picks a wall patch in front of the seated viewer from WebXR **plane detection**. It avoids windows, doors and art, stays above desks and monitors (**mesh detection**), and keeps within a comfortable 28°×20° view window. It falls back to a **gaze hit-test**, then to a paper scroll. | `src/core/stage-placement.ts` |
| Shadow projection | A focal light sits below and behind a comfortably held hand, so your hand never hides its own shadow. The shadow size stays constant at any wall distance, and bringing your hand toward the lantern still makes it grow. | `src/core/projection.ts` |
| Shadow model | 25 tracked joints become 2D capsules on the stage, plus palm polygons and a forearm. Rod puppets use the same pipeline. The renderer draws exactly what the physics collides with. | `src/core/shadow-model.ts` |
| Hand shapes | Rotation-, size- and position-invariant features with hysteresis, validated on IWER's captured hand skeletons with 6 mm noise. The core mechanics (position, size, pinch to bite) need no pose recognition. | `src/core/hand-features.ts` |
| Story | Prologue, shadow-touch menu, *The Hungry Crocodile*, *Rabbit's Bridge*. Every beat has an assist; there are no fail states. | `src/core/story.ts`, `src/core/rabbit.ts`, `src/core/physics2d.ts` |
| Rendering | One small offscreen 4-channel mask (max-blended SDF capsules), one composite quad on the wall or scroll, and a room-dimming sphere. Everything is procedural; there are no textures. | `src/render/*` |
| Audio | Fully procedural WebAudio: kalimba lullaby, lantern crackle, foley, HRTF-spatialised. | `src/audio/audio-engine.ts` |
| Perf | Adaptive quality (stage resolution, foveation, shader detail) driven by p90 frame time. Starts lower on Quest 2 and the original Quest. | `src/core/perf.ts` |

**Comfort and accessibility:**
- Seated, with zero locomotion.
- Every tale can be done with one hand, and left-handed mode is supported.
- Gentle mode: bigger targets, faster dwell, stronger assists.
- Captions, high-contrast stage, reduced motion, adjustable room dimming.
- Clean pause/resume when the headset comes off.
- Lantern menu: tap and hold the lantern.

## Run locally (desktop emulator)

```sh
npm install
npm run dev:emu        # Vite + IWER emulator at https://localhost:8081/
```

Open the URL in desktop Chromium and press **Begin**. IWER (the WebXR emulator injected by the
IWSDK dev plugin, on localhost only) emulates a Quest 3 in captured rooms. The IWSDK-managed
alternative is `npm run dev`.

## Tests

```sh
npm test               # unit tests (vitest): placement fuzz over 3000 rooms, projection,
                       # physics, story beats, captured-skeleton classifier, perf controller
npm run dev:emu &      # then, with the server running:
npm run e2e            # headless Playwright + IWER: hands-only playthrough, controller-only
                       # playthrough, 5 captured rooms + no-scan x 4 headings, perf budget
```

The e2e suite drives the real app with emulated hands through IWER's remote-control API. It
injects IWER 2.7's MIT-licensed pose library (`npm run poses:build`), because the IWER build in
IWSDK 1.0.1 ships only three hand poses. Frame times in headless SwiftShader are not
device-representative; the budget checks are structural (draw calls, triangles).

## Build and deploy (GitHub Pages)

```sh
npm run build          # static site in dist/ (relative asset paths work under /lanternlight/)
```

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`.
One-time setup in the repo: *Settings → Pages → Source: GitHub Actions*.
**Competition freeze:** no pushes from Nov 18, 2026 12:00 PT until winners are announced (~Dec 11).

## Assets and credits

- Every visual and sound is generated at runtime: geometry, shaders and WebAudio synthesis. No
  third-party art, audio or fonts are shipped; text uses system serif fonts.
- `tools/iwer-poses/` vendors four files of Meta's Immersive Web Emulation Runtime (MIT
  License, Copyright (c) Meta Platforms, Inc.). They are used only at test time.
- Built on IWSDK (MIT) and three.js (MIT).

## Built with AI assistance

This project was designed and implemented with AI assistance (**Claude Code**, Anthropic): the
concept, code, tests and documentation. A human directed the project and handles accounts,
publishing and submission.
