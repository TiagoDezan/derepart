import { describe, expect, it } from 'vitest';
import {
  decodePolyline,
  distanceToPolylineM,
  encodePolyline,
  estimateFuel,
  expandStreetType,
  formatDistance,
  formatDuration,
  haversineM,
  nameSimilarity,
  provinceFromPostalCode,
} from './index';

describe('geo', () => {
  it('round-trips polylines (Google reference example)', () => {
    const pts: [number, number][] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    const enc = encodePolyline(pts);
    expect(enc).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline(enc)).toEqual(pts);
  });

  it('computes haversine distance Torremolinos → Málaga centre within 1%', () => {
    const d = haversineM({ lat: 36.6237, lng: -4.4992 }, { lat: 36.7213, lng: -4.4214 });
    expect(d).toBeGreaterThan(12_800);
    expect(d).toBeLessThan(13_100);
  });

  it('measures distance to a polyline', () => {
    const line: [number, number][] = [
      [36.62, -4.5],
      [36.62, -4.49],
    ];
    // ~111 m north of the segment
    expect(distanceToPolylineM({ lat: 36.621, lng: -4.495 }, line)).toBeCloseTo(111, -1);
  });
});

describe('spain', () => {
  it('maps postal code to province', () => {
    expect(provinceFromPostalCode('29620')).toEqual({ code: '29', name: 'Málaga' });
    expect(provinceFromPostalCode('53000')).toBeNull();
    expect(provinceFromPostalCode('2962')).toBeNull();
  });

  it('expands street type abbreviations', () => {
    expect(expandStreetType('C/ San Miguel')).toBe('Calle San Miguel');
    expect(expandStreetType('Avda. Andalucía')).toBe('Avenida Andalucía');
    expect(expandStreetType('Pº Marítimo')).toBe('Paseo Marítimo');
    expect(expandStreetType('Ctra. de Cádiz')).toBe('Carretera de Cádiz');
  });

  it('scores OCR-like typos and bilingual names', () => {
    expect(nameSimilarity('C/ San Migel', 'CALLE SAN MIGUEL', true)).toBeGreaterThan(0.85);
    expect(nameSimilarity('Calle San Miguel', 'CALLE SANT MIQUEL / SAN MIGUEL', true)).toBe(1);
    expect(nameSimilarity('Calle Larios', 'Calle Mayor', true)).toBeLessThan(0.5);
  });
});

describe('format', () => {
  it('formats distance and duration', () => {
    expect(formatDistance(67_400)).toBe('67,4 km');
    expect(formatDistance(430)).toBe('430 m');
    expect(formatDuration(8280)).toBe('2h18');
    expect(formatDuration(360)).toBe('6 min');
  });

  it('estimates fuel only with consumption configured', () => {
    const f = estimateFuel(67_400, 6.5, 1.55)!;
    expect(f.liters).toBeCloseTo(4.381, 3);
    expect(f.cost).toBeCloseTo(6.79, 2);
    expect(estimateFuel(67_400, null, 1.55)).toBeNull();
  });
});
