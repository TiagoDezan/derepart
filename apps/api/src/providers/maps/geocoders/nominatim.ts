import type { LatLng } from '@derepart/shared';
import { fetchJson, Throttle } from '../../../lib/http';
import type { AddressQuery, GeocodingProvider, RawCandidate } from '../types';

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  addresstype?: string;
  type?: string;
  address?: {
    road?: string;
    pedestrian?: string;
    house_number?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    suburb?: string;
    state_district?: string;
    province?: string;
    county?: string;
    country_code?: string;
  };
}

/**
 * OpenStreetMap Nominatim. Public instance policy: max 1 request/second, identifying
 * User-Agent, no bulk use. For production volume, self-host or use a commercial instance.
 */
export class NominatimGeocoder implements GeocodingProvider {
  readonly name = 'nominatim';
  private readonly throttle = new Throttle(1100);

  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
    private readonly timeoutMs: number,
  ) {}

  async geocode(q: AddressQuery): Promise<RawCandidate[]> {
    const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': 'es' });
    if (q.country) params.set('countrycodes', q.country.toLowerCase());
    if (q.street) {
      params.set('street', [q.number, q.street].filter(Boolean).join(' '));
      if (q.city) params.set('city', q.city);
      if (q.postalCode) params.set('postalcode', q.postalCode);
    } else if (q.query) {
      params.set('q', q.query);
    } else {
      return [];
    }
    const res = await this.throttle.run(() =>
      fetchJson<NominatimPlace[]>(`${this.baseUrl}/search?${params}`, {
        provider: this.name,
        timeoutMs: this.timeoutMs,
        headers: { 'User-Agent': this.userAgent },
      }),
    );
    return (Array.isArray(res) ? res : []).map((p) => this.toRaw(p));
  }

  async reverseGeocode(p: LatLng): Promise<RawCandidate | null> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      lat: String(p.lat),
      lon: String(p.lng),
      zoom: '18',
      'accept-language': 'es',
    });
    const res = await this.throttle.run(() =>
      fetchJson<NominatimPlace & { error?: string }>(`${this.baseUrl}/reverse?${params}`, {
        provider: this.name,
        timeoutMs: this.timeoutMs,
        headers: { 'User-Agent': this.userAgent },
      }),
    );
    if (!res || res.error || !res.lat) return null;
    return this.toRaw(res);
  }

  private toRaw(p: NominatimPlace): RawCandidate {
    const a = p.address ?? {};
    const street = a.road ?? a.pedestrian ?? null;
    const city = a.city ?? a.town ?? a.village ?? a.municipality ?? null;
    const province = a.province ?? a.county ?? a.state_district ?? null;
    const precision: RawCandidate['precision'] = a.house_number
      ? 'rooftop'
      : street
        ? 'street'
        : city
          ? 'locality'
          : 'approximate';
    const formattedAddress =
      [[street, a.house_number].filter(Boolean).join(', '), [a.postcode, city].filter(Boolean).join(' '), province]
        .filter(Boolean)
        .join(', ') || p.display_name;
    return {
      formattedAddress,
      street,
      number: a.house_number ?? null,
      postalCode: a.postcode ?? null,
      city,
      province,
      country: (a.country_code ?? 'es').toUpperCase(),
      lat: Number(p.lat),
      lng: Number(p.lon),
      precision,
      provider: this.name,
    };
  }
}
