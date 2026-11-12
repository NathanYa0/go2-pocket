export interface FloorPlane { x: number; y: number; z: number; a: number; b: number; support: number; candidates: number }
export function floorHeight(plane: FloorPlane, x: number, y: number): number {
  return plane.z + plane.a * (x - plane.x) + plane.b * (y - plane.y);
}

/** Find a spatially supported, near-horizontal surface below the standing base.
 * Body-height telemetry alone is not the ground reference of the SLAM cloud.
 */
export function estimateFloor(points: Float32Array, pose: { x: number; y: number; z: number }): FloorPlane | null {
  const candidates: Array<[number, number, number]> = [];
  const stride = Math.max(1, Math.ceil(points.length / 3 / 4000));
  for (let i = 0; i < points.length; i += 3 * stride) {
    const x = points[i] - pose.x, y = points[i + 1] - pose.y, z = points[i + 2];
    const distance = Math.hypot(x, y);
    if (![x, y, z].every(Number.isFinite) || distance < 0.35 || distance > 2
      || pose.z - z < 0.2 || pose.z - z > 0.55) continue;
    candidates.push([x, y, z]);
  }
  if (candidates.length < 50) return null;
  let seed = 1729, best: FloorPlane | null = null, bestError = Infinity;
  const pick = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return candidates[seed % candidates.length]; };
  for (let iteration = 0; iteration < 160; iteration++) {
    const p = pick(), q = pick(), r = pick();
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
    const ex = r[0] - p[0], ey = r[1] - p[1], ez = r[2] - p[2];
    const determinant = dx * ey - dy * ex;
    if (Math.abs(determinant) < 0.02) continue;
    const a = (dz * ey - dy * ez) / determinant, b = (dx * ez - dz * ex) / determinant;
    const z = p[2] - a * p[0] - b * p[1];
    if (Math.hypot(a, b) > 0.18 || pose.z - z < 0.25 || pose.z - z > 0.55) continue;
    let support = 0, error = 0, xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    const quadrants = [0, 0, 0, 0];
    for (const point of candidates) {
      const residual = Math.abs(point[2] - (a * point[0] + b * point[1] + z));
      if (residual > 0.02) continue;
      support++; error += residual;
      xmin = Math.min(xmin, point[0]); xmax = Math.max(xmax, point[0]);
      ymin = Math.min(ymin, point[1]); ymax = Math.max(ymax, point[1]);
      quadrants[(point[0] >= 0 ? 2 : 0) + (point[1] >= 0 ? 1 : 0)]++;
    }
    if (support < 50 || support / candidates.length < 0.5 || xmax - xmin < 0.8 || ymax - ymin < 0.8 || quadrants.some(n => n < 5)) continue;
    if (!best || support > best.support || (support === best.support && error < bestError)) {
      best = { x: pose.x, y: pose.y, z, a, b, support, candidates: candidates.length }; bestError = error;
    }
  }
  return best;
}
