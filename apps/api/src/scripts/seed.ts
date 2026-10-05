/**
 * Test data: a demo account with a vehicle, a saved start point and a draft route with
 * real public addresses on the Costa del Sol (fictitious recipients), geocoded with the
 * configured provider. Run with the API stopped (PGlite allows a single process):
 *   npm run seed
 * Login: demo@derepart.local / demo12345
 */
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { loadConfig } from '../config';
import { openDatabase } from '../db/client';
import { users } from '../db/schema';
import { FieldCipher, resolveDevKey } from '../lib/crypto';
import { AuthService } from '../auth/auth';
import { RoutesService } from '../modules/routes/routes.service';
import { createMapProvider } from '../providers/maps';
import { NoAiProvider } from '../providers/ai/none';
import { savedPlaces, vehicles } from '../db/schema';
import { eq } from 'drizzle-orm';

const EMAIL = 'demo@derepart.local';
const PASSWORD = 'demo12345';

const LABELS = [
  ['Juan García', 'Calle San Miguel', '15', '2ºB', '29620', 'Torremolinos'],
  ['María López', 'Avenida de Andalucía', '12', null, '29007', 'Málaga'],
  ['Pedro Fernández', 'Calle Carretería', '50', null, '29008', 'Málaga'],
  ['Ana Silva', 'Avenida Antonio Machado', '30', 'Local 2', '29630', 'Benalmádena'],
  ['Lucía Romero', 'Calle Real', '40', null, '29130', 'Alhaurín de la Torre'],
  ['Carlos Ruiz', 'Paseo Marítimo Rey de España', '1', null, '29640', 'Fuengirola'],
  ['Elena Torres', 'Avenida Palma de Mallorca', '20', '1ºA', '29620', 'Torremolinos'],
  ['Javier Moreno', 'Calle Cauce', '10', null, '29620', 'Torremolinos'],
  ['Sofía Navarro', 'Avenida Jesús Santos Rein', '2', null, '29640', 'Fuengirola'],
  ['Diego Castillo', 'Calle Hilera', '8', null, '29007', 'Málaga'],
  ['Marta Gil', 'Avenida Gamonal', '5', null, '29631', 'Benalmádena'],
  ['Pablo Ortega', 'Calle Mauricio Moro Pareto', '2', null, '29006', 'Málaga'],
] as const;

async function main() {
  const config = loadConfig();
  const handle = await openDatabase({ databaseUrl: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
  const cipher = new FieldCipher(config.DATA_ENCRYPTION_KEY ?? resolveDevKey(path.dirname(path.resolve(config.PGLITE_DIR))));
  const maps = createMapProvider(config);
  const deps = { config, db: handle.db, cipher, maps, ai: new NoAiProvider() };

  await handle.db.delete(users).where(sql`lower(${users.email}) = ${EMAIL}`);
  const auth = new AuthService(deps);
  const { token } = await auth.register({ name: 'Entregador Demo', email: EMAIL, password: PASSWORD }, 'seed');
  const ctx = (await auth.resolve(token))!;

  await handle.db
    .update(vehicles)
    .set({ name: 'Furgoneta', type: 'van', fuelConsumptionL100: 6.5, fuelPriceEurL: 1.55 })
    .where(eq(vehicles.userId, ctx.userId));
  const start = { label: 'Plaza Costa del Sol, Torremolinos', lat: 36.62226, lng: -4.49986 };
  await handle.db.insert(savedPlaces).values({ orgId: ctx.orgId, userId: ctx.userId, label: 'Depósito', address: start.label, lat: start.lat, lng: start.lng });

  const routesService = new RoutesService(deps);
  const route = await routesService.createRoute(ctx, { name: 'Rota de teste — Costa del Sol', start, returnToStart: true, optimizationMode: 'balanced' });

  let added = 0;
  for (const [name, street, number, complement, postalCode, city] of LABELS) {
    try {
      const g = await maps.geocode({ street, number, postalCode, city, country: 'ES' });
      if (!g.best) {
        console.warn(`  sem resultado: ${street} ${number}, ${city}`);
        continue;
      }
      const b = g.best;
      await routesService.addDelivery(ctx, route.id, {
        recipientName: name,
        street: b.street ?? street,
        number: b.number ?? number,
        complement,
        postalCode: b.postalCode ?? postalCode,
        city: b.city ?? city,
        province: b.province,
        formattedAddress: b.formattedAddress,
        lat: b.lat,
        lng: b.lng,
        priority: added === 4 ? 'urgent' : 'normal',
        timeWindowStart: added === 7 ? '14:00' : null,
        timeWindowEnd: added === 7 ? '16:00' : null,
      });
      added++;
      console.log(`  ✓ ${b.formattedAddress} (${g.status})`);
    } catch (err) {
      console.warn(`  falhou: ${street} ${number}: ${(err as Error).message}`);
    }
  }
  console.log(`\nConta: ${EMAIL} / ${PASSWORD}\nRota "${route.name}" com ${added} entregas (rascunho, pronta para calcular).`);
  await handle.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
