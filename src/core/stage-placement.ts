/**
 * Where does the show happen?
 *
 * Given the room's detected planes (WebXR plane detection / Quest Space Setup)
 * and where the seated viewer is looking, pick:
 *   - a wall patch in front of the viewer to become the lit stage, or
 *   - the paper scroll (a first-class stage, never an error state) when no wall
 *     qualifies: no scan, wall too far/near, wall covered by windows, etc.
 * and a spot for the lantern: on a table/desk in front of the viewer, else a
 * gently floating sky-lantern.
 *
 * Pure function of its inputs so it can be fuzzed against thousands of rooms.
 */
import { V3, addScaled, clamp, cross, dot, normalize, sub } from './math.js';
import {
  StageFrame,
  createStageFrame,
  orientStage,
  stageHeightForDistance,
} from './projection.js';

export interface PlaneInfo {
  id: string;
  orientation: 'horizontal' | 'vertical' | 'unknown';
  /** Raw semantic label from the runtime (any case/format). */
  label: string;
  /** World-space polygon outline (closed implicitly). */
  points: V3[];
  /** World-space unit normal (the plane's +Y; on a horizontal plane it may point down: the emulator gives tables a downward +Y). */
  normal: V3;
}

export type StageKind = 'wall' | 'scroll';

export interface StagePlacement {
  kind: StageKind;
  frame: StageFrame;
  /** Perpendicular viewer distance to the stage surface (m). */
  distance: number;
  planeId: string | null;
  /** Why the scroll was chosen (for diagnostics / tests). */
  reason: string;
  score: number;
  /**
   * When the best usable wall is 30-45 degrees off to the side: how far
   * (degrees; > 0 to the viewer's right, < 0 to the left). The stage is placed
   * there and the viewer is nudged to turn a little. 0 = straight ahead enough.
   */
  turnDeg: number;
}

/** Off to the side beyond this, the viewer is nudged to turn (degrees). */
export const TURN_NUDGE_DEG = 30;
/** ...and beyond this the wall is too far round: the scroll instead. */
export const MAX_SIDE_DEG = 45;

export interface LanternPlacement {
  position: V3;
  /** True when it rests on a detected table/desk. */
  onSurface: boolean;
  planeId: string | null;
}

/** A furniture bounding box (from mesh detection) that can hide part of a wall. */
export interface Obstacle {
  label: string;
  min: V3;
  max: V3;
}

/**
 * Lowest wall height (world y) that is visible above everything standing
 * between the viewer and the wall within the stage's horizontal footprint:
 * the shadowed region under the sight line over each obstacle's far top edge.
 */
export function occlusionHeight(
  head: Readonly<V3>,
  dir: Readonly<V3>,
  wallDistance: number,
  halfWidth: number,
  planes: readonly PlaneInfo[],
  obstacles: readonly Obstacle[],
): number {
  let yOcc = -Infinity;
  const right = new V3(-dir.z, 0, dir.x);
  const consider = (pts: readonly V3[], top: number) => {
    if (top >= head.y - 0.15) return; // near/above eye level: a keep-out area instead
    let far = 0;
    // does the surface reach across the stage's footprint? (its sideways extent,
    // not just its corners: a wide desk has no corner in front of the viewer)
    let sideMin = Infinity;
    let sideMax = -Infinity;
    for (const p of pts) {
      const rx = p.x - head.x;
      const rz = p.z - head.z;
      const along = rx * dir.x + rz * dir.z;
      const side = rx * right.x + rz * right.z;
      if (along > 0.05 && along < wallDistance + 0.05) {
        sideMin = Math.min(sideMin, side);
        sideMax = Math.max(sideMax, side);
      }
      far = Math.max(far, Math.min(along, wallDistance));
    }
    const reach = halfWidth + 0.15;
    const lateralHit = sideMin < reach && sideMax > -reach;
    if (!lateralHit || far < 0.1) return;
    const y = head.y + ((top - head.y) * wallDistance) / far;
    if (y > yOcc) yOcc = y;
  };
  for (const p of planes) {
    if (p.orientation === 'vertical' || Math.abs(p.normal.y) < 0.85) continue;
    const label = normalizeLabel(p.label);
    if (label === 'floor' || label === 'ceiling') continue;
    const top = p.points.reduce((a, q) => a + q.y, 0) / p.points.length;
    consider(p.points, top);
  }
  for (const o of obstacles) {
    const label = normalizeLabel(o.label);
    if (label === 'globalmesh' || label === 'floor' || label === 'ceiling' || label === 'wallface') continue;
    const corners = [
      new V3(o.min.x, o.max.y, o.min.z),
      new V3(o.max.x, o.max.y, o.min.z),
      new V3(o.min.x, o.max.y, o.max.z),
      new V3(o.max.x, o.max.y, o.max.z),
    ];
    consider(corners, o.max.y);
  }
  return yOcc;
}

