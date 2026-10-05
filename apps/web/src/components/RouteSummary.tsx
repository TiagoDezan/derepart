import { estimateFuel, formatDistance, formatDuration, formatEuro, formatLiters, LABELS, type RouteDto } from '@derepart/shared';
import { Link } from 'react-router';
import { Banner, Card, Stat } from './ui';

/** "🚚 Rota otimizada": totals, fuel estimate and comparison with the original order. */
export function RouteSummary({ route }: { route: RouteDto }) {
  const plan = route.plan;
  if (!plan) return null;
  const { fuelConsumptionL100: cons, fuelPriceEurL: price } = route.vehicle;
  const fuel = estimateFuel(plan.totals.distanceM, cons, price);
  const cmp = plan.comparison;
  const savedM = cmp ? cmp.baseline.distanceM - cmp.optimized.distanceM : 0;
  const savedS = cmp ? cmp.baseline.durationS - cmp.optimized.durationS : 0;
  const savedFuel = savedM > 0 ? estimateFuel(savedM, cons, price) : null;
  const stops = route.deliveries.length;
  const serviceMin = Math.round(plan.serviceTimeS / 60);

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">🚚 Rota otimizada</h2>
        <span className="text-muted text-sm">
          {LABELS.modeIcon[route.optimizationMode]} {LABELS.mode[route.optimizationMode]}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Entregas" value={stops} />
        <Stat label="📍 Distância" value={formatDistance(plan.totals.distanceM)} />
        <Stat label="⏱ Tempo estimado" value={formatDuration(plan.totals.durationS)} sub={serviceMin > 0 ? `inclui ${serviceMin} min por entrega` : 'só condução'} />
        {fuel ? (
          <Stat label="⛽ Combustível (estimativa)" value={`≈ ${formatLiters(fuel.liters)}`} sub={fuel.cost != null ? `💶 ≈ ${formatEuro(fuel.cost)}` : undefined} />
        ) : (
          <Link to="/configuracoes" className="surface-2 text-muted rounded-xl p-3 text-xs">
            ⛽ Informe o consumo do veículo para ver a estimativa de combustível →
          </Link>
        )}
      </div>

      {cmp && (
        <div className="rounded-xl border border-app p-3">
          <p className="mb-2 text-sm font-semibold">Comparado à ordem original{plan.stopsOptimized < stops ? ' (paradas restantes)' : ''}</p>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div>
              <p className="text-muted text-xs">Original</p>
              <p className="font-semibold tabular-nums">{formatDistance(cmp.baseline.distanceM)}</p>
              <p className="tabular-nums">{formatDuration(cmp.baseline.durationS)}</p>
            </div>
            <div>
              <p className="text-muted text-xs">Otimizada</p>
              <p className="font-semibold tabular-nums">{formatDistance(cmp.optimized.distanceM)}</p>
              <p className="tabular-nums">{formatDuration(cmp.optimized.durationS)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 py-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              <p className="text-xs">Economia</p>
              <p className="font-bold tabular-nums">{savedM > 0 ? `−${formatDistance(savedM)}` : '—'}</p>
              <p className="font-bold tabular-nums">{savedS > 30 ? `−${formatDuration(savedS)}` : '—'}</p>
            </div>
          </div>
          {savedFuel && <p className="text-muted mt-2 text-center text-xs">Combustível economizado: ≈ {formatLiters(savedFuel.liters)} (estimativa pelo consumo médio)</p>}
          {savedM <= 0 && savedS <= 30 && <p className="text-muted mt-2 text-center text-xs">A ordem em que você adicionou já era praticamente a melhor.</p>}
        </div>
      )}

      {plan.warnings.map((w) => (
        <Banner key={w} tone={w.startsWith('Não dá') || w.includes('já passou') ? 'warn' : 'info'}>
          {w}
        </Banner>
      ))}
      <p className="text-muted text-xs">
        Calculado com {plan.provider.toUpperCase()} {plan.trafficAware ? 'com trânsito' : '(sem trânsito em tempo real)'} ·{' '}
        {plan.method === 'exact-dp' || plan.method === 'exact-search' ? 'ordem ótima garantida' : 'otimização heurística (ILS + 2-opt/Or-opt)'}
        {plan.complexity ? ` · ${plan.complexity.maneuvers} manobras` : ''}
      </p>
    </Card>
  );
}
