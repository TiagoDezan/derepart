import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Spinner } from './components/ui';
import { ApiError } from './lib/api';
import { useMe } from './lib/queries';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';

const NewRoutePage = lazy(() => import('./pages/NewRoutePage'));
const RoutePage = lazy(() => import('./pages/RoutePage'));
const DeliveryFormPage = lazy(() => import('./pages/DeliveryFormPage'));
const ScanPage = lazy(() => import('./pages/ScanPage'));
const RunPage = lazy(() => import('./pages/RunPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  if (me.error instanceof ApiError && me.error.code === 'UNAUTHENTICATED') return <Navigate to="/entrar" replace />;
  if (!me.data) {
    if (me.error) return <Navigate to="/entrar" replace />;
    return <Spinner />;
  }
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
}

const guard = (el: ReactNode) => <RequireAuth>{el}</RequireAuth>;

const router = createBrowserRouter([
  { path: '/entrar', element: <AuthPage mode="login" /> },
  { path: '/criar-conta', element: <AuthPage mode="register" /> },
  { path: '/', element: guard(<HomePage />) },
  { path: '/rotas/nova', element: guard(<NewRoutePage />) },
  { path: '/rotas/:id', element: guard(<RoutePage />) },
  { path: '/rotas/:id/adicionar', element: guard(<DeliveryFormPage />) },
  { path: '/rotas/:id/entregas/:deliveryId', element: guard(<DeliveryFormPage />) },
  { path: '/rotas/:id/escanear', element: guard(<ScanPage />) },
  { path: '/rotas/:id/executar', element: guard(<RunPage />) },
  { path: '/historico', element: guard(<HistoryPage />) },
  { path: '/estatisticas', element: guard(<StatsPage />) },
  { path: '/configuracoes', element: guard(<SettingsPage />) },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
