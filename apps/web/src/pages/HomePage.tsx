import { LABELS } from '@derepart/shared';
import { BarChart3, History, Play, Plus, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, Chip, Page } from '../components/ui';
import { useActiveRoute, useMe } from '../lib/queries';

function BigLink({ to, icon, title, sub, primary }: { to: string; icon: ReactNode; title: string; sub?: string; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={
        primary
          ? 'bg-brand-700 active:bg-brand-800 flex items-center gap-4 rounded-2xl p-5 text-white shadow-sm'
          : 'surface active:surface-2 flex items-center gap-4 rounded-2xl border border-app p-5 shadow-sm'
      }
    >
      <span className={primary ? 'grid size-12 place-items-center rounded-xl bg-white/15' : 'bg-brand-50 text-brand-700 grid size-12 place-items-center rounded-xl dark:bg-brand-800/40 dark:text-brand-100'}>
        {icon}
      </span>
      <span>
        <span className="block text-lg font-bold">{title}</span>
        {sub && <span className={primary ? 'block text-sm text-white/80' : 'text-muted block text-sm'}>{sub}</span>}
      </span>
    </Link>
  );
}

export function HomePage() {
  const me = useMe();
  const active = useActiveRoute();
  const route = active.data;
  const target = route ? (route.status === 'in_progress' ? `/rotas/${route.id}/executar` : `/rotas/${route.id}`) : null;

  return (
    <Page title={`Olá, ${me.data?.user.name.split(' ')[0] ?? ''}`}>
      <BigLink to="/rotas/nova" primary icon={<Plus className="size-7" />} title="Nova rota" sub="Defina o ponto de partida e adicione as encomendas" />
      {route && target && (
        <Link to={target} className="block">
          <Card className="active:surface-2 flex items-center gap-4">
            <span className="grid size-12 place-items-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200">
              <Play className="size-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold">Continuar rota</span>
              <span className="text-muted block truncate text-sm">{route.name}</span>
              <span className="mt-1 flex items-center gap-2 text-sm">
                <Chip tone={route.status === 'in_progress' ? 'blue' : 'gray'}>{LABELS.routeStatus[route.status]}</Chip>
                {route.deliveriesDone + route.deliveriesFailed}/{route.deliveriesTotal} entregas
              </span>
            </span>
          </Card>
        </Link>
      )}
      <BigLink to="/historico" icon={<History className="size-7" />} title="Histórico" sub="Rotas anteriores e detalhes" />
      <BigLink to="/estatisticas" icon={<BarChart3 className="size-7" />} title="Estatísticas" sub="Entregas, km e economia" />
      <BigLink to="/configuracoes" icon={<Settings className="size-7" />} title="Configurações" sub="Veículo, navegação e privacidade" />
    </Page>
  );
}
