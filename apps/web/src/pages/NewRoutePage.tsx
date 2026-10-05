import { LABELS, OPTIMIZATION_MODES, type GeocodeCandidate, type GeocodeResponse, type OptimizationMode, type RouteDto } from '@derepart/shared';
import clsx from 'clsx';
import { Bookmark, Crosshair, Map as MapIcon, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { LazyMap } from '../components/LazyMap';
import { Banner, Button, Card, Field, Input, Page, Select, Toggle } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { getCurrentPosition } from '../lib/device';
import { keys, queryClient, setRouteData, useMe, usePlaces, useVehicles } from '../lib/queries';

type Method = 'gps' | 'search' | 'map' | 'saved';
interface StartPoint {
  label: string;
  lat: number;
  lng: number;
}

export const MODE_HINT: Record<OptimizationMode, string> = {
  fastest: 'Prioriza o menor tempo total.',
  economic: 'Prioriza menos km e menos combustível.',
  balanced: 'Equilibra tempo, distância e rotas mais simples.',
};

export default function NewRoutePage() {
  const navigate = useNavigate();
  const me = useMe();
  const places = usePlaces();
  const vehicles = useVehicles();
  const [method, setMethod] = useState<Method | null>(null);
  const [start, setStart] = useState<StartPoint | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeCandidate[]>([]);
  const [returnToStart, setReturnToStart] = useState(false);
  const [mode, setMode] = useState<OptimizationMode>(me.data?.settings.defaultMode ?? 'balanced');
  const [vehicleId, setVehicleId] = useState<string>('');
  const [saveAs, setSaveAs] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function labelFor(lat: number, lng: number) {
    try {
      const r = await api<{ candidate: GeocodeCandidate | null }>(`/geocode/reverse?lat=${lat}&lng=${lng}`);
      return r.candidate?.formattedAddress ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }

  async function useGps() {
    setMethod('gps');
    setBusy('gps');
    setError(null);
    try {
      const p = await getCurrentPosition();
      setStart({ lat: p.lat, lng: p.lng, label: await labelFor(p.lat, p.lng) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (query.trim().length < 3) return;
    setBusy('search');
    setError(null);
    try {
      const r = await api<GeocodeResponse>('/geocode', { method: 'POST', body: { query } });
      setResults(r.candidates);
      if (r.candidates.length === 0) setError('Não encontramos este endereço. Tente incluir a cidade.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function pickOnMap(p: { lat: number; lng: number }) {
    setStart({ ...p, label: 'Buscando endereço…' });
    setStart({ ...p, label: await labelFor(p.lat, p.lng) });
  }

  async function create() {
    if (!start) return;
    setBusy('create');
    setError(null);
    try {
      if (saveAs.trim()) {
        await api('/places', { method: 'POST', body: { label: saveAs.trim(), address: start.label, lat: start.lat, lng: start.lng } });
        void queryClient.invalidateQueries({ queryKey: keys.places });
      }
      const route = await api<RouteDto>('/routes', {
        method: 'POST',
        body: { start, returnToStart, optimizationMode: mode, vehicleId: vehicleId || null },
      });
      setRouteData(route);
      void queryClient.invalidateQueries({ queryKey: keys.routes });
      navigate(`/rotas/${route.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const methods: { id: Method; label: string; icon: React.ReactNode; onClick: () => void }[] = [
    { id: 'gps', label: 'Localização atual', icon: <Crosshair className="size-5" />, onClick: useGps },
    { id: 'search', label: 'Digitar endereço', icon: <Search className="size-5" />, onClick: () => setMethod('search') },
    { id: 'map', label: 'Selecionar no mapa', icon: <MapIcon className="size-5" />, onClick: () => setMethod('map') },
    { id: 'saved', label: 'Endereço salvo', icon: <Bookmark className="size-5" />, onClick: () => setMethod('saved') },
  ];

  return (
    <Page
      title="Nova rota"
      back="/"
      footer={
        <Button size="xl" className="mb-1 w-full" disabled={!start} loading={busy === 'create'} onClick={create}>
          Criar rota e adicionar entregas
        </Button>
      }
    >
      <section className="space-y-3">
        <h2 className="font-bold">Ponto de partida</h2>
        <div className="grid grid-cols-2 gap-2">
          {methods.map((m) => (
            <button
              key={m.id}
              onClick={m.onClick}
              className={clsx(
                'flex h-16 items-center gap-2 rounded-xl border px-3 text-left text-sm font-semibold',
                method === m.id ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-800/30 dark:text-brand-100' : 'surface border-app',
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>

        {method === 'search' && (
          <form onSubmit={search} className="space-y-2">
            <div className="flex gap-2">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex.: Calle San Miguel 1, Torremolinos" autoFocus />
              <Button type="submit" loading={busy === 'search'} icon={<Search className="size-5" />} aria-label="Buscar" />
            </div>
            {results.map((c) => (
              <button
                key={`${c.lat},${c.lng}`}
                onClick={() => setStart({ label: c.formattedAddress, lat: c.lat, lng: c.lng })}
                className={clsx('w-full rounded-xl border p-3 text-left text-sm', start?.lat === c.lat && start?.lng === c.lng ? 'border-brand-600 bg-brand-50 dark:bg-brand-800/30' : 'surface border-app')}
              >
                {c.formattedAddress}
              </button>
            ))}
          </form>
        )}

        {method === 'saved' && (
          <div className="space-y-2">
            {places.data?.length === 0 && <p className="text-muted text-sm">Nenhum endereço salvo ainda. Escolha um ponto e marque "Salvar como".</p>}
            {places.data?.map((p) => (
              <button
                key={p.id}
                onClick={() => setStart({ label: p.address, lat: p.lat, lng: p.lng })}
                className={clsx('w-full rounded-xl border p-3 text-left', start?.lat === p.lat && start?.lng === p.lng ? 'border-brand-600 bg-brand-50 dark:bg-brand-800/30' : 'surface border-app')}
              >
                <span className="block font-semibold">{p.label}</span>
                <span className="text-muted block text-sm">{p.address}</span>
              </button>
            ))}
          </div>
        )}

        {(method === 'map' || start) && (
          <div className="overflow-hidden rounded-2xl border border-app">
            <LazyMap
              className="h-60"
              start={start}
              onPick={method === 'map' ? pickOnMap : undefined}
              fitKey={method === 'map' ? 'map' : start ? `${start.lat},${start.lng}` : 'none'}
            />
            {method === 'map' && <p className="surface-2 px-3 py-2 text-sm">Toque no mapa para marcar o ponto de partida.</p>}
          </div>
        )}

        {start && (
          <Card>
            <p className="text-muted text-xs">Partida</p>
            <p className="font-semibold">{start.label}</p>
            {method !== 'saved' && (
              <div className="mt-3">
                <Field label="Salvar como (opcional)" hint="Ex.: Depósito, Casa">
                  <Input value={saveAs} onChange={(e) => setSaveAs(e.target.value)} maxLength={60} />
                </Field>
              </div>
            )}
          </Card>
        )}
        {busy === 'gps' && <Banner tone="info">Obtendo sua localização…</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
      </section>

      <Card>
        <Toggle checked={returnToStart} onChange={setReturnToStart} label="Voltar ao ponto inicial ao finalizar" hint="Calcula uma rota de ida e volta." />
      </Card>

      <section className="space-y-2">
        <h2 className="font-bold">Prioridade da rota</h2>
        {OPTIMIZATION_MODES.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={clsx('flex w-full items-center gap-3 rounded-xl border p-3 text-left', mode === m ? 'border-brand-600 bg-brand-50 dark:bg-brand-800/30' : 'surface border-app')}
          >
            <span className="text-2xl">{LABELS.modeIcon[m]}</span>
            <span>
              <span className="block font-semibold">{LABELS.mode[m]}</span>
              <span className="text-muted block text-sm">{MODE_HINT[m]}</span>
            </span>
          </button>
        ))}
      </section>

      {vehicles.data && vehicles.data.length > 1 && (
        <Field label="Veículo">
          <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Padrão</option>
            {vehicles.data.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({LABELS.vehicle[v.type]})
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Page>
  );
}
