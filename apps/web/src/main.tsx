import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './index.css';
import { setUnauthenticatedHandler } from './lib/api';
import { setSyncedHandler, startBackgroundSync } from './lib/offline';
import { keys, queryClient, setRouteData } from './lib/queries';

registerSW({ immediate: true });

setUnauthenticatedHandler(() => {
  queryClient.setQueryData(keys.me, null);
  if (!location.pathname.startsWith('/entrar') && !location.pathname.startsWith('/criar-conta')) {
    location.assign('/entrar');
  }
});
setSyncedHandler((route) => {
  setRouteData(route);
  void queryClient.invalidateQueries({ queryKey: keys.routes });
});
startBackgroundSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
