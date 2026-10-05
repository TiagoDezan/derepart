import { provinceFromPostalCode, titleCase, type LatLng } from '@derepart/shared';
import { fetchJson } from '../../../lib/http';
import type { AddressQuery, GeocodingProvider, RawCandidate } from '../types';

/**
 * CartoCiudad (Instituto Geográfico Nacional). Official Spanish address data down to
 * building entrance ("portal"), free to use with attribution (CC-BY 4.0).
 * Endpoints: /candidates?q=… (list), /reverseGeocode?lon=&lat=.
 */
interface CcCandidate {
  id: string;
  type: string; // portal | callejero | Municipio | poblacion | toponimo | codpost | ...
  address: string;
  tip_via: string | null;
  portalNumber: number | null;
  extension: string | null;
  postalCode: string | null;
  muni: string | null;
  poblacion: string | null;
  province: string | null;
  provinceCode: string | null;
  lat: number;
  lng: number;
  noNumber?: boolean;
}

export class CartoCiudadGeocoder implements GeocodingProvider {
  readonly name = 'cartociudad';

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async geocode(q: AddressQuery): Promise<RawCandidate[]> {
    if (q.country && q.country.toUpperCase() !== 'ES') return [];
    // Postal code inside the free text confuses CartoCiudad (tested: "calle larios 5 29005"
    // jumps to Valencia), so we send "street number, city" and filter by province instead.
    const text = q.street
      ? [[q.street, q.number].filter(Boolean).join(' '), q.city].filter(Boolean).join(', ')
      : (q.query ?? '');
    if (!text.trim()) return [];
    const province = q.province ?? provinceFromPostalCode(q.postalCode)?.name ?? null;

    let results = await this.candidates(text, province);
    if (results.length === 0 && province) results = await this.candidates(text, null);
    return results.map((c) => this.toRaw(c)).filter((c): c is RawCandidate => c !== null);
  }

  async reverseGeocode(p: LatLng): Promise<RawCandidate | null> {
    const url = `${this.baseUrl}/reverseGeocode?lon=${p.lng}&lat=${p.lat}`;
    const res = await fetchJson<CcCandidate | null>(url, { provider: this.name, timeoutMs: this.timeoutMs });
    if (!res || typeof res !== 'object' || res.lat == null) return null;
    return this.toRaw(res);
  }

  private async candidates(text: string, province: string | null): Promise<CcCandidate[]> {
    const params = new URLSearchParams({ q: text, limit: '8' });
    if (province) params.set('provincia_filter', province);
    const res = await fetchJson<CcCandidate[]>(`${this.baseUrl}/candidates?${params}`, {
      provider: this.name,
      timeoutMs: this.timeoutMs,
    });
    return Array.isArray(res) ? res : [];
  }

  private toRaw(c: CcCandidate): RawCandidate | null {
    if (c.lat == null || c.lng == null) return null;
    const isPortal = c.type === 'portal';
    // `address` looks like "CALLE SAN MIGUEL 15, Torremolinos"; for reverse it is just "SAN MIGUEL".
    let street = c.address.split(',')[0].trim();
    if (isPortal && c.portalNumber != null) street = street.replace(new RegExp(`\\s+${c.portalNumber}(\\s+\\w+)?$`), '');
    if (c.tip_via && !street.toUpperCase().startsWith(c.tip_via.toUpperCase())) street = `${c.tip_via} ${street}`;
    street = titleCase(street);
    const number = isPortal && c.portalNumber != null ? String(c.portalNumber) : null;
    const city = c.muni ?? c.poblacion ?? null;
    const precision: RawCandidate['precision'] = isPortal
      ? 'rooftop'
      : c.type === 'callejero'
        ? 'street'
        : c.type === 'Municipio' || c.type === 'poblacion' || c.type === 'codpost'
          ? 'locality'
          : 'approximate';
    const formattedAddress = [
      [street, number].filter(Boolean).join(', '),
      [c.postalCode, city].filter(Boolean).join(' '),
      c.province && c.province !== city ? c.province : null,
    ]
      .filter(Boolean)
      .join(', ');
    return {
      formattedAddress,
      street,
      number,
      postalCode: c.postalCode ?? null,
      city,
      province: c.province ?? null,
      provinceCode: c.provinceCode ?? null,
      country: 'ES',
      lat: c.lat,
      lng: c.lng,
      precision,
      provider: this.name,
    };
  }
}
