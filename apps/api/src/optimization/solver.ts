import { Objective } from './evaluator';
import type { SolveInput, SolveResult, Solution } from './types';

/** Held–Karp is exact and fast up to this many stops (2^n · n² operations). */
const DP_MAX_STOPS = 13;
/** Exhaustive branch-and-bound when windows/priorities make the cost time-dependent. */
const SEARCH_MAX_STOPS = 9;
const EPS = 1e-9;

/** Deterministic PRNG so that the same input always yields the same plan. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Solves the single-vehicle routing problem (open/closed TSP with optional time windows and
 * priorities) on an asymmetric matrix. Strategy depends on size:
 *  - ≤ 13 stops, no time terms → Held–Karp dynamic programming (optimal)
 *  - ≤ 9 stops with time terms → branch and bound (optimal)
 *  - otherwise → multi-start construction + local search (2-opt, Or-opt) + Iterated Local Search.
 */
export function solve(input: SolveInput): SolveResult {
  const started = performance.now();
  const obj = new Objective(input);
  const nodes = input.stops.map((s) => s.node);
  const wantAlternatives = input.alternatives ?? 1;
  const timeLimit = input.timeLimitMs ?? 1500;
  const rnd = mulberry32(input.seed ?? 0x5eed);

  const done = (order: number[], method: SolveResult['method'], iterations: number, pool: Pool): SolveResult => {
    pool.add(order, obj.cost(order));
    const alternatives = pool
      .list()
      .slice(0, wantAlternatives)
      .map((s) => ({ order: s.order, evaluation: obj.evaluate(s.order) }));
    return {
      order,
      evaluation: obj.evaluate(order),
      alternatives,
      method,
      iterations,
      elapsedMs: Math.round(performance.now() - started),
    };
  };

  const pool = new Pool(Math.max(1, wantAlternatives));

  if (nodes.length <= 1) return done(nodes, 'trivial', 0, pool);

  let exact: number[] | null = null;
  let method: SolveResult['method'] = 'ils';
  const auto = input.strategy !== 'ils';
  if (auto && !obj.hasTimeTerms && nodes.length <= DP_MAX_STOPS) {
    exact = heldKarp(obj, nodes);
    method = 'exact-dp';
  } else if (auto && nodes.length <= SEARCH_MAX_STOPS) {
    exact = branchAndBound(obj, nodes);
    method = 'exact-search';
  }

  if (exact) {
    if (wantAlternatives > 1) {
      // Fill the pool with other good local optima for the simplicity tie-break.
      ils(obj, nodes, rnd, Math.min(250, timeLimit), pool);
    }
    return done(exact, method, 0, pool);
  }

  const { best, iterations } = ils(obj, nodes, rnd, timeLimit, pool);
  return done(best, 'ils', iterations, pool);
}

// ---------------------------------------------------------------------------
// Exact methods

function heldKarp(obj: Objective, nodes: number[]): number[] {
  const n = nodes.length;
  const full = (1 << n) - 1;
  const size = 1 << n;
  const dp = new Float64Array(size * n).fill(Infinity);
  const parent = new Int8Array(size * n).fill(-1);
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = obj.arc[0][nodes[j]];
  for (let mask = 1; mask < size; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask * n + j];
      if (cur === Infinity) continue;
      const rowJ = obj.arc[nodes[j]];
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const nm = mask | (1 << k);
        const v = cur + rowJ[nodes[k]];
        if (v < dp[nm * n + k]) {
          dp[nm * n + k] = v;
          parent[nm * n + k] = j;
        }
      }
    }
  }
  let bestJ = 0;
  let bestV = Infinity;
  for (let j = 0; j < n; j++) {
    const v = dp[full * n + j] + (obj.endNode != null ? obj.arc[nodes[j]][obj.endNode] : 0);
    if (v < bestV) {
      bestV = v;
      bestJ = j;
    }
  }
  const order: number[] = [];
  let mask = full;
  let j = bestJ;
  while (j !== -1) {
    order.push(nodes[j]);
    const p = parent[mask * n + j];
    mask &= ~(1 << j);
    j = p;
  }
  return order.reverse();
}

function branchAndBound(obj: Objective, nodes: number[]): number[] {
  const { durations } = obj.input;
  // Start from a good heuristic bound so pruning is effective.
  let bestOrder = localSearch(obj, nearestNeighbour(obj, nodes));
  let bestCost = obj.cost(bestOrder);
  const used = new Array(nodes.length).fill(false);
  const path: number[] = [];

  const dfs = (prev: number, t: number, cost: number) => {
    if (cost >= bestCost - EPS) return;
    if (path.length === nodes.length) {
      const total = cost + (obj.endNode != null ? obj.arc[prev][obj.endNode] : 0);
      if (total < bestCost - EPS) {
        bestCost = total;
        bestOrder = [...path];
      }
      return;
    }
    for (let i = 0; i < nodes.length; i++) {
      if (used[i]) continue;
      const node = nodes[i];
      const s = obj.stopByNode.get(node)!;
      const arrive = t + durations[prev][node];
      const c = cost + obj.arc[prev][node] + obj.timePenalty(s, arrive);
      const startService = s.windowStartS != null && arrive < s.windowStartS ? s.windowStartS : arrive;
      used[i] = true;
      path.push(node);
      dfs(node, startService + s.serviceS, c);
      path.pop();
      used[i] = false;
    }
  };
  dfs(0, 0, 0);
  return bestOrder;
}