export interface PlacementOptions {
  minDistance: number;
  maxDistance: number;
  preferredDistance: number;
  /** Max angle (deg) between gaze and wall normal. */
  maxFacingDeg: number;
  /** Stage vertical half-angle (deg) - FoV-aware sizing. */
  verticalHalfAngleDeg: number;
  aspect: number;
  /** Paper scroll distance from the viewer (m). */
  scrollDistance: number;
  /** User size preference multiplier (0.75 .. 1.25). */
  sizeScale: number;
}

// Wide acceptance (the judge: walls landed in only 8 of 20 scanned seats):
// near walls get a smaller stage, far walls a bigger one (the light is
// virtual, so the shadow's size is set by where the light sits, not the room).
export const DEFAULT_PLACEMENT: PlacementOptions = {
  minDistance: 0.6,
  maxDistance: 4.5,
  preferredDistance: 1.9,
  maxFacingDeg: 60,
  verticalHalfAngleDeg: 14,
  aspect: 1.45,
  scrollDistance: 1.25,
  sizeScale: 1,
};

/**
 * The smallest wall stage worth having, as a fraction of the paper scroll's
 * angular height (smaller than this and the scroll is the better stage).
 */
export const MIN_STAGE_FRACTION = 0.45;

/** Normalises runtime labels ('WALL_FACE', 'wall', 'Wall Art') to 'wallface' etc. */
export function normalizeLabel(label: string | undefined | null): string {
  return (label ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

const WALL_LABELS = new Set(['wall', 'wallface', '', 'other', 'unknown', 'global']);
/**
 * What blocks a spot on a wall: a shadow can't fall on a screen, a window, a
 * mirror or open shelving, nor where there is no wall at all (an invisible
 * wall face is an opening). Doors, framed wall art and cupboard fronts are
 * fine surfaces (a real shadow falls on them perfectly well; at most a little
 * contrast is lost), so they cost only a little.
 */
const BLOCKING_LABELS = new Set(['window', 'windowframe', 'screen', 'mirror', 'shelf', 'invisiblewallface']);
const SURFACE_OK_LABELS = new Set(['door', 'doorframe', 'wallart', 'storage', 'cabinet', 'cupboard']);
/** Tall furniture whose front is a fine surface when it stands against the wall. */
const FRONT_OK_LABELS = new Set(['storage', 'cabinet', 'cupboard', 'wallart', 'door']);
const SURFACE_LABELS = new Set(['table', 'desk', 'other', '', 'unknown', 'storage', 'shelf']);

interface Rect {
  r0: number;
  r1: number;
  u0: number;
  u1: number;
}

function extentsOnFrame(
  points: readonly V3[],
  origin: Readonly<V3>,
  right: Readonly<V3>,
  up: Readonly<V3>,
): Rect {
  const rel = new V3();
  const rect: Rect = { r0: Infinity, r1: -Infinity, u0: Infinity, u1: -Infinity };
  for (const p of points) {
    sub(rel, p, origin);
    const r = dot(rel, right);
    const u = dot(rel, up);
    rect.r0 = Math.min(rect.r0, r);
    rect.r1 = Math.max(rect.r1, r);
    rect.u0 = Math.min(rect.u0, u);
    rect.u1 = Math.max(rect.u1, u);
  }
  return rect;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.r1, b.r1) - Math.max(a.r0, b.r0);
  const h = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0);
  return w > 0 && h > 0 ? w * h : 0;
}

function horizontalForward(forward: Readonly<V3>): V3 {
  const f = new V3(forward.x, 0, forward.z);
  if (Math.hypot(f.x, f.z) < 1e-4) f.set(0, 0, -1);
  return normalize(f, f);
}

