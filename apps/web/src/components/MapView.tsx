import { decodePolyline, type DeliveryStatus, type LatLng } from '@derepart/shared';
import clsx from 'clsx';
import { LngLatBounds, MapLibreMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
// MapLibre derives its worker URL from import.meta.url, which breaks once bundled:
// let Vite bundle the worker and hand MapLibre the final URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
import { useEffect, useRef } from 'react';

const STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

export interface MapStop {
  id: string;
  lat: number;
  lng: number;
  label: string;
  status?: DeliveryStatus;
  highlight?: boolean;
}

const STATUS_COLOR: Record<DeliveryStatus, string> = {
  pending: '#0f766e',
  en_route: '#2563eb',
  delivered: '#16a34a',
  failed: '#dc2626',
  skipped: '#6b7280',
};

export default function MapView({
  start,
  stops = [],
  geometry,
  position,
  onPick,
  pickMarker,
  className,
  fitKey,
}: {
  start?: LatLng | null;
  stops?: MapStop[];
  /** encoded polyline (precision 5) */
  geometry?: string | null;
  position?: LatLng | null;
  /** When set, tapping the map picks a location. */
  onPick?: (p: LatLng) => void;
  pickMarker?: LatLng | null;
  className?: string;
  /** Change it to re-fit the camera to the content. */
  fitKey?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const loaded = useRef(false);
  const onReady = useRef<(() => void)[]>([]);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  // create once
  useEffect(() => {
    if (!container.current) return;
    const m = new MapLibreMap({
      container: container.current,
      style: STYLE_URL,
      center: [-4.4214, 36.7213],
      zoom: 10,
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.on('click', (e) => pickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    m.on('load', () => {
      loaded.current = true;
      m.addSource('route', { type: 'geojson', data: emptyLine() });
      m.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8 },
      });
      m.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0f766e', 'line-width': 5 },
      });
      onReady.current.splice(0).forEach((fn) => fn());
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      loaded.current = false;
    };
  }, []);

  // route line
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const src = m.getSource('route') as GeoJSONSource | undefined;
      if (!src) return;
      void src.setData(
        geometry
          ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: decodePolyline(geometry).map(([lat, lng]) => [lng, lat]) } }
          : emptyLine(),
      );
    };
    if (loaded.current) apply();
    else onReady.current.push(apply);
  }, [geometry]);

  // markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    if (start) markers.current.push(new Marker({ element: startEl() }).setLngLat([start.lng, start.lat]).addTo(m));
    for (const s of stops) {
      const el = document.createElement('div');
      el.className = 'stop-marker';
      el.textContent = s.label;
      el.style.background = STATUS_COLOR[s.status ?? 'pending'];
      if (s.highlight) {
        el.style.transform = 'scale(1.3)';
        el.style.zIndex = '2';
      }
      markers.current.push(new Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m));
    }
    if (position) {
      const el = document.createElement('div');
      el.className = 'size-4 rounded-full border-2 border-white bg-blue-600 shadow';
      markers.current.push(new Marker({ element: el }).setLngLat([position.lng, position.lat]).addTo(m));
    }
    if (pickMarker) markers.current.push(new Marker({ color: '#dc2626' }).setLngLat([pickMarker.lng, pickMarker.lat]).addTo(m));
  }, [start, stops, position, pickMarker]);

  // camera
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pts: [number, number][] = [
      ...(start ? [[start.lng, start.lat] as [number, number]] : []),
      ...stops.map((s) => [s.lng, s.lat] as [number, number]),
      ...(pickMarker ? [[pickMarker.lng, pickMarker.lat] as [number, number]] : []),
    ];
    if (pts.length === 0) return;
    if (pts.length === 1) {
      m.jumpTo({ center: pts[0], zoom: 15 });
      return;
    }
    const b = pts.reduce((acc, p) => acc.extend(p), new LngLatBounds(pts[0], pts[0]));
    m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={container} className={clsx('relative w-full overflow-hidden', onPick && 'cursor-crosshair', className)} />;
}

type LineFeature = { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: number[][] } };

function emptyLine(): LineFeature {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
}

function startEl() {
  const el = document.createElement('div');
  el.className = 'stop-marker';
  el.style.background = '#111827';
  el.textContent = '🚩';
  return el;
}