// ---------------------------------------------------------------------------
// Construction heuristics

function nearestNeighbour(obj: Objective, nodes: number[]): number[] {
  const left = new Set(nodes);
  const order: number[] = [];
  let prev = 0;
  while (left.size) {
    let best = -1;
    let bestC = Infinity;
    for (const k of left) {
      const c = obj.arc[prev][k];
      if (c < bestC) {
        bestC = c;
        best = k;
      }
    }
    order.push(best);
    left.delete(best);
    prev = best;
  }
  return order;
}

/** Cheapest insertion; with `rnd`, nodes are inserted in random order (diversified starts). */
function insertion(obj: Objective, nodes: number[], rnd?: () => number): number[] {
  const pending = [...nodes];
  if (rnd) shuffle(pending, rnd);
  else {
    // farthest-from-origin first gives a good skeleton
    pending.sort((a, b) => obj.arc[0][b] - obj.arc[0][a]);
  }
  const order: number[] = [];
  for (const node of pending) {
    let bestPos = 0;
    let bestDelta = Infinity;
    for (let pos = 0; pos <= order.length; pos++) {
      const a = pos === 0 ? 0 : order[pos - 1];
      const b = pos === order.length ? obj.endNode : order[pos];
      const delta = obj.arc[a][node] + (b != null ? obj.arc[node][b] - obj.arc[a][b] : 0);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestPos = pos;
      }
    }
    order.splice(bestPos, 0, node);
  }
  return order;
}

function shuffle<T>(a: T[], rnd: () => number) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// ---------------------------------------------------------------------------
// Local search

/**
 * Local search on a path [origin, …order…, end]. Moves: 2-opt (segment reversal) and Or-opt
 * (move a segment of 1–3 stops elsewhere, optionally reversed). Arc-only objectives use O(1)
 * delta evaluation with prefix sums (correct for asymmetric matrices); time-dependent
 * objectives are re-evaluated in full.
 */
export function localSearch(obj: Objective, start: number[], deadline = Infinity): number[] {
  return obj.hasTimeTerms ? localSearchFull(obj, start, deadline) : localSearchDelta(obj, start);
}

function localSearchDelta(obj: Objective, start: number[]): number[] {
  const m = start.length;
  // p[0] = origin, p[1..m] = stops, p[m+1] = end sentinel (or -1 for a free end)
  const p = [0, ...start, obj.endNode ?? -1];
  const C = obj.arc;
  const c = (a: number, b: number) => (b === -1 ? 0 : C[a][b]);
  const F = new Float64Array(m + 2);
  const B = new Float64Array(m + 2);
  const prefix = () => {
    F[0] = 0;
    B[0] = 0;
    for (let k = 0; k < m + 1; k++) {
      F[k + 1] = F[k] + c(p[k], p[k + 1]);
      B[k + 1] = B[k] + (p[k + 1] === -1 ? 0 : C[p[k + 1]][p[k]]);
    }
  };
  // F[k] = Σ_{x<k} c(p[x], p[x+1]); internal forward cost of p[i..j] = F[j] − F[i]
  let improved = true;
  while (improved) {
    improved = false;
    prefix();
    // 2-opt
    for (let i = 1; i < m && !improved; i++) {
      for (let j = i + 1; j <= m; j++) {
        const before = c(p[i - 1], p[i]) + c(p[j], p[j + 1]) + (F[j] - F[i]);
        const after = c(p[i - 1], p[j]) + c(p[i], p[j + 1]) + (B[j] - B[i]);
        if (after < before - EPS) {
          reverse(p, i, j);
          improved = true;
          break;
        }
      }
    }
    if (improved) continue;
    // Or-opt
    outer: for (let len = 1; len <= Math.min(3, m - 1); len++) {
      for (let i = 1; i + len - 1 <= m; i++) {
        const j = i + len - 1; // segment p[i..j]
        const removeGain = c(p[i - 1], p[i]) + c(p[j], p[j + 1]) - c(p[i - 1], p[j + 1]);
        const fwd = F[j] - F[i];
        const bwd = B[j] - B[i];
        for (let k = 0; k <= m; k++) {
          if (k >= i - 1 && k <= j) continue; // insert between p[k] and p[k+1]
          const a = p[k];
          const b = p[k + 1];
          const base = c(a, b);
          const addFwd = c(a, p[i]) + c(p[j], b) - base;
          if (addFwd < removeGain - EPS) {
            moveSegment(p, i, j, k, false);
            improved = true;
            break outer;
          }
          if (len > 1) {
            const addRev = c(a, p[j]) + c(p[i], b) - base + (bwd - fwd);
            if (addRev < removeGain - EPS) {
              moveSegment(p, i, j, k, true);
              improved = true;
              break outer;
            }
          }
        }
      }
    }
  }
  return p.slice(1, m + 1);
}

