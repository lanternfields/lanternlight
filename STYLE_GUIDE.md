# Lanternlight style guide

Lanternlight has one visual language: **a paper-cut shadow theatre lit by a
single lantern**. Every mark on the stage is either lamplight or a shadow
thrown by that lamp. If an element doesn't look like it could come from a
lantern, a paper cut-out or a hand, it doesn't belong.

This guide is the reference for every visual and motion change. The audit
stills in `artifacts/style/` (produced by `node e2e/style-stills.mjs`) are
checked against it.

---

## 1. Light, shadow and paper

### Edges: one soft-edge model

Everything on the stage is rendered into the shadow mask (`ShadowStage`). The
mask is then blurred by **the same penumbra pass**, so all edges come from a
single lantern:

| Layer | Channel | Edge |
| --- | --- | --- |
| Hands, rod puppets, **ghost hints** | R (cast shadow) | physical penumbra: flame radius 3.5 mm × distance (clamped 0.004–0.022 stage units) |
| Paper cut-outs (rabbit, wolf, crocodile, scenery, emblems) | G (cut-out) | fixed "paper on the screen" penumbra: **0.0045 stage units** |
| Holes (eyes, burrow door, shell spiral) | A (hole) | the same as cut-outs |
| Light (moon, fireflies, sparkles, icon rings) | B (light) | always soft glows; never hard-edged |

Rules:
- Ghost hints are cast by **the same caster as the player's hand** (tapered
  finger capsules, palm contour, forearm fade), just fainter. There is no
  second "hint" hand model anywhere.
- No outlines or strokes on silhouettes. A silhouette reads by its contour.
- Cut-outs block light: glows behind a cut-out are hidden by it, so the
  wolf is a true silhouette against the moon.
- Shadows are **true black-brown** (`#080605`, 88% opacity over passthrough,
  97% in high contrast). Never grey, never coloured.

### Palette (tight; nothing else on stage)

| Token | Hex | Use |
| --- | --- | --- |
| `lamp-core` | `#FFD9A0` | centre of the light pool, the flame |
| `lamp-mid` | `#F7A65A` | the pool between centre and edge |
| `lamp-edge` | `#B8541E` | the pool's falloff, the lantern's warm spill |
| `glow` | `#FFE6A8` | fireflies, moon, sparkles, icon rings, title emblem discs |
| `shadow` | `#080605` | all shadows and cut-outs |
| `house` | `#0B0705` | the dimmed room (warm black, not blue) |
| `paper` | `#F2E6CF` | the paper scroll fallback |
| `wood` | `#4A2E1C` / `#2B1A10` | lantern frame, scroll dowels, rod sticks |
| `caption` | `#FFE8C4` on a soft `#140A04` shadow | captions and the tester card |

High-contrast mode swaps the pool to near-white (`#FFF5E0`) and shadows to
pure black; the shapes do not change.

### The light pool

- Radial falloff from a hot centre, not a flat disc: core → mid → edge in
  colour as well as brightness, with a smooth tail into the dimmed room.
- The pool breathes with the flame by at most ±6% (no flicker in reduced
  motion).

### Silhouette design

- Creatures are drawn as **paper cut-outs**: smooth curved contours,
  pointed details (ears, teeth, tail tips), one cut-out eye that lets the
  light through. Cut-outs are made of smooth curves and capsules, never polygons
  that show facets at stage scale.
- One level of detail: a detail must be at least 0.008 stage units
  (≈ 1 cm on a 1.2 m stage) or it is dropped.
- Grass, reeds and banks use the same capsule language as the creatures, so
  nothing looks like it comes from another kit.

### Typeface

- **One typeface: EB Garamond** (SIL Open Font License, bundled with the app
  via `@fontsource`, so the Quest browser and the capture match). Captions
  use the italic, the tester card uses the regular weight.
- Captions are short, sentence case and wordless whenever possible: a tale
  must read without them (see §3).

---

## 2. Resolution and filtering

Nothing may look pixelated or shimmer, on a Quest or in the capture.

