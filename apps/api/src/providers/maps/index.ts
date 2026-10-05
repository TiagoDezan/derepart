import type { AppConfig } from '../../config';
import { CartoCiudadGeocoder } from './geocoders/cartociudad';
import { GoogleGeocoder } from './geocoders/google';
import { NominatimGeocoder } from './geocoders/nominatim';
import { CompositeMapProvider } from './mapProvider';
import { GoogleRouting } from './routing/google';
import { OsrmRouting } from './routing/osrm';
import { ValhallaRouting } from './routing/valhalla';
import type { GeocodingProvider, MapProvider, RoutingProvider } from './types';

/**
 * Builds the MapProvider from env:
 *   MAP_PROVIDER=osrm | valhalla | google
 *   GEOCODING_PROVIDERS=cartociudad,nominatim | google   (order = fallback chain)
 */
export function createMapProvider(config: AppConfig, log?: { warn: (o: unknown, m: string) => void }): MapProvider {
  const t = config.PROVIDER_TIMEOUT_MS;

  const routing: RoutingProvider = (() => {
    switch (config.MAP_PROVIDER) {
      case 'google':
        return new GoogleRouting(config.GOOGLE_MAPS_API_KEY!, config.GOOGLE_TRAFFIC_AWARE ?? true, t);
      case 'valhalla':
        return new ValhallaRouting(config.VALHALLA_URL, t, config.VALHALLA_MAX_MATRIX_LOCATIONS);
      case 'osrm':
      default:
        return new OsrmRouting(config.OSRM_URL, config.OSRM_BIKE_URL, t, config.OSRM_MAX_TABLE_SIZE);
    }
  })();

  const geocoders: GeocodingProvider[] = config.geocoders.map((name) => {
    switch (name) {
      case 'cartociudad':
        return new CartoCiudadGeocoder(config.CARTOCIUDAD_URL, t);
      case 'nominatim':
        return new NominatimGeocoder(config.NOMINATIM_URL, config.NOMINATIM_USER_AGENT, t);
      case 'google':
        if (!config.GOOGLE_MAPS_API_KEY) throw new Error('GEOCODING_PROVIDERS inclui google, mas GOOGLE_MAPS_API_KEY está vazio');
        return new GoogleGeocoder(config.GOOGLE_MAPS_API_KEY, t);
      default:
        throw new Error(`Geocoder desconhecido em GEOCODING_PROVIDERS: ${name}`);
    }
  });

  return new CompositeMapProvider(geocoders, routing, config.OPTIMIZER_TIME_LIMIT_MS, log);
}

export type { MapProvider } from './types';
