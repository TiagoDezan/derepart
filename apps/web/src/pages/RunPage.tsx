import {
  decodePolyline,
  distanceToPolylineM,
  FAILURE_REASONS,
  formatDistance,
  formatDuration,
  formatTime,
  LABELS,
  OPEN_DELIVERY_STATUSES,
  type FailureReason,
  type LatLng,
  type OptimizeResultDto,
  type RouteDto,
} from '@derepart/shared';
import clsx from 'clsx';
import { Camera, Check, Plus, CheckCircle2, Clock, List, Map as MapIcon, Navigation, PenLine, Phone, RefreshCw, SkipForward, StickyNote, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LazyMap } from '../components/LazyMap';
import { Banner, Button, Card, Chip, Field, Input, Page, Sheet, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { getCurrentPosition, navigationUrl, openNavigation } from '../lib/device';
import { cacheRoute, recordEvent } from '../lib/offline';
import { keys, queryClient, setRouteData, useMe, useOnline, useRoute } from '../lib/queries';
import { STATUS_TONE } from './RoutePage';

const OFF_ROUTE_M = 400;
const OFF_ROUTE_READINGS = 3;

export default function RunPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useRoute(id);
  const me = useMe();
  const online = useOnline();
  const [view, setView] = useState<'card' | 'map' | 'list'>('card');
  const [failOpen, setFailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = q.data;

  const ordered = useMemo(
    () => (route ? [...route.deliveries].sort((a, b) => (a.sequence ?? 1e9) - (b.sequence ?? 1e9)) : []),
    [route],
  );
  const current = ordered.find((d) => d.status === 'en_route') ?? ordered.find((d) => d.status === 'pending') ?? null;
  const openCount = ordered.filter((d) => OPEN_DELIVERY_STATUSES.includes(d.status)).length;
  const position = current ? ordered.indexOf(current) + 1 : ordered.length;

  const offRoute = useOffRouteDetector(route ?? null, !!current && route?.status === 'in_progress');

  if (q.isPending) return <Spinner />;
  if (!route) return <Page title="Rota" back="/"><Banner tone="error">{errorMessage(q.error)}</Banner></Page>;

  const save = async (r: RouteDto) => {
    setRouteData(r);
    await cacheRoute(r);
  };

  async function mark(type: 'delivery_completed' | 'delivery_skipped', deliveryId: string) {
    await save(await recordEvent(route!, { type, deliveryId }));
  }

  async function fail(reason: FailureReason, note: string) {
    if (!current) return;
    await save(await recordEvent(route!, { type: 'delivery_failed', deliveryId: current.id, reason, note: note || null }));
    setFailOpen(false);
  }

  async function recalculate(pos?: LatLng | null) {
    setBusy('recalc');
    setError(null);
    try {
      let position = pos ?? null;
      if (!position) {
        try {
          position = await getCurrentPosition(8000);
        } catch {
          position = null; // fall back to the last visited stop (server side)
        }
      }
      const res = await api<OptimizeResultDto>(`/routes/${id}/optimize`, { method: 'POST', body: { position } });
      await save(res.route);
      offRoute.reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function finish() {
    const remaining = openCount;
    if (remaining > 0 && !confirm(`Ainda há ${remaining} entrega(s) pendente(s). Elas serão marcadas como ignoradas. Finalizar?`)) return;
    setBusy('finish');
    setError(null);
    try {
      const done = await api<RouteDto>(`/routes/${id}/complete`, { method: 'POST', body: { skipRemaining: true } });
      await save(done);
      void queryClient.invalidateQueries({ queryKey: keys.routes });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
      navigate(`/rotas/${id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const navApp = me.data?.settings.navApp ?? 'google';
  const stale = route.plan?.stale ?? false;

  return (
    <Page
      title={route.name}
      back={`/rotas/${id}`}
      actions={
        <div className="flex">
          <button aria-label="Cartão" onClick={() => setView('card')} className={clsx('rounded-full p-2', view === 'card' && 'text-brand-700')}>
            <Navigation className="size-5" />
          </button>
          <button aria-label="Mapa" onClick={() => setView('map')} className={clsx('rounded-full p-2', view === 'map' && 'text-brand-700')}>
            <MapIcon className="size-5" />
          </button>
          <button aria-label="Lista" onClick={() => setView('list')} className={clsx('rounded-full p-2', view === 'list' && 'text-brand-700')}>
            <List className="size-5" />
          </button>
        </div>
      }
    >
      {offRoute.isOff && (
        <Banner
          tone="warn"
          action={
            <Button size="sm" onClick={() => recalculate(offRoute.last)} loading={busy === 'recalc'} disabled={!online}>
              Recalcular rota
            </Button>
          }
        >
          Você está fora da rota planejada.
        </Banner>
      )}
      {stale && (
        <Banner
          tone="warn"
          action={
            <Button size="sm" onClick={() => recalculate()} loading={busy === 'recalc'} disabled={!online}>
              Recalcular
            </Button>
          }
        >
          Há entregas novas ou alteradas. Recalcule a partir da sua posição.
        </Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}

      {view === 'map' && (
        <div className="-mx-4 overflow-hidden">
          <LazyMap
            className="h-[60vh]"
            start={route.start.lat != null ? { lat: route.start.lat, lng: route.start.lng! } : null}
            stops={ordered.filter((d) => d.lat != null).map((d) => ({ id: d.id, lat: d.lat!, lng: d.lng!, label: String(d.sequence ?? '?'), status: d.status, highlight: d.id === current?.id }))}
            geometry={route.plan?.geometry}
            position={offRoute.last}
            fitKey={`run:${route.plan?.computedAt}`}
          />
        </div>
      )}

      {view === 'list' && (
        <div className="space-y-2">
          {ordered.map((d) => (
            <Card key={d.id} className={clsx('flex items-center gap-3 !p-3', d.id === current?.id && 'border-sky-500 ring-2 ring-sky-500/30')}>
              <span className="bg-brand-700 grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold text-white">{d.sequence}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{d.recipientName ?? d.formattedAddress}</p>
                <p className="text-muted truncate text-xs">{d.formattedAddress}</p>
              </div>
              <Chip tone={STATUS_TONE[d.status]}>{LABELS.deliveryStatus[d.status]}</Chip>
              {(d.status === 'failed' || d.status === 'skipped' || d.status === 'delivered') && (
                <button className="text-muted text-xs underline" onClick={() => recordEvent(route, { type: 'delivery_reset', deliveryId: d.id }).then(save)}>
                  desfazer
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      {view === 'card' &&
        (current ? (
          <Card className="space-y-4 !p-5">
            <div className="flex items-center justify-between">
              <p className="text-muted text-sm font-bold tracking-wider">
                ENTREGA {position} DE {ordered.length}
              </p>
              {current.priority !== 'normal' && <Chip tone={current.priority === 'urgent' ? 'red' : 'amber'}>{LABELS.priority[current.priority]}</Chip>}
            </div>
            <div>
              <p className="text-2xl leading-tight font-bold">{current.recipientName ?? 'Destinatário'}</p>
              <p className="mt-1 text-lg">{[current.street, current.number].filter(Boolean).join(', ')}{current.complement ? `, ${current.complement}` : ''}</p>
              <p className="text-muted text-lg">{[current.postalCode, current.city].filter(Boolean).join(' ')}</p>
            </div>
            <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-base">
              {current.legDistanceM != null && (
                <span className="tabular-nums">
                  {formatDistance(current.legDistanceM)} • {formatDuration(current.legDurationS)}
                </span>
              )}
              {current.etaAt && <span>chegada ≈ {formatTime(current.etaAt)}</span>}
              {(current.timeWindowStart || current.timeWindowEnd) && (
                <span className={clsx('inline-flex items-center gap-1', current.windowViolated && 'font-semibold text-red-600')}>
                  <Clock className="size-4" /> {current.timeWindowStart ?? '…'}–{current.timeWindowEnd ?? '…'}
                </span>
              )}
            </div>
            {current.notes && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <StickyNote className="mt-0.5 size-4 shrink-0" /> {current.notes}
              </p>
            )}
            <Button
              size="xl"
              className="w-full"
              icon={<Navigation className="size-6" />}
              disabled={current.lat == null}
              onClick={() => openNavigation(navigationUrl(navApp, { lat: current.lat!, lng: current.lng! }, current.formattedAddress, route.vehicle.type))}
            >
              NAVEGAR
            </Button>
            <Button size="xl" variant="success" className="w-full" icon={<Check className="size-6" />} onClick={() => mark('delivery_completed', current.id)}>
              ENTREGUE
            </Button>
            <Button size="xl" variant="danger" className="w-full" icon={<X className="size-6" />} onClick={() => setFailOpen(true)}>
              NÃO ENTREGUE
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" size="sm" icon={<SkipForward className="size-4" />} onClick={() => mark('delivery_skipped', current.id)}>
                Pular
              </Button>
              {current.phone ? (
                <a href={`tel:${current.phone}`} className="surface inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-app text-sm font-semibold">
                  <Phone className="size-4" /> Ligar
                </a>
              ) : (
                <span />
              )}
              <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" />} loading={busy === 'recalc'} disabled={!online} onClick={() => recalculate()}>
                Recalcular
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="space-y-4 text-center !p-6">
            <CheckCircle2 className="mx-auto size-14 text-emerald-600" />
            <p className="text-xl font-bold">Todas as entregas foram concluídas</p>
            <p className="text-muted">
              {route.deliveriesDone} entregue(s) · {route.deliveriesFailed} não entregue(s)
              {route.returnToStart && route.plan?.returnLeg ? ` · volta ao início: ${formatDistance(route.plan.returnLeg.distanceM)}` : ''}
            </p>
            {route.returnToStart && route.start.lat != null && (
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                icon={<Navigation className="size-5" />}
                onClick={() => openNavigation(navigationUrl(navApp, { lat: route.start.lat!, lng: route.start.lng! }, route.start.label ?? 'Início', route.vehicle.type))}
              >
                Navegar de volta ao início
              </Button>
            )}
          </Card>
        ))}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" icon={<Plus className="size-5" />} onClick={() => setAddOpen(true)} disabled={!online}>
          Nova entrega
        </Button>
        <Button variant={current ? 'secondary' : 'primary'} size="lg" loading={busy === 'finish'} disabled={!online} onClick={finish}>
          Finalizar rota
        </Button>
      </div>
      {!online && <p className="text-muted text-center text-xs">Sem internet: as entregas marcadas serão sincronizadas automaticamente.</p>}
      <p className="text-muted text-center text-xs">A localização é usada só neste aparelho para detectar desvios; não é armazenada.</p>

      <FailSheet open={failOpen} onClose={() => setFailOpen(false)} onSubmit={fail} />
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Adicionar entrega">
        <div className="grid gap-2">
          <Link to={`/rotas/${id}/escanear`}>
            <Button size="lg" className="w-full" icon={<Camera className="size-5" />}>
              Escanear etiqueta
            </Button>
          </Link>
          <Link to={`/rotas/${id}/adicionar`}>
            <Button size="lg" variant="secondary" className="w-full" icon={<PenLine className="size-5" />}>
              Digitar endereço
            </Button>
          </Link>
          <p className="text-muted text-sm">Depois de adicionar, toque em “Recalcular”: as entregas concluídas são mantidas e só o restante é otimizado a partir da sua posição.</p>
        </div>
      </Sheet>
    </Page>
  );
}

function FailSheet({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (r: FailureReason, note: string) => Promise<void> }) {
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setReason(null);
      setNote('');
    }
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Não entregue — motivo">
      <div className="space-y-2">
        {FAILURE_REASONS.map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className={clsx('h-14 w-full rounded-xl border px-4 text-left text-base font-semibold', reason === r ? 'border-red-500 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-100' : 'surface border-app')}
          >
            {LABELS.failureReason[r]}
          </button>
        ))}
        <Field label="Observação (opcional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
        <Button size="lg" variant="danger" className="w-full" disabled={!reason} onClick={() => reason && onSubmit(reason, note)}>
          Registrar não entrega
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Off-route detection while this screen is open: GPS readings are compared with the planned
 * polyline in memory only. Positions are never stored or sent, except when the user asks to
 * recalculate. (A PWA cannot track in background; a native build could.)
 */
function useOffRouteDetector(route: RouteDto | null, enabled: boolean) {
  const [isOff, setIsOff] = useState(false);
  const [last, setLast] = useState<LatLng | null>(null);
  const strikes = useRef(0);
  const reported = useRef(false);
  const line = useMemo(() => (route?.plan?.geometry ? decodePolyline(route.plan.geometry) : null), [route?.plan?.geometry]);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    if (!enabled || !line || line.length < 2 || !('geolocation' in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setLast(pos);
        if (p.coords.accuracy > 100) return;
        const d = distanceToPolylineM(pos, line);
        strikes.current = d > OFF_ROUTE_M ? strikes.current + 1 : 0;
        const off = strikes.current >= OFF_ROUTE_READINGS;
        setIsOff(off);
        if (off && !reported.current && routeRef.current) {
          reported.current = true;
          void recordEvent(routeRef.current, { type: 'off_route_detected', deliveryId: null });
        }
        if (!off) reported.current = false;
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [enabled, line]);

  return {
    isOff,
    last,
    reset: () => {
      strikes.current = 0;
      setIsOff(false);
    },
  };
}
