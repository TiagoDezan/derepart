import type { DeliveryDto, RouteDto } from '@derepart/shared';
import { describe, expect, it } from 'vitest';
import { navigationUrl } from './device';
import { applyEventLocally } from './offline';

const delivery = (id: string, sequence: number, status: DeliveryDto['status'] = 'pending'): DeliveryDto => ({
  id,
  routeId: 'r',
  recipientName: id,
  phone: null,
  street: 'Calle',
  number: '1',
  complement: null,
  postalCode: '29620',
  city: 'Torremolinos',
  province: 'Málaga',
  country: 'ES',
  formattedAddress: 'x',
  lat: 36.6,
  lng: -4.5,
  notes: null,
  priority: 'normal',
  timeWindowStart: null,
  timeWindowEnd: null,
  status,
  failureReason: null,
  failureNote: null,
  sequence,
  legDistanceM: 100,
  legDurationS: 60,
  etaAt: null,
  windowViolated: false,
  deliveredAt: null,
  source: 'manual',
  confidence: null,
  createdAt: new Date().toISOString(),
});

const route = (): RouteDto =>
  ({
    id: 'r',
    status: 'in_progress',
    deliveries: [delivery('a', 1, 'en_route'), delivery('b', 2), delivery('c', 3)],
    deliveriesDone: 0,
    deliveriesFailed: 0,
  }) as unknown as RouteDto;

describe('offline event application', () => {
  it('marks delivered and moves "en route" to the next stop (works offline)', () => {
    const r = applyEventLocally(route(), { id: '1', type: 'delivery_completed', deliveryId: 'a', occurredAt: new Date().toISOString() });
    expect(r.deliveries.map((d) => d.status)).toEqual(['delivered', 'en_route', 'pending']);
    expect(r.deliveriesDone).toBe(1);
  });

  it('records failure reason and note', () => {
    const r = applyEventLocally(route(), { id: '2', type: 'delivery_failed', deliveryId: 'a', occurredAt: new Date().toISOString(), reason: 'absent', note: 'x' });
    expect(r.deliveries[0]).toMatchObject({ status: 'failed', failureReason: 'absent', failureNote: 'x' });
    expect(r.deliveriesFailed).toBe(1);
  });

  it('undo puts the stop back in the queue in sequence order', () => {
    let r = applyEventLocally(route(), { id: '1', type: 'delivery_completed', deliveryId: 'a', occurredAt: new Date().toISOString() });
    r = applyEventLocally(r, { id: '2', type: 'delivery_reset', deliveryId: 'a', occurredAt: new Date().toISOString() });
    expect(r.deliveries.map((d) => d.status)).toEqual(['en_route', 'pending', 'pending']);
  });
});

describe('navigation deep links', () => {
  const p = { lat: 36.6237, lng: -4.4991 };
  it('builds universal links for each app', () => {
    expect(navigationUrl('google', p, 'x')).toBe('https://www.google.com/maps/dir/?api=1&destination=36.623700,-4.499100&travelmode=driving&dir_action=navigate');
    expect(navigationUrl('waze', p, 'x')).toBe('https://waze.com/ul?ll=36.623700,-4.499100&navigate=yes');
    expect(navigationUrl('apple', p, 'x')).toContain('daddr=36.623700,-4.499100');
    expect(navigationUrl('geo', p, 'Calle San Miguel 15')).toBe('geo:36.623700,-4.499100?q=36.623700,-4.499100(Calle%20San%20Miguel%2015)');
    expect(navigationUrl('google', p, 'x', 'bicycle')).toContain('travelmode=bicycling');
  });
});
