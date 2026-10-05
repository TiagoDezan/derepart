import type { Priority } from '@derepart/shared';

export interface SolverStop {
  /** Matrix index of this stop (0 is the origin). */
  node: number;
  serviceS: number;
  priority: Priority;
  /** Seconds after departure; null = no constraint. */
  windowStartS: number | null;
  windowEndS: number | null;
}

export interface SolveInput {
  /** Square matrices, seconds / meters. Use `sanitizeMatrix` first (no nulls). */
  durations: number[][];
  distances: number[][];
  stops: SolverStop[];
  /** 'free' = open route ending at the last stop; 'origin' = round trip; number = fixed end node. */
  end: 'free' | 'origin' | number;
  weights: { time: number; distance: number };
  timeLimitMs?: number;
  seed?: number;
  /** How many distinct good solutions to return (for the simplicity tie-break). */
  alternatives?: number;
  /** 'auto' picks by size; 'ils' forces the heuristic (benchmarks/tests). */
  strategy?: 'auto' | 'ils';
}

export interface Evaluation {
  cost: number;
  drivingS: number;
  distanceM: number;
  serviceS: number;
  waitS: number;
  latenessS: number;
  /** Driving + service + waiting: elapsed time from departure to the end. */
  totalS: number;
  /** Arrival time (s after departure) at each stop, in visiting order. */
  arrivals: number[];
  /** Nodes that arrive after their window closes. */
  lateNodes: number[];
  /** Leg to the fixed end (round trip / fixed destination), if any. */
  endLeg: { durationS: number; distanceM: number } | null;
}

export interface Solution {
  order: number[];
  evaluation: Evaluation;
}

export interface SolveResult extends Solution {
  alternatives: Solution[];
  method: 'trivial' | 'exact-dp' | 'exact-search' | 'ils';
  iterations: number;
  elapsedMs: number;
}