export function scrollPlacement(
  head: Readonly<V3>,
  forward: Readonly<V3>,
  opts: PlacementOptions,
  reason: string,
  maxDistance = Infinity,
): StagePlacement {
  const fwd = horizontalForward(forward);
  const frame = createStageFrame();
  // Hang the scroll in front of any wall or tall furniture along the gaze.
  const d = clamp(Math.min(opts.scrollDistance, maxDistance), 0.7, opts.scrollDistance);
  frame.origin.copy(head);
  addScaled(frame.origin, frame.origin, fwd, d);
  frame.origin.y = head.y - 0.1;
  orientStage(frame, new V3(-fwd.x, 0, -fwd.z));
  frame.aspect = opts.aspect * 0.92;
  frame.height = stageHeightForDistance(d, opts.verticalHalfAngleDeg + 2) * opts.sizeScale;
  return { kind: 'scroll', frame, distance: d, planeId: null, reason, score: 0, turnDeg: 0 };
}

/** Chooses the stage. Never throws; always returns a usable placement. */
export function chooseStage(
  planes: readonly PlaneInfo[],
  head: Readonly<V3>,
  forward: Readonly<V3>,
  opts: PlacementOptions = DEFAULT_PLACEMENT,
  obstacles: readonly Obstacle[] = [],
): StagePlacement {
  const fwd = horizontalForward(forward);
  if (planes.length === 0 && obstacles.length === 0) return scrollPlacement(head, forward, opts, 'no-planes');
  const scrollLimit = clearDistanceAhead(head, fwd, planes, obstacles);
  planes = withMergedWalls(planes);
  const cosMax = Math.cos((opts.maxFacingDeg * Math.PI) / 180);
  let best: StagePlacement | null = null;
  // the reason reported is the most promising wall's (the one most squarely
  // in front, at the most comfortable distance), not whichever came last
  let rejected = 'no-wall-in-front';
  let rejectedPromise = -Infinity;
  /** What covered the most promising wall when it was rejected as covered (diagnostics). */
  let blockersSeen = '';
  let promise = 0;
  const reject = (why: string): void => {
    if (promise > rejectedPromise) {
      rejectedPromise = promise;
      rejected = why;
    }
  };
  const toHead = new V3();
  const n = new V3();
  const hit = new V3();
  const right = new V3();
  const up = new V3(0, 1, 0);

  for (const plane of planes) {
    const label = normalizeLabel(plane.label);
    if (!WALL_LABELS.has(label)) continue;
    if (plane.orientation === 'horizontal') continue;
    if (Math.abs(plane.normal.y) > 0.3 || plane.points.length < 3) continue;
    n.set(plane.normal.x, 0, plane.normal.z);
    normalize(n, n);
    const c = plane.points[0];
    sub(toHead, head, c);
    if (dot(n, toHead) < 0) n.set(-n.x, 0, -n.z);
    const D = dot(n, toHead);
    const facing = -dot(fwd, n);
    if (facing <= 0.05) continue; // behind or edge-on: not a candidate at all
    promise = 2 * facing - 0.3 * Math.abs(D - opts.preferredDistance);
    if (D < opts.minDistance) {
      reject('wall-too-close');
      continue;
    }
    if (D > opts.maxDistance) {
      reject('wall-too-far');
      continue;
    }
    if (facing < cosMax) {
      reject('wall-off-angle');
      continue;
    }
    // Gaze ray (horizontal, eye height) to the wall.
    hit.copy(head);
    addScaled(hit, hit, fwd, D / facing);
    cross(right, up, n);
    normalize(right, right);
    // sized for the distance it is seen at (along the gaze), not the perpendicular one
    const L = D / facing;
    if (L > opts.maxDistance) {
      reject('wall-too-far');
      continue;
    }
    let H = stageHeightForDistance(L, opts.verticalHalfAngleDeg) * opts.sizeScale;
    let W = H * opts.aspect;
    const wall = extentsOnFrame(plane.points, hit, right, up);
    const margin = 0.06;
    const availW = wall.r1 - wall.r0 - 2 * margin;
    const availH = wall.u1 - wall.u0 - 2 * margin;
    const fit = Math.min(availW / W, availH / H, 1);
    if (fit < 0.6) {
      reject('wall-too-small');
      continue;
    }
    H *= fit;
    W *= fit;
    // Furniture between the viewer and the wall (desks, monitors, sofas)
    // hides the lower wall: keep the stage above that sight line.
    const yOcc = occlusionHeight(head, fwd, D, W / 2, planes, obstacles);
    let floorU = -Infinity;
    if (Number.isFinite(yOcc)) {
      floorU = yOcc - head.y + 0.04;
      const avail = wall.u1 - margin - floorU;
      if (avail < H) {
        // a desk or monitor in front: use the free band above it, with a smaller stage
        if (avail < H * 0.55) {
          reject('wall-occluded');
          continue;
        }
        W *= avail / H;
        H = avail;
      }
    }
    // Preferred centre: gaze point, slightly below eye level (or just above
    // the furniture line), but never uncomfortably high.
    const prefU = Math.max(-0.1, floorU + H / 2);
    if (prefU > Math.tan((26 * Math.PI) / 180) * L) {
      reject('wall-occluded');
      continue;
    }
    // On this wall: what blocks a spot (windows, screens, mirrors, shelving,
    // openings) and what only costs a little contrast (doors, art, cupboards).
    const wallRects: Rect[] = [];
    const wallLabels: string[] = [];
    const softRects: Rect[] = [];
    for (const other of planes) {
      if (other === plane) continue;
      const ol = normalizeLabel(other.label);
      const blocks = BLOCKING_LABELS.has(ol);
      if (!blocks && !SURFACE_OK_LABELS.has(ol)) continue;
      const rel = new V3();
      sub(rel, other.points[0], hit);
      if (Math.abs(dot(rel, n)) > 0.25) continue; // not on this wall
      if (blocks) {
        wallRects.push(extentsOnFrame(other.points, hit, right, up));
        wallLabels.push(ol);
      } else softRects.push(extentsOnFrame(other.points, hit, right, up));
    }
    // Tall furniture in front of the wall (monitors, shelves) near eye level
    // covers part of it: project its box onto the wall as a hard keep-out area
    // (a stage half hidden behind a real monitor is never acceptable).
    const furnitureRects: Rect[] = [];
    for (const o of obstacles) {
      const label = normalizeLabel(o.label);
      if (label === 'globalmesh' || label === 'wallface' || label === 'floor' || label === 'ceiling') continue;
      if (o.max.y < head.y - 0.15) continue;
      // a cupboard standing against the wall: its front is a fine surface
      if (FRONT_OK_LABELS.has(label)) {
        let far = Infinity;
        for (const x of [o.min.x, o.max.x])
          for (const z of [o.min.z, o.max.z]) {
            const rel = new V3(x - hit.x, 0, z - hit.z);
            far = Math.min(far, Math.abs(dot(rel, n)));
          }
        if (far < 0.12) continue;
      }
      const pts: V3[] = [];
      for (const x of [o.min.x, o.max.x])
        for (const y of [o.min.y, o.max.y])
          for (const z of [o.min.z, o.max.z]) {
            const c = new V3(x, y, z);
            const d = new V3();
            sub(d, c, head);
            const dn = dot(d, n);
            if (dn > -1e-4) continue; // behind the viewer relative to the wall
            const t = dot(n, new V3(hit.x - head.x, hit.y - head.y, hit.z - head.z)) / dn;
            if (t < 1) continue; // corner is beyond the wall
            pts.push(new V3(head.x + d.x * t, head.y + d.y * t, head.z + d.z * t));
          }
      if (pts.length >= 2) furnitureRects.push(extentsOnFrame(pts, hit, right, up));
    }
    // Try the full stage first; on a busy wall (a monitor, a window, a door)
    // a smaller stage in the free part beside or above it.
    let localBest = null as { score: number; r: number; u: number; overlap: number; k: number } | null;
    let anyPos = false;
    let offAxisOnly = false;
    for (const k of [1, 0.8, 0.65, 0.5]) {
      const w = W * k;
      const h = H * k;
      const uMin = Math.max(wall.u0 + margin + h / 2, floorU + h / 2);
      const uMax = wall.u1 - margin - h / 2;
      if (uMin > uMax + 1e-6) continue;
      const rMin = wall.r0 + margin + w / 2;
      const rMax = wall.r1 - margin - w / 2;
      if (rMin > rMax + 1e-6) continue;
      anyPos = true;
      const pu = Math.max(-0.1, floorU + h / 2);
      for (const dr of [0, -0.25, 0.25, -0.5, 0.5, -0.8, 0.8, -1.2, 1.2, -1.6, 1.6, -2.2, 2.2]) {
        for (const du of [0, 0.12, 0.24, -0.1]) {
          const r = clamp(dr, rMin, rMax);
          // never too far off to the side of the gaze (a little beyond the
          // comfortable cone, the viewer is nudged to turn: it costs a little)
          const sideDeg = (Math.atan2(Math.abs(r), D) * 180) / Math.PI;
          if (sideDeg > MAX_SIDE_DEG) {
            offAxisOnly = true;
            continue;
          }
          const turnCost = sideDeg > TURN_NUDGE_DEG ? 0.8 : 0;
          const u = clamp(pu + du, uMin, uMax);
          // never uncomfortably high: the stage's top at most 30 degrees above the eye
          if (u + h / 2 > Math.tan((30 * Math.PI) / 180) * L) continue;
          const rect: Rect = { r0: r - w / 2, r1: r + w / 2, u0: u - h / 2, u1: u + h / 2 };
          let hidden = 0;
          for (const o of furnitureRects) hidden += overlapArea(rect, o);
          if (hidden / (w * h) > 1e-4) continue;
          let overlap = 0;
          for (const o of wallRects) overlap += overlapArea(rect, o);
          overlap /= w * h;
          let soft = 0;
          for (const o of softRects) soft += overlapArea(rect, o);
          soft /= w * h;
          // Off-gaze shift costs comfort; covering windows costs legibility; a
          // smaller stage costs a little presence.
          const shiftAngle = Math.atan2(Math.abs(r), D);
          const score =
            2 * facing -
            0.55 * Math.abs(D - opts.preferredDistance) -
            1.6 * shiftAngle -
            3 * overlap -
            0.25 * soft +
            (label === 'wall' || label === 'wallface' ? 0.3 : 0) -
            0.4 * Math.abs(u - prefU) -
            1.2 * (1 - k) -
            turnCost;
          if (!localBest || score > localBest.score) localBest = { score, r, u, overlap, k };
        }
      }
      if (localBest && localBest.overlap < 0.08) break;
    }
    if (!anyPos || !localBest) {
      reject(offAxisOnly && anyPos ? 'wall-off-axis' : 'wall-occluded');
      continue;
    }
    if (localBest.overlap > 0.35) {
      reject('wall-covered');
      if (promise >= rejectedPromise) blockersSeen = wallLabels.join(',');
      continue;
    }
    H *= localBest.k;
    W *= localBest.k;
    // shrunk too far (a small wall, furniture, a busy wall, all at once)? The
    // paper scroll is the better stage than a sliver.
    if (2 * Math.atan(H / 2 / L) < MIN_STAGE_FRACTION * 2 * (((opts.verticalHalfAngleDeg + 2) * Math.PI) / 180)) {
      reject('wall-too-small');
      continue;
    }
    if (!best || localBest.score > best.score) {
      const frame = createStageFrame();
      frame.origin.copy(hit);
      addScaled(frame.origin, frame.origin, right, localBest.r);
      frame.origin.y += localBest.u;
      // Float 4 mm off the surface to avoid z-fighting with the real wall.
      addScaled(frame.origin, frame.origin, n, 0.004);
      orientStage(frame, n);
      frame.height = H;
      frame.aspect = W / H;
      const sideDeg = (Math.atan2(localBest.r, D) * 180) / Math.PI;
      best = {
        kind: 'wall',
        frame,
        distance: D,
        planeId: plane.id,
        reason: Math.abs(sideDeg) > TURN_NUDGE_DEG ? 'wall-turn' : 'wall',
        score: localBest.score,
        turnDeg: Math.abs(sideDeg) > TURN_NUDGE_DEG ? sideDeg : 0,
      };
    }
  }
  if (best) return best;
  const scroll = scrollPlacement(head, forward, opts, rejected, scrollLimit);
  if (blockersSeen && rejected === 'wall-covered') scroll.reason = `wall-covered:${blockersSeen}`;
  return scroll;
}

