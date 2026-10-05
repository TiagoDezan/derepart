/** Route time zone. Fixed for Spain (peninsula) for now; per-org setting in the future. */
export const ROUTE_TIME_ZONE = 'Europe/Madrid';

export function secondsOfDayInZone(date: Date, timeZone = ROUTE_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 3600 + get('minute') * 60 + get('second');
}

export function hhmmToSeconds(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
}

/** "14:00" on the departure day → seconds after departure (may be negative if already past). */
export function windowOffsetS(hhmm: string | null, departure: Date, timeZone = ROUTE_TIME_ZONE): number | null {
  if (!hhmm) return null;
  return hhmmToSeconds(hhmm) - secondsOfDayInZone(departure, timeZone);
}

export function formatClock(date: Date, timeZone = ROUTE_TIME_ZONE): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(date);
}
