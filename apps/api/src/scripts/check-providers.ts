/**
 * Live check of the configured providers (uses apps/api/.env):
 *   npm run check:providers --workspace @derepart/api
 * Geocodes a few real Málaga-area addresses, builds the matrix and optimises the route.
 */
import { formatDistance, formatDuration } from '@derepart/shared';
import { loadConfig } from '../config';
import { createMapProvider } from '../providers/maps';

const ADDRESSES = [
  { street: 'C/ San Migel', number: '15', postalCode: '29620', city: 'Torremolino' },
  { street: 'Avda. Andalucía', number: '12', postalCode: '29007', city: 'Málaga' },
  { street: 'Calle Larios', number: '5', postalCode: '29005', city: 'Málaga' },
  { street: 'Avenida Antonio Machado', number: '30', postalCode: '29630', city: 'Benalmádena' },
  { street: 'Calle Real', number: '40', postalCode: '29130', city: 'Alhaurín de la Torre' },
  { street: 'Paseo Marítimo Rey de España', number: '1', postalCode: '29640', city: 'Fuengirola' },
];

async function main() {
  const config = loadConfig();
  const maps = createMapProvider(config, { warn: (o, m) => console.warn('  !', m, o instanceof Error ? o.message : '') });
  console.log(`routing=${maps.routingName} geocoders=${maps.geocoderNames.join(',')}\n`);

  const points = [{ lat: 36.62226, lng: -4.49986 }];
  for (const a of ADDRESSES) {
    const t0 = Date.now();
    const g = await maps.geocode({ ...a, country: 'ES' });
    const b = g.best;
    console.log(`${g.status.padEnd(12)} ${`${a.street} ${a.number}, ${a.city}`.padEnd(42)} → ${b ? `${b.formattedAddress} [${b.provider}, score ${b.score}]` : '—'} (${Date.now() - t0} ms)`);
    for (const m of g.messages) console.log(`             · ${m}`);
    if (b) points.push({ lat: b.lat, lng: b.lng });
  }

  for (const mode of ['fastest', 'economic', 'balanced'] as const) {
    const t0 = Date.now();
    const res = await maps.optimizeRoute({
      points,
      stops: points.slice(1).map((_, i) => ({ node: i + 1, serviceS: 180, priority: 'normal', windowStartS: null, windowEndS: null })),
      end: 'origin',
      opts: { vehicle: 'car', mode },
    });
    console.log(
      `\n${mode.padEnd(9)} order=${res.solution.order.join('→')} ${formatDistance(res.route.distanceM)} ${formatDuration(res.route.durationS)} ` +
        `manobras=${res.route.complexity.maneuvers} método=${res.solution.method} simpler=${res.simplerAlternativeChosen} (${Date.now() - t0} ms)`,
    );
  }
}

main().catch((err) => {
  console.error('FALHA:', err?.message ?? err, err?.cause ?? '');
  process.exit(1);
});
