import { formatDate, formatDistance, formatDuration, formatTime, LABELS } from '@derepart/shared';
import { History } from 'lucide-react';
import { Link } from 'react-router';
import { Banner, Card, Chip, EmptyState, Page, Spinner } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useRoutes } from '../lib/queries';

export default function HistoryPage() {
  const q = useRoutes();
  return (
    <Page title="Histórico de rotas" back="/">
      {q.isPending && <Spinner />}
      {q.error && <Banner tone="error">{errorMessage(q.error)}</Banner>}
      {q.data?.length === 0 && (
        <EmptyState icon={<History className="size-10" />} title="Nenhuma rota ainda">
          As rotas criadas aparecem aqui, com distância, tempo e entregas.
        </EmptyState>
      )}
      {q.data?.map((r) => (
        <Link key={r.id} to={r.status === 'in_progress' ? `/rotas/${r.id}/executar` : `/rotas/${r.id}`} className="block">
          <Card className="active:surface-2 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.name}</p>
                <p className="text-muted text-sm">
                  {formatDate(r.startedAt ?? r.createdAt)}
                  {r.startedAt && ` · início ${formatTime(r.startedAt)}`}
                </p>
                <p className="text-muted truncate text-sm">🚩 {r.start.label ?? 'Dados removidos'}</p>
              </div>
              <Chip tone={r.status === 'completed' ? 'green' : r.status === 'in_progress' ? 'blue' : 'gray'}>{LABELS.routeStatus[r.status]}</Chip>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div>
                <p className="text-muted">Entregas</p>
                <p className="font-semibold tabular-nums">
                  {r.deliveriesDone}/{r.deliveriesTotal}
                </p>
              </div>
              <div>
                <p className="text-muted">Não entregues</p>
                <p className="font-semibold tabular-nums">{r.deliveriesFailed}</p>
              </div>
              <div>
                <p className="text-muted">Planejado</p>
                <p className="font-semibold tabular-nums">{formatDistance(r.plannedDistanceM)}</p>
                <p className="tabular-nums">{formatDuration(r.plannedDurationS)}</p>
              </div>
              <div>
                <p className="text-muted">Real</p>
                <p className="font-semibold tabular-nums">{r.actualDistanceM != null ? `≈ ${formatDistance(r.actualDistanceM)}` : '—'}</p>
                <p className="tabular-nums">{formatDuration(r.actualDurationS)}</p>
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </Page>
  );
}