/**
 * How many walls are within the acceptance range in front of the viewer
 * (diagnostics: the room sweep expects a wall stage in nearly all such seats).
 */
export function wallsInRange(planes: readonly PlaneInfo[], head: Readonly<V3>, forward: Readonly<V3>, opts: PlacementOptions = DEFAULT_PLACEMENT): number {
  const fwd = horizontalForward(forward);
  const cosMax = Math.cos((opts.maxFacingDeg * Math.PI) / 180);
  const n = new V3();
  const toHead = new V3();
  let count = 0;
  for (const p of planes) {
    if (!WALL_LABELS.has(normalizeLabel(p.label)) || p.orientation === 'horizontal') continue;
    if (Math.abs(p.normal.y) > 0.3 || p.points.length < 3) continue;
    n.set(p.normal.x, 0, p.normal.z);
    normalize(n, n);
    sub(toHead, head, p.points[0]);
    if (dot(n, toHead) < 0) n.set(-n.x, 0, -n.z);
    const D = dot(n, toHead);
    if (D >= opts.minDistance && D <= opts.maxDistance && -dot(fwd, n) >= cosMax) count++;
  }
  return count;
}

/**
 * Adds, for each run of wall segments that lie in one plane and touch (or
 * nearly: gaps under 12 cm), one merged wall spanning them all (over the height
 * they all cover), so a stage may span a wall the scan split into pieces. The
 * originals stay as candidates.
 */
