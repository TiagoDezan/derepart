import {
  formatDate,
  formatDistance,
  formatDuration,
  formatTime,
  LABELS,
  OPTIMIZATION_MODES,
  type DeliveryDto,
  type DeliveryStatus,
  type OptimizationMode,
  type OptimizeResultDto,
  type RouteDto,
} from '@derepart/shared';
import clsx from 'clsx';
import { Camera, Clock, Pencil, PenLine, Play, Route as RouteIcon, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LazyMap } from '../components/LazyMap';
import { RouteSummary } from '../components/RouteSummary';
import { Banner, Button, Card, Chip, EmptyState, Page, Spinner, Stat } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { cacheRoute } from '../lib/offline';
import { keys, queryClient, setRouteData, useOnline, useRoute } from '../lib/queries';

export const STATUS_TONE: Record<DeliveryStatus, 'gray' | 'blue' | 'green' | 'red' | 'amber'> = {
  pending: 'gray',
  en_route: 'blue',
  delivered: 'green',
  failed: 'red',
  skipped: 'amber',
};

export default function RoutePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const q = useRoute(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; ids?: string[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (q.isPending) return <Spinner />;
  if (q.error || !q.data)
    return (
      <Page title="Rota" back="/">
        <Banner tone="error">{errorMessage(q.error)}</Banner>
      </Page>
    );
  const route = q.data;
  const locked = route.status === 'completed' || route.status === 'cancelled';
  const stale = route.plan?.stale ?? false;
  const hasPlan = !!route.plan && !stale;

  const update = async (r: RouteDto) => {
    setRouteData(r);
    await cacheRoute(r);
    void queryClient.invalidateQueries({ queryKey: keys.routes });
  };

  async function optimize(mode?: OptimizationMode) {
    setBusy('optimize');
    setError(null);
    setNotice(null);
    try {
      const res = await api<OptimizeResultDto>(`/routes/${id}/optimize`, { method: 'POST', body: mode ? { optimizationMode: mode } : {} });
      await update(res.route);
      if (res.savings && res.savings.distanceM > 50) {
        setNotice(`Rota otimizada: ${formatDistance(res.savings.distanceM)} e ${formatDuration(Math.max(0, res.savings.durationS))} a menos que a ordem original.`);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError({ message: errorMessage(err), ids: err instanceof ApiError ? (err.details?.deliveryIds as string[] | undefined) : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy('start');
    setError(null);
    try {
      await update(await api<RouteDto>(`/routes/${id}/start`, { method: 'POST' }));
      navigate(`/rotas/${id}/executar`);
    } catch (err) {
      setError({ message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(d: DeliveryDto) {
    if (!confirm(`Excluir a entrega para ${d.recipientName ?? d.formattedAddress}?`)) return;
    try {
      await update(await api<RouteDto>(`/routes/${id}/deliveries/${d.id}`, { method: 'DELETE' }));
    } catch (err) {
      setError({ message: errorMessage(err) });
    }
  }

  async function deleteRoute() {
    if (!confirm('Apagar esta rota e todas as suas entregas? Esta ação não pode ser desfeita.')) return;
    try {
      await api(`/routes/${id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: keys.routes });
      navigate(locked ? '/historico' : '/', { replace: true });
    } catch (err) {
      setError({ message: errorMessage(err) });
    }
  }

  const stops = route.deliveries
    .filter((d) => d.lat != null && d.lng != null)
    .map((d, i) => ({ id: d.id, lat: d.lat!, lng: d.lng!, label: String(d.sequence ?? i + 1), status: d.status }));
  const startPoint = route.start.lat != null && route.start.lng != null ? { lat: route.start.lat, lng: route.start.lng } : null;

  const footer = locked ? null : route.status === 'in_progress' ? (
    <Button size="xl" className="mb-1 w-full" icon={<Play className="size-6" />} onClick={() => navigate(`/rotas/${id}/executar`)}>
      CONTINUAR ROTA
    </Button>
  ) : (
    <div className="mb-1 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" icon={<Camera className="size-5" />} onClick={() => navigate(`/rotas/${id}/escanear`)} disabled={!online}>
          Escanear
        </Button>
        <Button variant="secondary" size="lg" icon={<PenLine className="size-5" />} onClick={() => navigate(`/rotas/${id}/adicionar`)} disabled={!online}>
          Manual
        </Button>
      </div>
      {hasPlan ? (
        <Button size="xl" className="w-full" icon={<Play className="size-6" />} loading={busy === 'start'} onClick={start}>
          INICIAR ROTA
        </Button>
      ) : (
        <Button size="xl" className="w-full" icon={<Zap className="size-6" />} loading={busy === 'optimize'} disabled={route.deliveries.length === 0 || !online} onClick={() => optimize()}>
          {stale ? 'Recalcular rota' : 'Calcular melhor rota'}
        </Button>
      )}
    </div>
  );

  return (
    <Page
      title={route.name}
      back={locked ? '/historico' : '/'}
      footer={footer}
      actions={
        <button onClick={deleteRoute} aria-label="Apagar rota" className="text-muted rounded-full p-2">
          <Trash2 className="size-5" />
        </button>
      }
    >
      {!online && !locked && <Banner tone="warn">Sem internet: você pode ver a rota, mas adicionar endereços e calcular exigem conexão.</Banner>}
      {route.piiPurged && <Banner tone="info">Os dados pessoais desta rota foram apagados pela política de retenção. Os totais foram mantidos.</Banner>}

      {(stops.length > 0 || startPoint) && (
        <div className="-mx-4 -mt-4 overflow-hidden border-b border-app">
          <LazyMap className="h-[42vh]" start={startPoint} stops={stops} geometry={hasPlan || locked ? route.plan?.geometry : null} fitKey={`${route.id}:${stops.length}:${route.plan?.computedAt}`} />
        </div>
      )}

      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="error">{error.message}</Banner>}
      {stale && !locked && (
        <Banner tone="warn">As entregas mudaram depois do último cálculo. {route.status === 'in_progress' ? 'Recalcule para incluir as novas paradas.' : 'Calcule novamente a rota.'}</Banner>
      )}

      {locked ? <CompletedSummary route={route} /> : hasPlan && <RouteSummary route={route} />}

      {!locked && route.deliveries.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {OPTIMIZATION_MODES.map((m) => (
            <button
              key={m}
              disabled={busy !== null || !online}
              onClick={() => optimize(m)}
              className={clsx(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium',
                route.optimizationMode === m ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-800/30 dark:text-brand-100' : 'surface border-app',
              )}
            >
              {LABELS.modeIcon[m]} {LABELS.mode[m]}
            </button>
          ))}
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Entregas ({route.deliveries.length})</h2>
          <span className="text-muted max-w-[60%] truncate text-xs">🚩 {route.start.label ?? '—'}</span>
        </div>
        {route.deliveries.length === 0 ? (
          <EmptyState icon={<RouteIcon className="size-10" />} title="Nenhuma entrega ainda">
            Escaneie as etiquetas ou adicione os endereços manualmente.
          </EmptyState>
        ) : (
          route.deliveries.map((d, i) => (
            <DeliveryRow key={d.id} d={d} index={i} showLeg={hasPlan} editable={!locked && (route.status !== 'in_progress' || d.status === 'pending' || d.status === 'en_route')} routeId={id} onDelete={() => remove(d)} highlight={error?.ids?.includes(d.id)} />
          ))
        )}
      </section>
    </Page>
  );
}

function DeliveryRow({ d, index, showLeg, editable, routeId, onDelete, highlight }: { d: DeliveryDto; index: number; showLeg: boolean; editable: boolean; routeId: string; onDelete: () => void; highlight?: boolean }) {
  return (
    <Card className={clsx('flex gap-3 !p-3', highlight && 'border-red-500 ring-2 ring-red-500/30')}>
      <span className="bg-brand-700 grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white">{d.sequence ?? index + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold">{d.recipientName ?? 'Sem nome'}</p>
          {d.priority !== 'normal' && <Chip tone={d.priority === 'urgent' ? 'red' : 'amber'}>{LABELS.priority[d.priority]}</Chip>}
        </div>
        <p className="text-muted truncate text-sm">{d.formattedAddress}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <Chip tone={STATUS_TONE[d.status]}>{LABELS.deliveryStatus[d.status]}</Chip>
          {showLeg && d.legDistanceM != null && (
            <span className="text-muted tabular-nums">
              {formatDistance(d.legDistanceM)} • {formatDuration(d.legDurationS)}
              {d.etaAt && ` • chegada ≈ ${formatTime(d.etaAt)}`}
            </span>
          )}
          {(d.timeWindowStart || d.timeWindowEnd) && (
            <span className={clsx('inline-flex items-center gap-1', d.windowViolated ? 'font-semibold text-red-600' : 'text-muted')}>
              <Clock className="size-3" /> {d.timeWindowStart ?? '…'}–{d.timeWindowEnd ?? '…'}
            </span>
          )}
          {d.failureReason && <span className="text-red-600">{LABELS.failureReason[d.failureReason]}</span>}
        </div>
      </div>
      {editable && (
        <div className="flex flex-col gap-1">
          <Link to={`/rotas/${routeId}/entregas/${d.id}`} aria-label="Editar" className="text-muted rounded-lg p-1.5">
            <Pencil className="size-4" />
          </Link>
          <button onClick={onDelete} aria-label="Excluir" className="text-muted rounded-lg p-1.5">
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </Card>
  );
}

function CompletedSummary({ route }: { route: RouteDto }) {
  const done = route.deliveries.filter((d) => d.status === 'delivered').length;
  const failed = route.deliveries.filter((d) => d.status === 'failed').length;
  const skipped = route.deliveries.filter((d) => d.status === 'skipped').length;
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">Resumo da rota</h2>
        <Chip tone="green">{LABELS.routeStatus[route.status]}</Chip>
      </div>
      <p className="text-muted text-sm">
        {formatDate(route.startedAt ?? route.createdAt)} · início {formatTime(route.startedAt)} · fim {formatTime(route.completedAt)}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Entregues" value={done} />
        <Stat label="Não entregues" value={failed} />
        <Stat label="Ignoradas" value={skipped} />
        <Stat label="Distância planejada" value={formatDistance(route.plannedDistanceM)} />
        <Stat label="Distância real" value={route.actualDistanceM != null ? `≈ ${formatDistance(route.actualDistanceM)}` : '—'} sub="estimada pelos trechos" />
        <Stat label="Tempo planejado" value={formatDuration(route.plannedDurationS)} />
        <Stat label="Tempo real" value={formatDuration(route.actualDurationS)} />
      </div>
    </Card>
  );
}
