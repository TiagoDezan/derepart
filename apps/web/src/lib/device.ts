import type { LatLng, NavApp, VehicleType } from '@derepart/shared';
import { ApiError } from './api';

/** One-shot GPS reading (used for "current location" and for recalculation). */
export function getCurrentPosition(timeoutMs = 15000): Promise<LatLng & { accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new ApiError('GPS_UNAVAILABLE'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new ApiError(e.code === e.PERMISSION_DENIED ? 'GPS_DENIED' : e.code === e.TIMEOUT ? 'GPS_TIMEOUT' : 'GPS_UNAVAILABLE')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 },
    );
  });
}

/**
 * Deep links to turn-by-turn navigation apps. Coordinates (confirmed by the user) are more
 * precise than re-sending the address text. The https Google Maps URL is "universal":
 * it opens the app on Android and iOS when installed, otherwise the web.
 */
export function navigationUrl(app: NavApp, dest: LatLng, label: string, vehicle: VehicleType = 'car'): string {
  const ll = `${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}`;
  switch (app) {
    case 'waze':
      return `https://waze.com/ul?ll=${ll}&navigate=yes`;
    case 'apple':
      return `https://maps.apple.com/?daddr=${ll}&dirflg=${vehicle === 'bicycle' ? 'w' : 'd'}`;
    case 'geo':
      return `geo:${ll}?q=${ll}(${encodeURIComponent(label)})`;
    case 'google':
    default: {
      const mode = vehicle === 'bicycle' ? 'bicycling' : vehicle === 'motorbike' ? 'two-wheeler' : 'driving';
      return `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=${mode}&dir_action=navigate`;
    }
  }
}

export function openNavigation(url: string) {
  if (url.startsWith('http')) window.open(url, '_blank', 'noopener');
  else window.location.href = url;
}