export function withMergedWalls(planes: readonly PlaneInfo[]): PlaneInfo[] {
  const walls: { p: PlaneInfo; n: V3; d: number; t: V3; r0: number; r1: number; y0: number; y1: number }[] = [];
  for (const p of planes) {
    if (p.orientation === 'horizontal' || Math.abs(p.normal.y) > 0.3 || p.points.length < 3) continue;
    if (!WALL_LABELS.has(normalizeLabel(p.label))) continue;
    const n = new V3(p.normal.x, 0, p.normal.z);
    normalize(n, n);
    const t = new V3(-n.z, 0, n.x);
    let r0 = Infinity;
    let r1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const q of p.points) {
      const r = q.x * t.x + q.z * t.z;
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
    walls.push({ p, n, d: p.points[0].x * n.x + p.points[0].z * n.z, t, r0, r1, y0, y1 });
  }
  const out = planes.slice();
  const used = new Set<number>();
  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    const a = walls[i];
    const group = [a];
    let r0 = a.r0;
    let r1 = a.r1;
    let y0 = a.y0;
    let y1 = a.y1;
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = i + 1; j < walls.length; j++) {
        if (used.has(j)) continue;
        const b = walls[j];
        const same = b.n.x * a.n.x + b.n.z * a.n.z;
        if (Math.abs(same) < 0.996) continue; // within ~5 degrees
        const sign = same > 0 ? 1 : -1;
        if (Math.abs(b.d * sign - a.d) > 0.05) continue; // the same plane
        const br0 = sign > 0 ? b.r0 : -b.r1;
        const br1 = sign > 0 ? b.r1 : -b.r0;
        if (br0 > r1 + 0.12 || br1 < r0 - 0.12) continue; // not touching
        // only the height every piece covers counts (never wall that isn't there)
        if (Math.min(y1, b.y1) - Math.max(y0, b.y0) < 0.5) continue;
        used.add(j);
        group.push(b);
        r0 = Math.min(r0, br0);
        r1 = Math.max(r1, br1);
        y0 = Math.max(y0, b.y0);
        y1 = Math.min(y1, b.y1);
        grew = true;
      }
    }
    if (group.length < 2) continue;
    const c = (r: number, y: number): V3 => new V3(a.n.x * a.d + a.t.x * r, y, a.n.z * a.d + a.t.z * r);
    out.push({
      id: group.map((g) => g.p.id).join('+'),
      orientation: 'vertical',
      label: a.p.label,
      normal: new V3(a.p.normal.x, a.p.normal.y, a.p.normal.z),
      points: [c(r0, y0), c(r1, y0), c(r1, y1), c(r0, y1)],
    });
  }
  return out;
}

