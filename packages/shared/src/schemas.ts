import { z } from 'zod';
import {
  CLIENT_EVENT_TYPES,
  DELIVERY_SOURCES,
  FAILURE_REASONS,
  NAV_APPS,
  OPTIMIZATION_MODES,
  PRIORITIES,
  VEHICLE_TYPES,
} from './domain';

// ---- primitives -----------------------------------------------------------

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** "HH:MM", 24h. */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM');

/** Spanish postal code: 5 digits, province prefix 01–52. Other countries: free text up to 10. */
export const SPANISH_POSTAL_CODE = /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/;

// ---- auth -----------------------------------------------------------------

export const registerSchema = z.object({
  name: trimmed(80).min(1, 'Informe seu nome'),
  email: z.email('E-mail inválido').max(160).transform((v) => v.toLowerCase()),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email('E-mail inválido').max(160).transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---- address / geocoding ----------------------------------------------------

export const addressFieldsSchema = z.object({
  street: trimmed(160).min(1, 'Informe a rua'),
  number: optionalText(20),
  complement: optionalText(80),
  postalCode: optionalText(10),
  city: optionalText(80),
  province: optionalText(80),
  country: z.string().trim().length(2).default('ES'),
});
export type AddressFields = z.infer<typeof addressFieldsSchema>;

export const geocodeRequestSchema = addressFieldsSchema.partial({ street: true }).extend({
  /** Free-text query (e.g. start point search). Either `query` or `street` is required. */
  query: optionalText(250),
});
export type GeocodeRequest = z.input<typeof geocodeRequestSchema>;

export const reverseGeocodeSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// ---- deliveries -------------------------------------------------------------

const deliveryBase = addressFieldsSchema.extend({
  recipientName: optionalText(120),
  phone: optionalText(30),
  notes: optionalText(500),
  formattedAddress: trimmed(300).min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  priority: z.enum(PRIORITIES).default('normal'),
  timeWindowStart: timeOfDaySchema.nullish().transform((v) => v ?? null),
  timeWindowEnd: timeOfDaySchema.nullish().transform((v) => v ?? null),
  source: z.enum(DELIVERY_SOURCES).default('manual'),
  confidence: z.number().min(0).max(1).nullish().transform((v) => v ?? null),
});

const windowRefinement = <T extends { timeWindowStart: string | null; timeWindowEnd: string | null }>(
  v: T,
  ctx: z.RefinementCtx,
) => {
  if (v.timeWindowStart && v.timeWindowEnd && v.timeWindowStart >= v.timeWindowEnd) {
    ctx.addIssue({ code: 'custom', path: ['timeWindowEnd'], message: 'O fim da janela deve ser depois do início' });
  }
};

export const createDeliverySchema = deliveryBase.superRefine(windowRefinement);
export type CreateDeliveryInput = z.input<typeof createDeliverySchema>;

export const updateDeliverySchema = deliveryBase.partial().superRefine((v, ctx) =>
  windowRefinement({ timeWindowStart: v.timeWindowStart ?? null, timeWindowEnd: v.timeWindowEnd ?? null }, ctx),
);
export type UpdateDeliveryInput = z.input<typeof updateDeliverySchema>;

// ---- routes -----------------------------------------------------------------

export const routeStartSchema = latLngSchema.extend({ label: trimmed(300).min(1) });

export const createRouteSchema = z.object({
  name: optionalText(80),
  start: routeStartSchema,
  returnToStart: z.boolean().default(false),
  optimizationMode: z.enum(OPTIMIZATION_MODES).default('balanced'),
  vehicleId: z.uuid().nullish().transform((v) => v ?? null),
});
export type CreateRouteInput = z.input<typeof createRouteSchema>;

export const updateRouteSchema = z.object({
  name: optionalText(80),
  start: routeStartSchema.optional(),
  returnToStart: z.boolean().optional(),
  optimizationMode: z.enum(OPTIMIZATION_MODES).optional(),
  vehicleId: z.uuid().nullish(),
});
export type UpdateRouteInput = z.input<typeof updateRouteSchema>;

export const optimizeRouteSchema = z.object({
  /** Current position; when given, remaining stops are planned from here. */
  position: latLngSchema.nullish().transform((v) => v ?? null),
  /** ISO datetime of departure, defaults to now. Used for time windows and ETAs. */
  departureAt: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
  optimizationMode: z.enum(OPTIMIZATION_MODES).optional(),
});
export type OptimizeRouteInput = z.input<typeof optimizeRouteSchema>;

export const clientEventSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(CLIENT_EVENT_TYPES),
    deliveryId: z.uuid().nullish().transform((v) => v ?? null),
    occurredAt: z.iso.datetime({ offset: true }),
    reason: z.enum(FAILURE_REASONS).nullish().transform((v) => v ?? null),
    note: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (v.type !== 'off_route_detected' && !v.deliveryId) {
      ctx.addIssue({ code: 'custom', path: ['deliveryId'], message: 'deliveryId obrigatório' });
    }
    if (v.type === 'delivery_failed' && !v.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Informe o motivo' });
    }
  });
export type ClientEvent = z.input<typeof clientEventSchema>;

export const submitEventsSchema = z.object({ events: z.array(clientEventSchema).min(1).max(200) });

export const completeRouteSchema = z.object({
  /** Mark still-open deliveries as skipped. */
  skipRemaining: z.boolean().default(true),
});

// ---- vehicles / settings / places ---------------------------------------------

export const vehicleSchema = z.object({
  name: trimmed(60).min(1).default('Meu veículo'),
  type: z.enum(VEHICLE_TYPES),
  fuelConsumptionL100: z.number().min(0).max(60).nullish().transform((v) => v ?? null),
  fuelPriceEurL: z.number().min(0).max(10).nullish().transform((v) => v ?? null),
  isDefault: z.boolean().default(true),
});
export type VehicleInput = z.input<typeof vehicleSchema>;

export const settingsSchema = z.object({
  defaultMode: z.enum(OPTIMIZATION_MODES),
  navApp: z.enum(NAV_APPS),
  serviceTimeS: z.number().int().min(0).max(1800),
  allowAiImages: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const savedPlaceSchema = z.object({
  label: trimmed(60).min(1),
  address: trimmed(300).min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type SavedPlaceInput = z.infer<typeof savedPlaceSchema>;

// ---- recognition --------------------------------------------------------------

export const parseLabelSchema = z.object({
  text: z.string().max(5000),
  /** 0–100 as reported by Tesseract. */
  ocrConfidence: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
  allowAi: z.boolean().default(true),
});

export const MAX_IMAGE_BASE64_CHARS = 2_800_000; // ≈ 2 MB binary

export const recognizeImageSchema = z.object({
  imageBase64: z.string().min(100).max(MAX_IMAGE_BASE64_CHARS),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  ocrText: z.string().max(5000).nullish(),
});

export const statsQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
