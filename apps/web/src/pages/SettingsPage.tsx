import {
  estimateFuel,
  formatEuro,
  formatLiters,
  LABELS,
  NAV_APPS,
  OPTIMIZATION_MODES,
  VEHICLE_TYPES,
  type SettingsDto,
  type VehicleDto,
  type VehicleType,
} from '@derepart/shared';
import { LogOut, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Banner, Button, Card, Field, Input, Page, Select, Spinner, Toggle } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { clearOfflineData } from '../lib/offline';
import { supabase } from '../lib/supabase';
import { keys, queryClient, useConfig, useMe, usePlaces, useVehicles } from '../lib/queries';

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

export default function SettingsPage() {
  const me = useMe();
  if (!me.data) return <Spinner />;
  return (
    <Page title="Configurações" back="/">
      <VehicleSection />
      <PreferencesSection settings={me.data.settings} />
      <PlacesSection />
      <PrivacySection settings={me.data.settings} />
      <ProvidersSection />
      <AccountSection name={me.data.user.name} email={me.data.user.email} />
    </Page>
  );
}

function VehicleSection() {
  const q = useVehicles();
  const vehicle = q.data?.find((v) => v.isDefault) ?? q.data?.[0];
  const [type, setType] = useState<VehicleType>('car');
  const [name, setName] = useState('');
  const [consumption, setConsumption] = useState('');
  const [price, setPrice] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!vehicle) return;
    setType(vehicle.type);
    setName(vehicle.name);
    setConsumption(vehicle.fuelConsumptionL100 != null ? String(vehicle.fuelConsumptionL100).replace('.', ',') : '');
    setPrice(vehicle.fuelPriceEurL != null ? String(vehicle.fuelPriceEurL).replace('.', ',') : '');
  }, [vehicle]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const body = { name: name || 'Meu veículo', type, fuelConsumptionL100: type === 'bicycle' ? 0 : num(consumption), fuelPriceEurL: num(price), isDefault: true };
      if (vehicle) await api<VehicleDto>(`/vehicles/${vehicle.id}`, { method: 'PUT', body });
      else await api<VehicleDto>('/vehicles', { method: 'POST', body });
      await queryClient.invalidateQueries({ queryKey: keys.vehicles });
      setMsg({ tone: 'success', text: 'Veículo salvo. Vale para as próximas rotas.' });
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const example = estimateFuel(67_400, num(consumption), num(price));
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Veículo</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as VehicleType)}>
            {VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {LABELS.vehicle[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        {type !== 'bicycle' && (
          <>
            <Field label="Consumo médio (L/100 km)">
              <Input value={consumption} onChange={(e) => setConsumption(e.target.value)} inputMode="decimal" placeholder="6,5" />
            </Field>
            <Field label="Preço do combustível (€/L)">
              <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="1,55" />
            </Field>
          </>
        )}
      </div>
      {example && (
        <p className="text-muted text-sm">
          Exemplo: 67,4 km ≈ {formatLiters(example.liters)}
          {example.cost != null && ` ≈ ${formatEuro(example.cost)}`} (estimativa pelo consumo médio).
        </p>
      )}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <Button onClick={save} loading={busy}>
        Salvar veículo
      </Button>
    </Card>
  );
}

function PreferencesSection({ settings }: { settings: SettingsDto }) {
  const [s, setS] = useState(settings);
  const [msg, setMsg] = useState<string | null>(null);
  const saveSettings = useSaveSettings();
  async function save(next: SettingsDto) {
    setS(next);
    setMsg(await saveSettings(next));
  }
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Rota e navegação</h2>
      <Field label="Prioridade padrão das rotas">
        <Select value={s.defaultMode} onChange={(e) => save({ ...s, defaultMode: e.target.value as SettingsDto['defaultMode'] })}>
          {OPTIMIZATION_MODES.map((m) => (
            <option key={m} value={m}>
              {LABELS.modeIcon[m]} {LABELS.mode[m]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="App de navegação" hint="Abre o destino de cada entrega neste app.">
        <Select value={s.navApp} onChange={(e) => save({ ...s, navApp: e.target.value as SettingsDto['navApp'] })}>
          {NAV_APPS.map((a) => (
            <option key={a} value={a}>
              {LABELS.navApp[a]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Tempo médio por entrega (min)" hint="Estacionar e entregar. Entra no tempo estimado e nos horários de chegada.">
        <Input
          type="number"
          min={0}
          max={30}
          value={Math.round(s.serviceTimeS / 60)}
          onChange={(e) => setS({ ...s, serviceTimeS: Math.max(0, Math.min(30, Number(e.target.value) || 0)) * 60 })}
          onBlur={() => save(s)}
        />
      </Field>
      {msg && <p className="text-muted text-sm">{msg}</p>}
    </Card>
  );
}

function useSaveSettings() {
  return async (next: SettingsDto): Promise<string> => {
    try {
      const saved = await api<SettingsDto>('/me/settings', { method: 'PUT', body: next });
      queryClient.setQueryData(keys.me, (old: { settings: SettingsDto } | undefined) => (old ? { ...old, settings: saved } : old));
      return 'Salvo.';
    } catch (err) {
      return errorMessage(err);
    }
  };
}

function PlacesSection() {
  const q = usePlaces();
  async function remove(id: string) {
    await api(`/places/${id}`, { method: 'DELETE' });
    void queryClient.invalidateQueries({ queryKey: keys.places });
  }
  return (
    <Card className="space-y-2">
      <h2 className="font-bold">Endereços salvos</h2>
      {q.data?.length === 0 && <p className="text-muted text-sm">Salve um ponto de partida ao criar uma rota.</p>}
      {q.data?.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{p.label}</p>
            <p className="text-muted truncate text-sm">{p.address}</p>
          </div>
          <button onClick={() => remove(p.id)} aria-label="Remover" className="text-muted p-2">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </Card>
  );
}

function PrivacySection({ settings }: { settings: SettingsDto }) {
  const navigate = useNavigate();
  const config = useConfig();
  const [s, setS] = useState(settings);
  const [msg, setMsg] = useState<string | null>(null);
  const saveSettings = useSaveSettings();
  async function save(next: SettingsDto) {
    setS(next);
    setMsg(await saveSettings(next));
  }
  async function deleteHistory() {
    if (!confirm('Apagar TODAS as rotas e entregas do histórico? Esta ação não pode ser desfeita.')) return;
    const r = await api<{ deleted: number }>('/me/routes', { method: 'DELETE' });
    await clearOfflineData();
    await queryClient.invalidateQueries();
    setMsg(`${r.deleted} rota(s) apagada(s).`);
  }
  async function deleteAccount() {
    if (!confirm('Excluir sua conta e todos os dados? Esta ação não pode ser desfeita.')) return;
    await api('/me', { method: 'DELETE' });
    // the Supabase user no longer exists on the server: only drop the local session
    await supabase?.auth.signOut({ scope: 'local' });
    await clearOfflineData();
    queryClient.clear();
    navigate('/entrar', { replace: true });
  }
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Privacidade</h2>
      <Toggle
        checked={s.allowAiImages}
        onChange={(v) => save({ ...s, allowAiImages: v })}
        label="Permitir enviar fotos de etiquetas para IA"
        hint={
          config.data?.aiProvider
            ? `Só quando a leitura no celular for incerta e você tocar em “Analisar foto com IA”. A foto vai para ${config.data.aiProvider} e não é armazenada.`
            : 'A IA não está configurada no servidor.'
        }
      />
      <Field label="Apagar dados pessoais das rotas concluídas após (dias)" hint="Nome, telefone, endereço e coordenadas são apagados; ficam só os totais para as estatísticas.">
        <Input
          type="number"
          min={1}
          max={3650}
          value={s.retentionDays}
          onChange={(e) => setS({ ...s, retentionDays: Math.max(1, Number(e.target.value) || 1) })}
          onBlur={() => save(s)}
        />
      </Field>
      {msg && <p className="text-muted text-sm">{msg}</p>}
      <div className="grid gap-2 pt-1">
        <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={deleteHistory}>
          Apagar histórico de rotas
        </Button>
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={deleteAccount}>
          Excluir conta e todos os dados
        </Button>
      </div>
    </Card>
  );
}

function ProvidersSection() {
  const c = useConfig().data;
  if (!c) return null;
  return (
    <Card className="space-y-1 text-sm">
      <h2 className="font-bold">Serviços em uso</h2>
      <p>
        Rotas: <strong>{c.mapProvider.toUpperCase()}</strong> {c.trafficAware ? '(com trânsito)' : '(sem trânsito em tempo real)'}
      </p>
      <p>
        Endereços: <strong>{c.geocoders.join(' → ')}</strong>
      </p>
      <p>
        IA para etiquetas: <strong>{c.aiProvider ?? 'desativada'}</strong>
      </p>
      <p className="text-muted text-xs">Os provedores são configurados no servidor (apps/api/.env).</p>
    </Card>
  );
}

function AccountSection({ name, email }: { name: string; email: string }) {
  const navigate = useNavigate();
  async function logout() {
    try {
      if (supabase) await supabase.auth.signOut();
      else await api('/auth/logout', { method: 'POST' });
    } finally {
      await clearOfflineData();
      queryClient.clear();
      navigate('/entrar', { replace: true });
    }
  }
  return (
    <Card className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{name}</p>
        <p className="text-muted truncate text-sm">{email}</p>
      </div>
      <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={logout}>
        Sair
      </Button>
    </Card>
  );
}