/**
 * Free distance straight ahead (gaze corridor ~0.9 m wide) before a wall or a
 * piece of furniture tall enough to cut through the scroll.
 */
export function clearDistanceAhead(
  head: Readonly<V3>,
  fwd: Readonly<V3>,
  planes: readonly PlaneInfo[],
  obstacles: readonly Obstacle[],
): number {
  let limit = Infinity;
  const right = new V3(-fwd.z, 0, fwd.x);
  const scrollBottom = head.y - 0.1 - 0.4;
  for (const p of planes) {
    if (p.orientation === 'horizontal' || Math.abs(p.normal.y) > 0.3 || p.points.length < 3) continue;
    const n = new V3(p.normal.x, 0, p.normal.z);
    normalize(n, n);
    const rel = new V3();
    sub(rel, p.points[0], head);
    const denom = dot(n, fwd);
    if (Math.abs(denom) < 1e-3) continue;
    const t = dot(n, rel) / denom;
    if (t <= 0.05) continue;
    // does the gaze ray hit inside the plane's horizontal extent?
    const hit = new V3(head.x + fwd.x * t, head.y, head.z + fwd.z * t);
    let minS = Infinity;
    let maxS = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const tangent = new V3(-n.z, 0, n.x);
    for (const q of p.points) {
      const sq = (q.x - hit.x) * tangent.x + (q.z - hit.z) * tangent.z;
      minS = Math.min(minS, sq);
      maxS = Math.max(maxS, sq);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    if (minS <= 0.1 && maxS >= -0.1 && minY <= head.y && maxY >= scrollBottom) limit = Math.min(limit, t - 0.15);
  }
  const consider = (pts: readonly V3[], top: number) => {
    if (top < scrollBottom + 0.05) return;
    for (const q of pts) {
      const rx = q.x - head.x;
      const rz = q.z - head.z;
      const along = rx * fwd.x + rz * fwd.z;
      const side = rx * right.x + rz * right.z;
      if (along > 0.1 && Math.abs(side) < 0.45) limit = Math.min(limit, along - 0.12);
    }
  };
  for (const p of planes) {
    if (p.orientation === 'vertical' || Math.abs(p.normal.y) < 0.85) continue;
    const label = normalizeLabel(p.label);
    if (label === 'floor' || label === 'ceiling') continue;
    consider(p.points, p.points.reduce((a, q) => a + q.y, 0) / p.points.length);
  }
  for (const o of obstacles) {
    const label = normalizeLabel(o.label);
    if (label === 'globalmesh' || label === 'wallface' || label === 'floor' || label === 'ceiling') continue;
    consider(
      [new V3(o.min.x, 0, o.min.z), new V3(o.max.x, 0, o.min.z), new V3(o.min.x, 0, o.max.z), new V3(o.max.x, 0, o.max.z)],
      o.max.y,
    );
  }
  return limit;
}

function pointInPolygonXZ(x: number, z: number, pts: readonly V3[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const zi = pts[i].z;
    const xj = pts[j].x;
    const zj = pts[j].z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * How many table-height surfaces offer the lantern a spot within reach
 * (diagnostics: the room sweep checks the lantern uses one when there is one).
 */
export function surfacesInReach(planes: readonly PlaneInfo[], head: Readonly<V3>, forward: Readonly<V3>, handedness: 'left' | 'right' = 'right'): number {
  const frame = lanternFrame(head, forward, handedness);
  let n = 0;
  for (const p of planes) if (lanternSpotOn(p, head, frame)) n++;
  return n;
}

/** Distance (XZ) from a point to a polygon's outline. */
function edgeDistanceXZ(x: number, z: number, pts: readonly V3[]): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j].x;
    const az = pts[j].z;
    const ex = pts[i].x - ax;
    const ez = pts[i].z - az;
    const len2 = ex * ex + ez * ez || 1e-12;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / len2, 0, 1);
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return best;
}

