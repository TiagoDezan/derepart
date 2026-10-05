import type {
  MeDto,
  PublicConfigDto,
  RouteDto,
  RouteSummaryDto,
  SavedPlaceDto,
  StatsDto,
  VehicleDto,
} from '@derepart/shared';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, isOffline } from './api';
import { cachedMe, cacheMe, fetchRoute, onOutboxChange, outboxCount } from './offline';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && ['OFFLINE', 'UNAUTHENTICATED', 'NOT_FOUND', 'FORBIDDEN'].includes(err.code)) && count < 1,
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
  },
});

export const keys = {
  me: ['me'] as const,
  config: ['config'] as const,
  route: (id: string) => ['route', id] as const,
  routes: ['routes'] as const,
  active: ['routes', 'active'] as const,
  vehicles: ['vehicles'] as const,
  places: ['places'] as const,
  stats: ['stats'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        const me = await api<MeDto>('/me');
        await cacheMe(me);
        return me;
      } catch (err) {
        if (isOffline(err)) {
          const cached = await cachedMe();
          if (cached) return cached;
        }
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export const useConfig = () => useQuery({ queryKey: keys.config, queryFn: () => api<PublicConfigDto>('/config'), staleTime: 300_000 });

export const useRoute = (id: string) => useQuery({ queryKey: keys.route(id), queryFn: () => fetchRoute(id) });

export const useActiveRoute = () =>
  useQuery({ queryKey: keys.active, queryFn: () => api<{ route: RouteSummaryDto | null }>('/routes/active').then((r) => r.route) });

export const useRoutes = () => useQuery({ queryKey: keys.routes, queryFn: () => api<RouteSummaryDto[]>('/routes?limit=100') });

export const useVehicles = () => useQuery({ queryKey: keys.vehicles, queryFn: () => api<VehicleDto[]>('/vehicles') });

export const usePlaces = () => useQuery({ queryKey: keys.places, queryFn: () => api<SavedPlaceDto[]>('/places') });

export const useStats = () => useQuery({ queryKey: keys.stats, queryFn: () => api<StatsDto>('/stats') });

export function setRouteData(route: RouteDto) {
  queryClient.setQueryData(keys.route(route.id), route);
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useOutboxCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => void outboxCount().then(setCount);
    refresh();
    const off = onOutboxChange(refresh);
    return () => {
      off();
    };
  }, []);
  return count;
}
