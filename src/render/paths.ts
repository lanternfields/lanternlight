/**
 * Paper-cut silhouettes from SVG-style path strings (absolute M, L, Q, C, Z),
 * so cut-outs are smooth curves rather than faceted polygons
 * (STYLE_GUIDE §1). Coordinates are stage units, y up.
 */
import { Shape, ShapeGeometry, Vector2 } from '@iwsdk/core';

const TOKEN = /([MLQCZ])|(-?\d*\.?\d+(?:e-?\d+)?)/gi;

/** Parses one closed subpath per M ... Z into Shapes. */
export function pathShapes(d: string): Shape[] {
  const shapes: Shape[] = [];
  let shape: Shape | null = null;
  let cmd = '';
  const nums: number[] = [];
  const flush = (): void => {
    if (!cmd) return;
    const n = nums;
    switch (cmd) {
      case 'M':
        shape = new Shape();
        shapes.push(shape);
        shape.moveTo(n[0], n[1]);
        for (let i = 2; i + 1 < n.length; i += 2) shape.lineTo(n[i], n[i + 1]);
        break;
      case 'L':
        for (let i = 0; i + 1 < n.length; i += 2) shape!.lineTo(n[i], n[i + 1]);
        break;
      case 'Q':
        for (let i = 0; i + 3 < n.length; i += 4) shape!.quadraticCurveTo(n[i], n[i + 1], n[i + 2], n[i + 3]);
        break;
      case 'C':
        for (let i = 0; i + 5 < n.length; i += 6) shape!.bezierCurveTo(n[i], n[i + 1], n[i + 2], n[i + 3], n[i + 4], n[i + 5]);
        break;
      case 'Z':
        shape?.closePath();
        break;
    }
    nums.length = 0;
  };
  for (const m of d.matchAll(TOKEN)) {
    if (m[1]) {
      flush();
      cmd = m[1].toUpperCase();
      if (cmd === 'Z') flush();
    } else nums.push(parseFloat(m[2]));
  }
  flush();
  return shapes;
}

/** Geometry for a path, with enough curve segments to stay smooth at stage scale. */
export function pathGeometry(d: string, curveSegments = 10): ShapeGeometry {
  return new ShapeGeometry(pathShapes(d), curveSegments);
}

/** A circle as a Shape (for eye holes and the like). */
export function circleShape(cx: number, cy: number, r: number, segments = 24): Shape {
  const s = new Shape();
  const pts: Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  s.setFromPoints(pts);
  return s;
}