/** How far the lantern may sit from the head (horizontally): an easy reach, seated. */
export const LANTERN_REACH = 0.9;
/** ...and from the chest (3D, to the flame): the fingertip tap that opens the menu stays in reach. */
export const LANTERN_ARM = 0.72;
/** Kept this far in from a table's edge (m). */
export const LANTERN_INSET = 0.07;

interface LanternFrame {
  fwd: V3;
  right: V3;
  /** +1 / -1: the non-dominant side. */
  side: number;
  target: V3;
  chest: V3;
  floatY: number;
}

function lanternFrame(head: Readonly<V3>, forward: Readonly<V3>, handedness: 'left' | 'right'): LanternFrame {
  const fwd = horizontalForward(forward);
  const right = new V3();
  cross(right, fwd, new V3(0, 1, 0));
  normalize(right, right);
  const side = handedness === 'right' ? -1 : 1;
  const target = new V3().copy(head);
  addScaled(target, target, fwd, 0.3);
  addScaled(target, target, right, 0.2 * side);
  const chest = new V3(head.x, head.y - 0.25, head.z);
  return { fwd, right, side, target, chest, floatY: head.y - 0.45 };
}

/**
 * The best spot for the lantern on one surface, or null: inside it (kept in
 * from the edge), in front of the viewer, within reach, closest to the ideal
 * place (30 cm ahead, 20 cm to the non-dominant side), out of the hand's lane.
 */
