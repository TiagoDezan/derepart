import type { LatLng } from '@derepart/shared';
import { AppError } from '../../../lib/errors';
import { fetchJson } from '../../../lib/http';
import type { AddressQuery, GeocodingProvider, RawCandidate } from '../types';

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: {
    formatted_address: string;
    partial_match?: boolean;
    address_components: { long_name: string; short_name: string; types: string[] }[];
    geometry: { location: { lat: number; lng: number }; location_type: string };
  }[];
}

/**
 * Google Geocoding API. Configure GOOGLE_MAPS_API_KEY in apps/api/.env.
 * Note: Google's terms require Google Maps content to be shown on a Google map.
 */
export class GoogleGeocoder implements GeocodingProvider {
  readonly name = 'google';

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async geocode(q: AddressQuery): Promise<RawCandidate[]> {
    const params = new URLSearchParams({ key: this.apiKey, language: 'es', region: (q.country || 'ES').toLowerCase() });
    const components = [`country:${q.country || 'ES'}`];
    if (q.postalCode) components.push(`postal_code:${q.postalCode}`);
    params.set('components', components.join('|'));
    const address = q.street ? [[q.street, q.number].filter(Boolean).join(' '), q.city].filter(Boolean).join(', ') : q.query;
    if (!address) return [];
    params.set('address', address);
    return this.call(params);
  }

  async reverseGeocode(p: LatLng): Promise<RawCandidate | null> {
    const params = new URLSearchParams({ key: this.apiKey, language: 'es', latlng: `${p.lat},${p.lng}` });
    return (await this.call(params))[0] ?? null;
  }

  private async call(params: URLSearchParams): Promise<RawCandidate[]> {
    const res = await fetchJson<GoogleGeocodeResponse>(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      provider: this.name,
      timeoutMs: this.timeoutMs,
    });
    if (res.status === 'ZERO_RESULTS') return [];
    if (res.status === 'OVER_QUERY_LIMIT' || res.status === 'OVER_DAILY_LIMIT') throw new AppError('PROVIDER_QUOTA');
    if (res.status === 'REQUEST_DENIED') throw new AppError('PROVIDER_NOT_CONFIGURED', undefined, { cause: res.error_message });
    if (res.status !== 'OK') throw new AppError('PROVIDER_UNAVAILABLE', undefined, { cause: `${res.status} ${res.error_message ?? ''}` });
    return res.results.map((r) => {
      const get = (type: string) => r.address_components.find((c) => c.types.includes(type))?.long_name ?? null;
      const lt = r.geometry.location_type;
      return {
        formattedAddress: r.formatted_address,
        street: get('route'),
        number: get('street_number'),
        postalCode: get('postal_code'),
        city: get('locality') ?? get('administrative_area_level_4'),
        province: get('administrative_area_level_2'),
        country: r.address_components.find((c) => c.types.includes('country'))?.short_name ?? 'ES',
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        precision: lt === 'ROOFTOP' ? 'rooftop' : lt === 'RANGE_INTERPOLATED' ? 'street' : lt === 'GEOMETRIC_CENTER' ? 'street' : 'approximate',
        provider: this.name,
      } satisfies RawCandidate;
    });
  }
}