| Surface | Setting |
| --- | --- |
| Shadow stage target | 4× MSAA, linear filtering. Resolution = quality level: 384 / 512 / 768 / **1024** px wide (Quest 3, desktop and capture start at 1024; Quest 2 at 768; original Quest at 512) |
| Penumbra blur | separable 9-tap gaussian at the target's resolution (the radius is in stage units, so it looks the same at every quality level) |
| Canvas text (captions, tester card, lantern menu) | drawn at 2× the size it appears at, **mipmapped** (`LinearMipmapLinearFilter`), anisotropy 4 |
| 3D meshes near the viewer (lantern, rod puppets, scroll dowels) | ≥ 32 radial segments, ≥ 48 for lathed shapes; no visible facets at 30 cm |
| Main renderer | `antialias: true`, `devicePixelRatio` from the device (IWSDK default); XR framebuffer scale 1.0 |
| Capture | 1920×1080, frame-stepped at 60 fps, JPEG q95 → H.264 CRF 16 |
| Texture filtering | **never** `NearestFilter`; every texture is linear (mipmapped if it can be minified) |

Adaptive quality may lower the stage resolution under load; it never
changes the look (edges stay soft because the penumbra is in stage units).

---

## 3. Every tale reads in two seconds, without text

Each tale opens with a **wordless title card**: a disc of lamplight with a
paper-cut emblem (0.4 s in, 1.4 s hold, 0.5 s out), then the setting fades in.

| Tale | Emblem | Setting | The player's hand becomes... |
| --- | --- | --- | --- |
| The Hungry Crocodile | a crocodile head, jaws open, a firefly before it | a river along the bottom, reeds and bulrushes on both banks, lily pads | a crocodile: cut-out eye, brow, nostril, back scutes along the hand and forearm, teeth that open and close with the jaw |
| Rabbit's Bridge | a rabbit on a plank over water | two banks with a gap and a river, the rabbit's burrow with a lit doorway on the far bank | a bridge (ghost hint: a flat hand across the gap) |
| The Moon Wolf | a wolf howling at the moon | a meadow with hills, the moon rising, the rabbit trembling by its burrow | something big and brave (two hands are bigger) |

Feedback is always visual **and** audible: a chomp snaps the teeth shut, a
caught firefly flies into the mouth and flashes, and the crocodile's throat
glows as it swallows.

---

## 4. Motion

Animation follows the classic principles. Shared helpers live in
`src/core/ease.ts` (easing curves, critically damped springs and pose
keyframes).

1. **No linear tweens, no popping.** Every value that changes on screen goes
   through an easing curve or a spring. A state change (e.g. the wolf sitting
   down) blends its pose over 0.2–0.4 s; nothing snaps between poses.
2. **Anticipation.** Rabbit hops start with a 0.08 s crouch; the wolf crouches
   before it flees; the crocodile's teeth slide out before the jaw opens.
3. **Squash and stretch** with volume preserved (x = 1/√y): stretch on take-off,
   squash on landing, recover with a damped spring.
4. **Arcs.** Hops, firefly flights and the scripted demo hand follow curves,
   never straight lines.
5. **Ease in/out.** Default curves: `easeInOutCubic` for moves,
   `easeOutBack(1.4)` for things appearing (a little overshoot),
   `easeInCubic` for things leaving.
6. **Follow-through and secondary motion.** Rabbit ears and the wolf's tail
   lag behind the body on springs; the crocodile's teeth settle after a snap;
   reeds sway.
7. **No jitter.** Ambient motion uses smooth noise, not per-frame random
   numbers. Real hand tracking is used as it comes (that's the player's own
   hand), but everything driven *from* it (the crocodile overlay, the eye) is
   smoothed.
8. **Timing.** Scene transitions: 0.6 s out + 0.6 s in, `easeInOutSine`.
   Captions: fade 0.35 s. Menu icons: appear over 0.5 s, staggered 0.12 s.
   Title cards: 0.4 / 1.4 / 0.5 s.
9. **Scripted hands** (demo capture and ghost hints) move along critically
   damped springs (damping ratio 0.85, so moves overshoot a little), hold
   on key poses (≥ 0.4 s) and blend between poses with ease in-out. They
   never snap.

Verification: `node e2e/style-stills.mjs <label>` records the per-frame
on-stage positions of the rabbit, wolf, a firefly, the crocodile eye overlay and
the demo hand's fingertip shadow in a frame-stepped run. `e2e/tools/motion_plot.py`
plots position and speed for each (`artifacts/style/<label>-motion.png`) and
counts **pops**: single-frame jumps larger than 6× the element's own
95th-percentile step (and > 0.02 stage units), outside scene cuts and fades.
The target is zero pops for every element.

---

## 5. Credits

All art is original, procedural, and made in code. The only third-party asset
is the EB Garamond typeface (SIL OFL 1.1, by Georg Duffner and Octavio
Pardo).
