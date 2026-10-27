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
  /** World-space unit normal (plane's +Y). */
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
}

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
    let lateralHit = false;
    for (const p of pts) {
      const rx = p.x - head.x;
      const rz = p.z - head.z;
      const along = rx * dir.x + rz * dir.z;
      const side = rx * right.x + rz * right.z;
      if (along > 0.05 && along < wallDistance + 0.05 && Math.abs(side) < halfWidth * (along / wallDistance) + 0.15) {
        lateralHit = true;
      }
      far = Math.max(far, Math.min(along, wallDistance));
    }
    if (!lateralHit || far < 0.1) return;
    const y = head.y + ((top - head.y) * wallDistance) / far;
    if (y > yOcc) yOcc = y;
  };
  for (const p of planes) {
    if (p.orientation === 'vertical' || p.normal.y < 0.85) continue;
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

export const DEFAULT_PLACEMENT: PlacementOptions = {
  minDistance: 0.65,
  maxDistance: 3.3,
  preferredDistance: 1.9,
  maxFacingDeg: 48,
  verticalHalfAngleDeg: 14,
  aspect: 1.45,
  scrollDistance: 1.25,
  sizeScale: 1,
};

/** Normalises runtime labels ('WALL_FACE', 'wall', 'Wall Art') to 'wallface' etc. */
export function normalizeLabel(label: string | undefined | null): string {
  return (label ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

const WALL_LABELS = new Set(['wall', 'wallface', '', 'other', 'unknown', 'global']);
/** Things a stage should avoid covering. */
const OBSTACLE_LABELS = new Set([
  'window',
  'windowframe',
  'door',
  'doorframe',
  'screen',
  'wallart',
  'invisiblewallface',
]);
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
  return { kind: 'scroll', frame, distance: d, planeId: null, reason, score: 0 };
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
  const cosMax = Math.cos((opts.maxFacingDeg * Math.PI) / 180);
  let best: StagePlacement | null = null;
  let rejected = 'no-wall-in-front';
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
    if (D < opts.minDistance) {
      rejected = 'wall-too-close';
      continue;
    }
    if (D > opts.maxDistance) {
      rejected = 'wall-too-far';
      continue;
    }
    const facing = -dot(fwd, n);
    if (facing < cosMax) continue;
    // Gaze ray (horizontal, eye height) to the wall.
    hit.copy(head);
    addScaled(hit, hit, fwd, D / facing);
    cross(right, up, n);
    normalize(right, right);
    let H = stageHeightForDistance(D, opts.verticalHalfAngleDeg) * opts.sizeScale;
    let W = H * opts.aspect;
    const wall = extentsOnFrame(plane.points, hit, right, up);
    const margin = 0.06;
    const availW = wall.r1 - wall.r0 - 2 * margin;
    const availH = wall.u1 - wall.u0 - 2 * margin;
    const fit = Math.min(availW / W, availH / H, 1);
    if (fit < 0.72) {
      rejected = 'wall-too-small';
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
        if (avail < H * 0.72) {
          rejected = 'wall-occluded';
          continue;
        }
        W *= avail / H;
        H = avail;
      }
    }
    // Preferred centre: gaze point, slightly below eye level (or just above
    // the furniture line), but never uncomfortably high.
    const prefU = Math.max(-0.1, floorU + H / 2);
    if (prefU > Math.tan((20 * Math.PI) / 180) * D) {
      rejected = 'wall-occluded';
      continue;
    }
    const uMin = Math.max(wall.u0 + margin + H / 2, floorU + H / 2);
    const uMax = wall.u1 - margin - H / 2;
    if (uMin > uMax + 1e-6) {
      rejected = 'wall-occluded';
      continue;
    }
    const rMin = wall.r0 + margin + W / 2;
    const rMax = wall.r1 - margin - W / 2;
    // Obstacles on this wall (windows, doors, TVs, art).
    const wallRects: Rect[] = [];
    for (const other of planes) {
      if (other === plane) continue;
      if (!OBSTACLE_LABELS.has(normalizeLabel(other.label))) continue;
      const rel = new V3();
      sub(rel, other.points[0], hit);
      if (Math.abs(dot(rel, n)) > 0.25) continue; // not on this wall
      wallRects.push(extentsOnFrame(other.points, hit, right, up));
    }
    // Tall furniture in front of the wall (monitors, shelves) near eye level
    // covers part of it: project its box onto the wall as a keep-out area.
    for (const o of obstacles) {
      const label = normalizeLabel(o.label);
      if (label === 'globalmesh' || label === 'wallface' || label === 'floor' || label === 'ceiling') continue;
      if (o.max.y < head.y - 0.15) continue;
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
      if (pts.length >= 2) wallRects.push(extentsOnFrame(pts, hit, right, up));
    }
    let localBest: { score: number; r: number; u: number; overlap: number } | null = null;
    for (const dr of [0, -0.25, 0.25, -0.5, 0.5, -0.8, 0.8]) {
      const r = clamp(dr, rMin, rMax);
      const u = clamp(prefU, uMin, uMax);
      const rect: Rect = { r0: r - W / 2, r1: r + W / 2, u0: u - H / 2, u1: u + H / 2 };
      let overlap = 0;
      for (const o of wallRects) overlap += overlapArea(rect, o);
      overlap /= W * H;
      // Off-gaze shift costs comfort; covering windows costs legibility.
      const shiftAngle = Math.atan2(Math.abs(r), D);
      const score =
        2 * facing -
        0.55 * Math.abs(D - opts.preferredDistance) -
        1.6 * shiftAngle -
        3 * overlap +
        (label === 'wall' || label === 'wallface' ? 0.3 : 0) -
        0.4 * Math.abs(u - prefU);
      if (!localBest || score > localBest.score) {
        localBest = { score, r, u, overlap };
      }
    }
    if (!localBest) continue;
    if (localBest.overlap > 0.35) {
      rejected = 'wall-covered';
      continue;
    }
    const lateralAngleDeg = (Math.atan2(Math.abs(localBest.r), D) * 180) / Math.PI;
    if (lateralAngleDeg > 24) {
      rejected = 'wall-off-axis';
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
      best = {
        kind: 'wall',
        frame,
        distance: D,
        planeId: plane.id,
        reason: 'wall',
        score: localBest.score,
      };
    }
  }
  return best ?? scrollPlacement(head, forward, opts, rejected, scrollLimit);
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
    if (p.orientation === 'vertical' || p.normal.y < 0.85) continue;
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

/** Lantern: on a table in front of the viewer if there is one, else floating. */
export function chooseLantern(
  planes: readonly PlaneInfo[],
  head: Readonly<V3>,
  forward: Readonly<V3>,
  handedness: 'left' | 'right' = 'right',
): LanternPlacement {
  const fwd = horizontalForward(forward);
  const right = new V3();
  cross(right, fwd, new V3(0, 1, 0));
  normalize(right, right);
  // Beside the performing space (non-dominant side, below the hands) so the
  // hands never brush it by accident while making shadows.
  const side = handedness === 'right' ? -0.2 : 0.2;
  const target = new V3().copy(head);
  addScaled(target, target, fwd, 0.3);
  addScaled(target, target, right, side);
  const floatY = head.y - 0.45;
  let bestY = Infinity;
  let bestId: string | null = null;
  for (const p of planes) {
    if (p.orientation === 'vertical' || p.normal.y < 0.85 || p.points.length < 3) continue;
    if (!SURFACE_LABELS.has(normalizeLabel(p.label))) continue;
    const y = p.points.reduce((acc, q) => acc + q.y, 0) / p.points.length;
    if (y < head.y - 0.85 || y > head.y - 0.22) continue;
    // Allow the lantern to slide up to 18 cm toward the table to sit on it.
    let found = pointInPolygonXZ(target.x, target.z, p.points);
    if (!found) {
      const t2 = new V3().copy(target);
      addScaled(t2, t2, fwd, 0.18);
      if (pointInPolygonXZ(t2.x, t2.z, p.points)) {
        target.copy(t2);
        found = true;
      }
    }
    if (!found) continue;
    if (Math.abs(y - floatY) < Math.abs(bestY - floatY)) {
      bestY = y;
      bestId = p.id;
    }
  }
  if (bestId !== null) {
    return { position: new V3(target.x, bestY, target.z), onSurface: true, planeId: bestId };
  }
  return { position: new V3(target.x, floatY, target.z), onSurface: false, planeId: null };
}
