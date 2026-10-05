import { describe, expect, it } from 'vitest';
import { Objective, sanitizeMatrix } from './evaluator';
import { solve } from './solver';
import type { SolveInput, SolverStop } from './types';

/** Random asymmetric "road-like" matrix: euclidean × detour factor, one-way noise. */
function randomInstance(n: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pts = Array.from({ length: n + 1 }, () => [rnd() * 20_000, rnd() * 20_000]);
  const distances = pts.map((a) =>
    pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * (1.25 + rnd() * 0.3)),
  );
  const durations = distances.map((row) => row.map((d) => d / (8 + rnd() * 6)));
  return { durations, distances };
}

const stopsFor = (n: number, extra: Partial<SolverStop> = {}): SolverStop[] =>
  Array.from({ length: n }, (_, i) => ({
    node: i + 1,
    serviceS: 120,
    priority: 'normal' as const,
    windowStartS: null,
    windowEndS: null,
    ...extra,
  }));

function bruteForce(input: SolveInput): number {
  const obj = new Objective(input);
  const nodes = input.stops.map((s) => s.node);
  let best = Infinity;
  const permute = (arr: number[], k: number) => {
    if (k === arr.length) {
      best = Math.min(best, obj.cost(arr));
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(nodes, 0);
  return best;
}

const weights = { time: 0.6, distance: 0.4 };

describe('solver — exactness', () => {
  for (const end of ['free', 'origin'] as const) {
    it(`Held–Karp matches brute force (${end} end, asymmetric)`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const m = randomInstance(8, seed);
        const input: SolveInput = { ...m, stops: stopsFor(8), end, weights };
        const res = solve(input);
        expect(res.method).toBe('exact-dp');
        expect(res.evaluation.cost).toBeCloseTo(bruteForce(input), 9);
      }
    });
  }

  it('branch and bound matches brute force with windows and priorities', () => {
    for (let seed = 10; seed <= 14; seed++) {
      const m = randomInstance(7, seed);
      const stops = stopsFor(7);
      stops[2].priority = 'urgent';
      stops[4] = { ...stops[4], windowStartS: 1800, windowEndS: 3000 };
      const input: SolveInput = { ...m, stops, end: 'free', weights };
      const res = solve(input);
      expect(res.method).toBe('exact-search');
      expect(res.evaluation.cost).toBeCloseTo(bruteForce(input), 9);
    }
  });

  it('ILS finds the optimum (or within 1%) on instances small enough to verify', () => {
    for (let seed = 20; seed <= 25; seed++) {
      const m = randomInstance(9, seed);
      const input: SolveInput = { ...m, stops: stopsFor(9), end: 'origin', weights, strategy: 'ils', timeLimitMs: 300 };
      const res = solve(input);
      expect(res.method).toBe('ils');
      expect(res.evaluation.cost).toBeLessThanOrEqual(bruteForce(input) * 1.01);
    }
  });
});

describe('solver — behaviour', () => {
  it('beats insertion order clearly on a 40-stop instance and stays within the time budget', () => {
    const m = randomInstance(40, 99);
    const input: SolveInput = { ...m, stops: stopsFor(40), end: 'free', weights, timeLimitMs: 800 };
    const res = solve(input);
    const obj = new Objective(input);
    const baseline = obj.evaluate(input.stops.map((s) => s.node));
    expect(res.method).toBe('ils');
    expect(res.evaluation.distanceM).toBeLessThan(baseline.distanceM * 0.5);
    expect(res.elapsedMs).toBeLessThan(1500);
    expect(new Set(res.order).size).toBe(40);
  });

  it('is deterministic for the same input', () => {
    const m = randomInstance(25, 7);
    const input: SolveInput = { ...m, stops: stopsFor(25), end: 'free', weights, timeLimitMs: 200 };
    expect(solve(input).order).toEqual(solve(input).order);
  });

  it('moves an urgent stop towards the beginning', () => {
    const m = randomInstance(12, 3);
    const base: SolveInput = { ...m, stops: stopsFor(12), end: 'free', weights };
    const plain = solve(base).order;
    const lastNode = plain[plain.length - 1];
    const stops = stopsFor(12).map((s) => (s.node === lastNode ? { ...s, priority: 'urgent' as const } : s));
    const urgent = solve({ ...base, stops }).order;
    expect(urgent.indexOf(lastNode)).toBeLessThan(plain.indexOf(lastNode));
  });

  it('respects a feasible time window', () => {
    const m = randomInstance(10, 5);
    const stops = stopsFor(10);
    // stop 1 must be served late in the route, stop 2 early
    const earlyEnd = m.durations[0][2] + 300; // feasible only if visited (almost) first
    stops[0] = { ...stops[0], windowStartS: 4000, windowEndS: 9000 };
    stops[1] = { ...stops[1], windowStartS: 0, windowEndS: earlyEnd };
    const res = solve({ ...m, stops, end: 'free', weights, strategy: 'ils', timeLimitMs: 300 });
    expect(res.evaluation.lateNodes).toEqual([]);
    const pos1 = res.order.indexOf(1);
    expect(res.evaluation.arrivals[pos1]).toBeGreaterThanOrEqual(4000);
    expect(res.evaluation.arrivals[res.order.indexOf(2)]).toBeLessThanOrEqual(earlyEnd);
  });

  it('fastest vs economic: picks the faster or the shorter sequence', () => {
    // Two clusters: going via the motorway (node 1 → 2) is long but fast.
    const durations = [
      [0, 600, 900, 1500],
      [600, 0, 300, 1300],
      [900, 300, 0, 600],
      [1500, 1300, 600, 0],
    ];
    const distances = [
      [0, 15000, 9000, 9000],
      [15000, 0, 12000, 9000],
      [9000, 12000, 0, 4000],
      [9000, 9000, 4000, 0],
    ];
    const stops = stopsFor(3);
    const fast = solve({ durations, distances, stops, end: 'free', weights: { time: 1, distance: 0.05 } });
    const eco = solve({ durations, distances, stops, end: 'free', weights: { time: 0.15, distance: 1 } });
    expect(fast.evaluation.drivingS).toBeLessThanOrEqual(eco.evaluation.drivingS);
    expect(eco.evaluation.distanceM).toBeLessThanOrEqual(fast.evaluation.distanceM);
    expect(fast.order).not.toEqual(eco.order);
  });

  it('returns distinct alternatives when asked', () => {
    const m = randomInstance(15, 42);
    const res = solve({ ...m, stops: stopsFor(15), end: 'free', weights, alternatives: 3, timeLimitMs: 300 });
    expect(res.alternatives.length).toBeGreaterThan(1);
    const keys = new Set(res.alternatives.map((a) => a.order.join(',')));
    expect(keys.size).toBe(res.alternatives.length);
    expect(res.alternatives[0].evaluation.cost).toBeCloseTo(res.evaluation.cost, 9);
  });

  it('handles fixed end node (return to depot from a mid-route position)', () => {
    const m = randomInstance(6, 8); // node 6 used as fixed end
    const res = solve({ ...m, stops: stopsFor(5), end: 6, weights });
    expect(res.order).toHaveLength(5);
    expect(res.order).not.toContain(6);
    expect(res.evaluation.endLeg).not.toBeNull();
  });
});

describe('sanitizeMatrix', () => {
  it('flags unreachable stops and replaces nulls', () => {
    const d = [
      [0, 10, null],
      [10, 0, null],
      [null, null, 0],
    ];
    const r = sanitizeMatrix(d, d, [0, 1, 2]);
    expect(r.unreachable).toEqual([2]);
    expect(r.durations[0][2]).toBeGreaterThan(10);
  });
});
