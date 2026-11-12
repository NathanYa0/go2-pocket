import type { ExplorationGrid, ExplorationMotion, FootprintPose } from './exploration-grid';

type Node = { x: number; y: number; h: number; cost: number; parent: number };
export type FrontierResult = { state: 'working' | 'none' }
  | { state: 'found'; motion: ExplorationMotion; target: FootprintPose };
const DIRECTIONS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

/** Incremental search through observed free space, including orientation and
 * turn sweeps. Unknown space supplies a destination score, never free floor.
 * Every returned first action is checked again by the live controller.
 */
export class ExplorationFrontier {
  private nodes: Node[] = [{ x: 0, y: 0, h: 0, cost: 0, parent: -1 }];
  private open = [0];
  private best = new Map<string, number>([['0,0,0', 0]]);
  private expanded = 0;
  private emptyCandidate = -1;
  private viewCandidate = -1;
  private done: FrontierResult | null = null;
  constructor(private grid: ExplorationGrid, private start: FootprintPose,
    private corridor: number, private target?: FootprintPose) {}
  matchesStart(p: FootprintPose): boolean {
    const angle = Math.atan2(Math.sin(p.yaw - this.start.yaw), Math.cos(p.yaw - this.start.yaw));
    return Math.hypot(p.x - this.start.x, p.y - this.start.y) <= 0.08 && Math.abs(angle) <= 0.08;
  }

  private pose(node: Node): FootprintPose {
    const c = Math.cos(this.start.yaw), s = Math.sin(this.start.yaw);
    const yaw = this.start.yaw + node.h * Math.PI / 4;
    return { x: this.start.x + (node.x * c - node.y * s) * 0.3,
      y: this.start.y + (node.x * s + node.y * c) * 0.3,
      yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)) };
  }
  private push(node: Node): void {
    const key = `${node.x},${node.y},${node.h}`;
    if ((this.best.get(key) ?? Infinity) <= node.cost) return;
    this.best.set(key, node.cost);
    const index = this.nodes.push(node) - 1;
    let i = this.open.length; this.open.push(index);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.nodes[this.open[parent]].cost <= node.cost) break;
      this.open[i] = this.open[parent]; i = parent;
    }
    this.open[i] = index;
  }
  private pop(): number {
    const first = this.open[0], last = this.open.pop()!;
    if (this.open.length) {
      let i = 0;
      while (i * 2 + 1 < this.open.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.open.length && this.nodes[this.open[child + 1]].cost < this.nodes[this.open[child]].cost) child++;
        if (this.nodes[last].cost <= this.nodes[this.open[child]].cost) break;
        this.open[i] = this.open[child]; i = child;
      }
      this.open[i] = last;
    }
    return first;
  }
  private result(index: number): FrontierResult {
    const path: number[] = [];
    for (let i = index; this.nodes[i].parent >= 0; i = this.nodes[i].parent) path.unshift(i);
    const first = this.nodes[path[0]];
    if (!first) return { state: 'none' };
    let motion: ExplorationMotion;
    if (first.x === 0 && first.y === 0) {
      motion = { ...this.pose(first), kind: 'turn' };
    } else {
      let end = this.pose(first);
      for (const i of path.slice(1)) {
        const node = this.nodes[i];
        if (node.h !== first.h) break;
        end = this.pose(node);
      }
      const length = Math.min(0.5, Math.hypot(end.x - this.start.x, end.y - this.start.y));
      motion = { x: this.start.x + Math.cos(end.yaw) * length,
        y: this.start.y + Math.sin(end.yaw) * length, yaw: end.yaw, kind: 'forward' };
    }
    return { state: 'found', motion, target: this.target ?? this.pose(this.nodes[index]) };
  }
  step(now: number, budgetMs = 8): FrontierResult {
    if (this.done) return this.done;
    const deadline = performance.now() + budgetMs;
    while (this.open.length && this.expanded < 2500) {
      if (performance.now() >= deadline) return { state: 'working' };
      const index = this.pop(), node = this.nodes[index], p = this.pose(node);
      if (node.cost !== this.best.get(`${node.x},${node.y},${node.h}`)) continue;
      this.expanded++;
      if (!this.grid.footprintClear(p, now)) continue;
      if (this.target) {
        if (index && Math.hypot(p.x - this.target.x, p.y - this.target.y) < 0.3) return this.done = this.result(index);
      } else if (Math.hypot(p.x - this.start.x, p.y - this.start.y) >= 0.59 && !this.grid.viewVisited(p)) {
        const unknown = this.grid.unknownScore(p) > 0;
        if (!this.grid.positionVisited(p)) {
          if (unknown) return this.done = this.result(index);
          if (this.emptyCandidate < 0) this.emptyCandidate = index;
        } else if (unknown && this.viewCandidate < 0) this.viewCandidate = index;
      }
      const [dx, dy] = DIRECTIONS[node.h];
      const next: Node = { x: node.x + dx, y: node.y + dy, h: node.h,
        cost: node.cost + Math.hypot(dx, dy) * 0.3, parent: index };
      if (Math.abs(next.x) <= 67 && Math.abs(next.y) <= 67) {
        const to = this.pose(next), length = Math.max(this.corridor, Math.hypot(to.x - p.x, to.y - p.y));
        const ahead = { x: p.x + Math.cos(p.yaw) * length, y: p.y + Math.sin(p.yaw) * length, yaw: p.yaw };
        if (this.grid.checkedSweep(p, ahead, now)) this.push(next);
      }
      for (const delta of [1,-1,2,-2,3,-3,4]) {
        const turn: Node = { ...node, h: (node.h + delta + 8) % 8,
          cost: node.cost + 0.12 + Math.abs(delta) * 0.08, parent: index };
        const to = this.pose(turn);
        const ahead = { x: to.x + Math.cos(to.yaw) * this.corridor,
          y: to.y + Math.sin(to.yaw) * this.corridor, yaw: to.yaw };
        if (this.grid.checkedSweep(p, to, now) && this.grid.checkedSweep(to, ahead, now)) this.push(turn);
      }
    }
    const candidate = this.emptyCandidate >= 0 ? this.emptyCandidate : this.viewCandidate;
    return this.done = candidate >= 0 ? this.result(candidate) : { state: 'none' };
  }
}
