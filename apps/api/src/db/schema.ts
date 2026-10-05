import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { RoutePlanDto } from '@derepart/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * Tenancy: every business row carries `org_id`. Today each user gets a personal
 * organisation; a delivery company later becomes one org with many drivers.
 */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    /** null for accounts managed by Supabase Auth (AUTH_PROVIDER=supabase). */
    passwordHash: text('password_hash'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('memberships_org_user_uq').on(t.orgId, t.userId), index('memberships_user_idx').on(t.userId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  defaultMode: text('default_mode').notNull().default('balanced'),
  navApp: text('nav_app').notNull().default('google'),
  serviceTimeS: integer('service_time_s').notNull().default(180),
  allowAiImages: boolean('allow_ai_images').notNull().default(false),
  retentionDays: integer('retention_days').notNull().default(90),
  updatedAt: updatedAt(),
});

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Driver who owns/uses the vehicle (nullable for future fleet vehicles). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    fuelConsumptionL100: doublePrecision('fuel_consumption_l100'),
    fuelPriceEurL: doublePrecision('fuel_price_eur_l'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('vehicles_org_idx').on(t.orgId), index('vehicles_user_idx').on(t.userId)],
);

export const savedPlaces = pgTable(
  'saved_places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    address: text('address').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('saved_places_user_idx').on(t.userId)],
);

export const routes = pgTable(
  'routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Driver of the route. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'),
    optimizationMode: text('optimization_mode').notNull().default('balanced'),
    returnToStart: boolean('return_to_start').notNull().default(false),
    startLabel: text('start_label'),
    startLat: doublePrecision('start_lat'),
    startLng: doublePrecision('start_lng'),
    /** Vehicle snapshot at planning time, so history keeps its estimates. */
    vehicleType: text('vehicle_type').notNull().default('car'),
    fuelConsumptionL100: doublePrecision('fuel_consumption_l100'),
    fuelPriceEurL: doublePrecision('fuel_price_eur_l'),
    plannedDistanceM: doublePrecision('planned_distance_m'),
    plannedDurationS: doublePrecision('planned_duration_s'),
    baselineDistanceM: doublePrecision('baseline_distance_m'),
    baselineDurationS: doublePrecision('baseline_duration_s'),
    /**
     * Estimated savings of the optimized order vs. the insertion order, fixed when the route is
     * planned (before it starts). Mid-route recalculations do not change it, so it is not inflated.
     */
    savedDistanceM: doublePrecision('saved_distance_m'),
    savedDurationS: doublePrecision('saved_duration_s'),
    actualDistanceM: doublePrecision('actual_distance_m'),
    actualDurationS: doublePrecision('actual_duration_s'),
    plan: jsonb('plan').$type<RoutePlanDto>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    piiPurgedAt: timestamp('pii_purged_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('routes_org_idx').on(t.orgId),
    index('routes_user_status_idx').on(t.userId, t.status),
    index('routes_user_created_idx').on(t.userId, t.createdAt),
  ],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // Encrypted personal fields (AES-256-GCM, see lib/crypto.ts)
    recipientNameEnc: text('recipient_name_enc'),
    phoneEnc: text('phone_enc'),
    complementEnc: text('complement_enc'),
    notesEnc: text('notes_enc'),
    failureNoteEnc: text('failure_note_enc'),
    street: text('street'),
    number: text('number'),
    postalCode: text('postal_code'),
    city: text('city'),
    province: text('province'),
    country: text('country').notNull().default('ES'),
    formattedAddress: text('formatted_address').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    priority: text('priority').notNull().default('normal'),
    timeWindowStart: text('time_window_start'),
    timeWindowEnd: text('time_window_end'),
    status: text('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    sequence: integer('sequence'),
    legDistanceM: doublePrecision('leg_distance_m'),
    legDurationS: doublePrecision('leg_duration_s'),
    etaAt: timestamp('eta_at', { withTimezone: true }),
    windowViolated: boolean('window_violated').notNull().default(false),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    source: text('source').notNull().default('manual'),
    confidence: doublePrecision('confidence'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('deliveries_route_idx').on(t.routeId, t.sequence), index('deliveries_org_idx').on(t.orgId)],
);

export const routeEvents = pgTable(
  'route_events',
  {
    /** Client-generated UUID for offline events → idempotent sync. */
    id: uuid('id').primaryKey(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    deliveryId: uuid('delivery_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('route_events_route_idx').on(t.routeId, t.occurredAt)],
);

export type RouteRow = typeof routes.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;
