import { LATENESS_WEIGHT, PRIORITY_ARRIVAL_WEIGHT } from '@derepart/shared';
import type { Evaluation, SolveInput, SolverStop } from './types';

/**
 * Builds the objective for one problem instance. Every cost term is ≥ 0, so a partial
 * route's cost is a valid lower bound (used by the exact search to prune).
 */
export class Objective {
  readonly n: number;
  /** Generalised cost of each arc (normalised time + distance). */
  readonly arc: Float64Array[];
  readonly hasTimeTerms: boolean;
  readonly stopByNode = new Map<number, SolverStop>();
  readonly endNode: number | null;
  private readonly avgT: number;
  private readonly timeWeight: number;

  constructor(readonly input: SolveInput) {
    const { durations, distances, weights, stops } = input;
    this.n = durations.length;
    const nodes = [0, ...stops.map((s) => s.node), ...(typeof input.end === 'number' ? [input.end] : [])];
    let sumT = 0;
    let sumD = 0;
    let count = 0;
    for (const i of nodes) {
      for (const j of nodes) {
        if (i === j) continue;
        sumT += durations[i][j];
        sumD += distances[i][j];
        count++;
      }
    }
    this.avgT = count && sumT > 0 ? sumT / count : 1;
    const avgD = count && sumD > 0 ? sumD / count : 1;
    this.timeWeight = weights.time;
    this.arc = durations.map((row, i) =>
      Float64Array.from(row, (t, j) => (weights.time * t) / this.avgT + (weights.distance * distances[i][j]) / avgD),
    );
    for (const s of stops) this.stopByNode.set(s.node, s);
    this.hasTimeTerms = stops.some(
      (s) => s.priority !== 'normal' || s.windowStartS != null || s.windowEndS != null,
    );
    this.endNode = input.end === 'origin' ? 0 : typeof input.end === 'number' ? input.end : null;
  }

  /** Cost of the arcs only (exact when there are no time terms). */
  arcCost(order: readonly number[]): number {
    let c = 0;
    let prev = 0;
    for (const node of order) {
      c += this.arc[prev][node];
      prev = node;
    }
    if (this.endNode != null) c += this.arc[prev][this.endNode];
    return c;
  }

  /** Full cost, including windows, waiting and priorities. */
  cost(order: readonly number[]): number {
    if (!this.hasTimeTerms) return this.arcCost(order);
    const { durations } = this.input;
    let c = 0;
    let t = 0;
    let prev = 0;
    for (const node of order) {
      c += this.arc[prev][node];
      t += durations[prev][node];
      const s = this.stopByNode.get(node)!;
      c += this.timePenalty(s, t);
      if (s.windowStartS != null && t < s.windowStartS) t = s.windowStartS;
      t += s.serviceS;
      prev = node;
    }
    if (this.endNode != null) c += this.arc[prev][this.endNode];
    return c;
  }

  /** Penalty for arriving at `s` at time `t` (before service). Exposed for the exact search. */
  timePenalty(s: SolverStop, t: number): number {
    let c = 0;
    if (s.windowStartS != null && t < s.windowStartS) {
      c += (this.timeWeight * (s.windowStartS - t)) / this.avgT;
      t = s.windowStartS;
    }
    if (s.windowEndS != null && t > s.windowEndS) c += (LATENESS_WEIGHT * (t - s.windowEndS)) / this.avgT;
    c += (PRIORITY_ARRIVAL_WEIGHT[s.priority] * t) / this.avgT;
    return c;
  }

  evaluate(order: readonly number[]): Evaluation {
    const { durations, distances } = this.input;
    let t = 0;
    let drivingS = 0;
    let distanceM = 0;
    let serviceS = 0;
    let waitS = 0;
    let latenessS = 0;
    const arrivals: number[] = [];
    const lateNodes: number[] = [];
    let prev = 0;
    for (const node of order) {
      drivingS += durations[prev][node];
      distanceM += distances[prev][node];
      t += durations[prev][node];
      const s = this.stopByNode.get(node)!;
      if (s.windowStartS != null && t < s.windowStartS) {
        waitS += s.windowStartS - t;
        t = s.windowStartS;
      }
      arrivals.push(t);
      if (s.windowEndS != null && t > s.windowEndS) {
        latenessS += t - s.windowEndS;
        lateNodes.push(node);
      }
      t += s.serviceS;
      serviceS += s.serviceS;
      prev = node;
    }
    let endLeg: Evaluation['endLeg'] = null;
    if (this.endNode != null) {
      endLeg = { durationS: durations[prev][this.endNode], distanceM: distances[prev][this.endNode] };
      drivingS += endLeg.durationS;
      distanceM += endLeg.distanceM;
      t += endLeg.durationS;
    }
    return {
      cost: this.cost(order),
      drivingS,
      distanceM,
      serviceS,
      waitS,
      latenessS,
      totalS: t,
      arrivals,
      lateNodes,
      endLeg,
    };
  }
}

/**
 * Replaces unreachable pairs (null) by a large finite cost so the solver avoids them,
 * and reports stops that cannot be reached at all.
 */
export function sanitizeMatrix(
  durations: (number | null)[][],
  distances: (number | null)[][],
  relevant: number[],
): { durations: number[][]; distances: number[][]; unreachable: number[] } {
  let maxT = 0;
  let maxD = 0;
  for (const row of durations) for (const v of row) if (v != null && v > maxT) maxT = v;
  for (const row of distances) for (const v of row) if (v != null && v > maxD) maxD = v;
  const bigT = Math.max(1, maxT) * 20;
  const bigD = Math.max(1, maxD) * 20;
  const unreachable: number[] = [];
  for (const node of relevant) {
    if (node === 0) continue;
    const inbound = relevant.some((o) => o !== node && durations[o][node] != null);
    const outbound = relevant.some((o) => o !== node && durations[node][o] != null);
    if (!inbound || !outbound) unreachable.push(node);
  }
  return {
    durations: durations.map((row, i) => row.map((v, j) => (i === j ? 0 : (v ?? bigT)))),
    distances: distances.map((row, i) => row.map((v, j) => (i === j ? 0 : (v ?? bigD)))),
    unreachable,
  };
}
