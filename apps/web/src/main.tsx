import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './index.css';
import { setUnauthenticatedHandler } from './lib/api';
import { setSyncedHandler, startBackgroundSync } from './lib/offline';
import { keys, queryClient, setRouteData } from './lib/queries';
import { supabase } from './lib/supabase';

registerSW({ immediate: true });

const PUBLIC_PATHS = ['/entrar', '/criar-conta', '/redefinir-senha'];

setUnauthenticatedHandler(() => {
  queryClient.setQueryData(keys.me, null);
  if (!PUBLIC_PATHS.some((p) => location.pathname.startsWith(p))) location.assign('/entrar');
});
// Supabase Auth: signing out (here or in another tab) clears the cached profile.
supabase?.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') queryClient.setQueryData(keys.me, null);
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
