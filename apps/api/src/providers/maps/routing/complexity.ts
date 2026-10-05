import type { RouteComplexity } from '@derepart/shared';

export interface StepInfo {
  /** True for a real decision point (turn, roundabout, ramp, fork…), false for "continue"/"depart". */
  isManeuver: boolean;
  /** Street name or ref; used to count road changes. */
  road: string | null;
}

/**
 * Objective complexity metrics of a route. They do NOT claim to know which roads the
 * driver is familiar with — they measure how many decisions the route demands.
 */
export function computeComplexity(steps: StepInfo[], distanceM: number): RouteComplexity {
  let maneuvers = 0;
  let roadChanges = 0;
  let lastRoad: string | null = null;
  for (const s of steps) {
    if (s.isManeuver) maneuvers++;
    const road = s.road?.trim() || null;
    if (road) {
      if (lastRoad && road !== lastRoad) roadChanges++;
      lastRoad = road;
    }
  }
  const km = distanceM / 1000;
  return { maneuvers, roadChanges, maneuversPerKm: km > 0 ? Math.round((maneuvers / km) * 100) / 100 : 0 };
}

export function mergeComplexity(parts: RouteComplexity[], distanceM: number): RouteComplexity {
  const maneuvers = parts.reduce((s, p) => s + p.maneuvers, 0);
  const roadChanges = parts.reduce((s, p) => s + p.roadChanges, 0);
  const km = distanceM / 1000;
  return { maneuvers, roadChanges, maneuversPerKm: km > 0 ? Math.round((maneuvers / km) * 100) / 100 : 0 };
}
