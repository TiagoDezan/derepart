import { lazy, Suspense, type ComponentProps } from 'react';

const MapView = lazy(() => import('./MapView'));

/** MapLibre is heavy (~800 kB); it is loaded only on screens that show a map. */
export function LazyMap(props: ComponentProps<typeof MapView>) {
  return (
    <Suspense fallback={<div className={`surface-2 animate-pulse ${props.className ?? ''}`} />}>
      <MapView {...props} />
    </Suspense>
  );
}

export type { MapStop } from './MapView';
