// Formatting helpers (pt-BR, metric, euro). Estimates are prefixed with "≈" by callers.

const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (Math.abs(meters) < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${nf1.format(meters / 1000)} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const totalMin = Math.round(Math.abs(seconds) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const sign = seconds < 0 ? '−' : '';
  if (h === 0) return `${sign}${m} min`;
  return `${sign}${h}h${String(m).padStart(2, '0')}`;
}

export function formatLiters(liters: number | null | undefined): string {
  if (liters == null || !Number.isFinite(liters)) return '—';
  return `${nf1.format(liters)} L`;
}

export function formatEuro(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${nf2.format(value)} €`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export interface FuelEstimate {
  liters: number;
  cost: number | null;
}

/**
 * Fuel estimate with the user's average consumption. It is proportional to distance by
 * construction — it does not model speed, slope or traffic, so it is always shown as "≈".
 */
export function estimateFuel(
  distanceM: number | null | undefined,
  consumptionL100: number | null | undefined,
  priceEurL: number | null | undefined,
): FuelEstimate | null {
  if (distanceM == null || consumptionL100 == null || consumptionL100 <= 0) return null;
  const liters = (distanceM / 1000) * (consumptionL100 / 100);
  return { liters, cost: priceEurL != null && priceEurL > 0 ? liters * priceEurL : null };
}