function localSearchFull(obj: Objective, start: number[], deadline: number): number[] {
  let cur = [...start];
  let curCost = obj.cost(cur);
  const m = cur.length;
  let improved = true;
  while (improved && performance.now() < deadline) {
    improved = false;
    // 2-opt
    for (let i = 0; i < m - 1 && !improved; i++) {
      for (let j = i + 1; j < m; j++) {
        const cand = [...cur.slice(0, i), ...cur.slice(i, j + 1).reverse(), ...cur.slice(j + 1)];
        const cc = obj.cost(cand);
        if (cc < curCost - EPS) {
          cur = cand;
          curCost = cc;
          improved = true;
          break;
        }
      }
    }
    if (improved) continue;
    // Or-opt (segments 1–3, both orientations) — also covers moving urgent stops forward
    outer: for (let len = 1; len <= Math.min(3, m - 1); len++) {
      for (let i = 0; i + len <= m; i++) {
        const seg = cur.slice(i, i + len);
        const rest = [...cur.slice(0, i), ...cur.slice(i + len)];
        for (let k = 0; k <= rest.length; k++) {
          if (k === i) continue;
          for (const s of len > 1 ? [seg, [...seg].reverse()] : [seg]) {
            const cand = [...rest.slice(0, k), ...s, ...rest.slice(k)];
            const cc = obj.cost(cand);
            if (cc < curCost - EPS) {
              cur = cand;
              curCost = cc;
              improved = true;
              break outer;
            }
          }
        }
      }
    }
  }
  return cur;
}

function reverse(a: number[], i: number, j: number) {
  while (i < j) {
    [a[i], a[j]] = [a[j], a[i]];
    i++;
    j--;
  }
}

/** Moves p[i..j] to between p[k] and p[k+1] (k outside [i-1, j]). */
function moveSegment(p: number[], i: number, j: number, k: number, reversed: boolean) {
  const seg = p.slice(i, j + 1);
  if (reversed) seg.reverse();
  const len = seg.length;
  if (k > j) {
    p.splice(k + 1, 0, ...seg);
    p.splice(i, len);
  } else {
    p.splice(i, len);
    p.splice(k + 1, 0, ...seg);
  }
}

// ---------------------------------------------------------------------------
// Iterated Local Search

function doubleBridge(order: number[], rnd: () => number): number[] {
  const n = order.length;
  if (n < 8) {
    const a = [...order];
    for (let s = 0; s < 2; s++) {
      const i = Math.floor(rnd() * n);
      const j = Math.floor(rnd() * n);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const cuts = new Set<number>();
  while (cuts.size < 3) cuts.add(1 + Math.floor(rnd() * (n - 1)));
  const [p1, p2, p3] = [...cuts].sort((x, y) => x - y);
  return [...order.slice(0, p1), ...order.slice(p2, p3), ...order.slice(p1, p2), ...order.slice(p3)];
}

function ils(obj: Objective, nodes: number[], rnd: () => number, timeLimitMs: number, pool: Pool) {
  const deadline = performance.now() + timeLimitMs;
  const starts = [nearestNeighbour(obj, nodes), insertion(obj, nodes), insertion(obj, nodes, rnd)];
  let best: number[] = [];
  let bestCost = Infinity;
  for (const s of starts) {
    const o = localSearch(obj, s, deadline);
    const c = obj.cost(o);
    pool.add(o, c);
    if (c < bestCost) {
      best = o;
      bestCost = c;
    }
  }
  let cur = best;
  let curCost = bestCost;
  let iterations = 0;
  let sinceImprovement = 0;
  const maxIdle = Math.max(200, nodes.length * 20);
  while (performance.now() < deadline && sinceImprovement < maxIdle) {
    iterations++;
    const cand = localSearch(obj, doubleBridge(cur, rnd), deadline);
    const cc = obj.cost(cand);
    pool.add(cand, cc);
    if (cc < bestCost - EPS) {
      best = cand;
      bestCost = cc;
      sinceImprovement = 0;
    } else {
      sinceImprovement++;
    }
    // Accept equal-or-slightly-worse moves to escape plateaus; restart from best periodically.
    if (cc < curCost * 1.002) {
      cur = cand;
      curCost = cc;
    } else if (iterations % 50 === 0) {
      cur = best;
      curCost = bestCost;
    }
  }
  return { best, iterations };
}

/** Keeps the K best distinct solutions. */
class Pool {
  private readonly items = new Map<string, { order: number[]; cost: number }>();

  constructor(private readonly k: number) {}

  add(order: number[], cost: number) {
    const key = order.join(',');
    if (this.items.has(key)) return;
    this.items.set(key, { order: [...order], cost });
    if (this.items.size > this.k * 3) {
      const sorted = this.list();
      this.items.clear();
      for (const s of sorted.slice(0, this.k)) this.items.set(s.order.join(','), s);
    }
  }

  list(): { order: number[]; cost: number }[] {
    return [...this.items.values()].sort((a, b) => a.cost - b.cost);
  }
}

export type { Solution };
