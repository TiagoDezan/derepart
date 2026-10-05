import type { OptimizationMode, Priority } from './domain';

/**
 * Weights of the route objective. Costs are normalised by the mean leg time / distance
 * of the matrix, so the weights are comparable regardless of route size.
 */
export interface ObjectiveWeights {
  time: number;
  distance: number;
  /**
   * Balanced mode: among the near-optimal sequences, pick the one with the fewest
   * manoeuvres if it costs at most `simplicityTolerancePct` more (or `simplicityToleranceS`).
   */
  preferSimple: boolean;
  simplicityTolerancePct: number;
  simplicityToleranceS: number;
}

export const OPTIMIZATION_PROFILES: Record<OptimizationMode, ObjectiveWeights> = {
  fastest: { time: 1, distance: 0.05, preferSimple: false, simplicityTolerancePct: 0, simplicityToleranceS: 0 },
  economic: { time: 0.15, distance: 1, preferSimple: false, simplicityTolerancePct: 0, simplicityToleranceS: 0 },
  balanced: { time: 0.6, distance: 0.4, preferSimple: true, simplicityTolerancePct: 0.03, simplicityToleranceS: 180 },
};

/**
 * Penalty per normalised unit of arrival time. With n stops, arriving at position k costs
 * ≈ k · weight, so an urgent stop at position 20 "pays" ≈ 10 average legs of detour to move up.
 */
export const PRIORITY_ARRIVAL_WEIGHT: Record<Priority, number> = {
  normal: 0,
  high: 0.15,
  urgent: 0.5,
};

/** Penalty per normalised unit of lateness (arriving after a time window closes). */
export const LATENESS_WEIGHT = 25;

/** Default time spent at each stop (parking, handing over), seconds. */
export const DEFAULT_SERVICE_TIME_S = 180;

export const MAX_STOPS_PER_ROUTE = 150;