function lanternSpotOn(p: PlaneInfo, head: Readonly<V3>, f: LanternFrame): { cost: number; x: number; y: number; z: number } | null {
  if (p.orientation === 'vertical' || Math.abs(p.normal.y) < 0.85 || p.points.length < 3) return null;
  if (!SURFACE_LABELS.has(normalizeLabel(p.label))) return null;
  const y = p.points.reduce((acc, q) => acc + q.y, 0) / p.points.length;
  // seated table height: from a low side table to a high desk
  if (y < head.y - 0.95 || y > head.y - 0.22) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const q of p.points) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    z0 = Math.min(z0, q.z);
    z1 = Math.max(z1, q.z);
  }
  // only the part of the surface within reach
  x0 = Math.max(x0, head.x - LANTERN_REACH);
  x1 = Math.min(x1, head.x + LANTERN_REACH);
  z0 = Math.max(z0, head.z - LANTERN_REACH);
  z1 = Math.min(z1, head.z + LANTERN_REACH);
  const STEP = 0.04;
  const flameY = y + 0.12;
  let best: { cost: number; x: number; y: number; z: number } | null = null;
  for (let x = x0; x <= x1 + 1e-9; x += STEP) {
    for (let z = z0; z <= z1 + 1e-9; z += STEP) {
      const rx = x - head.x;
      const rz = z - head.z;
      if (rx * rx + rz * rz > LANTERN_REACH * LANTERN_REACH) continue;
      // within a seated arm's reach of the chest (the tap that opens the menu)
      if (Math.hypot(x - f.chest.x, flameY - f.chest.y, z - f.chest.z) > LANTERN_ARM) continue;
      const ahead = rx * f.fwd.x + rz * f.fwd.z;
      // in front of the viewer, not under their chin
      if (ahead < 0.15) continue;
      if (!pointInPolygonXZ(x, z, p.points)) continue;
      if (edgeDistanceXZ(x, z, p.points) < LANTERN_INSET) continue;
      const lateral = rx * f.right.x + rz * f.right.z;
      const cost =
        Math.hypot(x - f.target.x, z - f.target.z) +
        1.5 * Math.max(0, 0.12 - Math.abs(lateral)) +
        (lateral * f.side < 0 ? 0.15 : 0) +
        0.3 * Math.abs(y - f.floatY);
      if (!best || cost < best.cost) best = { cost, x, y, z };
    }
  }
  return best;
}

/**
 * Lantern: on a real table, desk or other surface at seated table height within
 * reach, else gently floating. Every such surface is searched (lanternSpotOn),
 * and the best spot over all of them wins.
 */
export function chooseLantern(
  planes: readonly PlaneInfo[],
  head: Readonly<V3>,
  forward: Readonly<V3>,
  handedness: 'left' | 'right' = 'right',
): LanternPlacement {
  const f = lanternFrame(head, forward, handedness);
  let best: { cost: number; x: number; y: number; z: number; id: string } | null = null;
  for (const p of planes) {
    const spot = lanternSpotOn(p, head, f);
    if (spot && (!best || spot.cost < best.cost)) best = { ...spot, id: p.id };
  }
  if (best) return { position: new V3(best.x, best.y, best.z), onSurface: true, planeId: best.id };
  return { position: new V3(f.target.x, f.floatY, f.target.z), onSurface: false, planeId: null };
}
