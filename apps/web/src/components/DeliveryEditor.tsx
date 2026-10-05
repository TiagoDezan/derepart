import {
  LABELS,
  PRIORITIES,
  SPANISH_POSTAL_CODE,
  type AddressCorrection,
  type CreateDeliveryInput,
  type DeliverySource,
  type GeocodeCandidate,
  type GeocodeResponse,
  type LatLng,
  type Priority,
} from '@derepart/shared';
import clsx from 'clsx';
import { Check, MapPin, Pencil, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { LazyMap } from './LazyMap';
import { Banner, Button, Card, Field, Input, Select } from './ui';

export interface DeliveryDraft {
  recipientName: string;
  phone: string;
  street: string;
  number: string;
  complement: string;
  postalCode: string;
  city: string;
  province: string;
  country: string;
  notes: string;
  priority: Priority;
  timeWindowStart: string;
  timeWindowEnd: string;
}

export const emptyDraft = (): DeliveryDraft => ({
  recipientName: '',
  phone: '',
  street: '',
  number: '',
  complement: '',
  postalCode: '',
  city: '',
  province: '',
  country: 'ES',
  notes: '',
  priority: 'normal',
  timeWindowStart: '',
  timeWindowEnd: '',
});

const LOW_CONFIDENCE = 'Verifique este endereço. Algumas informações podem não ter sido identificadas corretamente.';
const FIELD_LABEL: Record<AddressCorrection['field'], string> = {
  street: 'Rua',
  number: 'Número',
  postalCode: 'Código postal',
  city: 'Cidade',
  province: 'Província',
};

/**
 * Edit → geocode → confirm. Nothing recognised by OCR/AI is accepted blindly:
 * the user sees what was found, what was corrected and the point on the map.
 */
export function DeliveryEditor({
  initial,
  initialGeocode,
  initialLocation,
  recognition,
  source = 'manual',
  submitLabel = 'Confirmar',
  onSubmit,
  onCancel,
}: {
  initial?: { [K in keyof DeliveryDraft]?: DeliveryDraft[K] | null };
  initialGeocode?: GeocodeResponse | null;
  initialLocation?: LatLng | null;
  recognition?: { confidence: number; usedAi: boolean; aiProvider: string | null; warnings: string[] } | null;
  source?: DeliverySource;
  submitLabel?: string;
  onSubmit: (input: CreateDeliveryInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<DeliveryDraft>({ ...emptyDraft(), ...stripNulls(initial) });
  const [geo, setGeo] = useState<GeocodeResponse | null>(initialGeocode ?? null);
  const [chosen, setChosen] = useState<GeocodeCandidate | null>(initialGeocode?.best ?? null);
  const [manualPoint, setManualPoint] = useState<LatLng | null>(initialLocation ?? null);
  const [step, setStep] = useState<'form' | 'confirm'>(initialGeocode || initialLocation ? 'confirm' : 'form');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof DeliveryDraft>(k: K, v: DeliveryDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const point: LatLng | null = manualPoint ?? (chosen ? { lat: chosen.lat, lng: chosen.lng } : null);

  async function locate() {
    const errs: Record<string, string> = {};
    if (!draft.street.trim()) errs.street = 'Informe a rua';
    if (draft.country === 'ES' && draft.postalCode && !SPANISH_POSTAL_CODE.test(draft.postalCode.trim())) {
      errs.postalCode = 'Código postal inválido (5 dígitos, ex.: 29620)';
    }
    if (!draft.postalCode.trim() && !draft.city.trim()) errs.city = 'Informe a cidade ou o código postal';
    if (draft.timeWindowStart && draft.timeWindowEnd && draft.timeWindowStart >= draft.timeWindowEnd) errs.timeWindowEnd = 'O fim deve ser depois do início';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<GeocodeResponse>('/geocode', {
        method: 'POST',
        body: {
          street: draft.street,
          number: draft.number || null,
          postalCode: draft.postalCode || null,
          city: draft.city || null,
          province: draft.province || null,
          country: draft.country || 'ES',
        },
      });
      setGeo(res);
      setChosen(res.best);
      setManualPoint(null);
      setStep('confirm');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const final = useMemo(() => {
    const c = chosen;
    const street = c?.street ?? draft.street;
    const number = c?.number ?? (draft.number || null);
    const postalCode = c?.postalCode ?? (draft.postalCode || null);
    const city = c?.city ?? (draft.city || null);
    const province = c?.province ?? (draft.province || null);
    const line1 = [street, number].filter(Boolean).join(', ') + (draft.complement ? `, ${draft.complement}` : '');
    const line2 = [postalCode, city].filter(Boolean).join(' ');
    return { street, number, postalCode, city, province, line1, line2, formattedAddress: [line1, line2].filter(Boolean).join(', ') };
  }, [chosen, draft]);

  async function confirm() {
    if (!point) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        recipientName: draft.recipientName || null,
        phone: draft.phone || null,
        street: final.street,
        number: final.number,
        complement: draft.complement || null,
        postalCode: final.postalCode,
        city: final.city,
        province: final.province,
        country: draft.country || 'ES',
        notes: draft.notes || null,
        formattedAddress: final.formattedAddress,
        lat: point.lat,
        lng: point.lng,
        priority: draft.priority,
        timeWindowStart: draft.timeWindowStart || null,
        timeWindowEnd: draft.timeWindowEnd || null,
        source,
        confidence: recognition?.confidence ?? chosen?.score ?? null,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'form') {
    return (
      <div className="space-y-3">
        {recognition && recognition.confidence < 0.75 && <Banner tone="warn">{LOW_CONFIDENCE}</Banner>}
        <Field label="Nome do destinatário">
          <Input value={draft.recipientName} onChange={(e) => set('recipientName', e.target.value)} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-[1fr_6.5rem] gap-3">
          <Field label="Rua / endereço" error={fieldErrors.street}>
            <Input value={draft.street} onChange={(e) => set('street', e.target.value)} placeholder="Calle San Miguel" autoComplete="off" />
          </Field>
          <Field label="Número">
            <Input value={draft.number} onChange={(e) => set('number', e.target.value)} inputMode="text" placeholder="15" />
          </Field>
        </div>
        <Field label="Complemento" hint="Piso, porta, escada… (ex.: 2ºB)">
          <Input value={draft.complement} onChange={(e) => set('complement', e.target.value)} />
        </Field>
        <div className="grid grid-cols-[7.5rem_1fr] gap-3">
          <Field label="Código postal" error={fieldErrors.postalCode}>
            <Input value={draft.postalCode} onChange={(e) => set('postalCode', e.target.value.replace(/\s/g, ''))} inputMode="numeric" maxLength={10} placeholder="29620" />
          </Field>
          <Field label="Cidade" error={fieldErrors.city}>
            <Input value={draft.city} onChange={(e) => set('city', e.target.value)} placeholder="Torremolinos" />
          </Field>
        </div>
        <Field label="Telefone">
          <Input value={draft.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Observações">
          <Input value={draft.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ex.: deixar na portaria" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Prioridade">
            <Select value={draft.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {LABELS.priority[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Entregar a partir de">
            <Input type="time" value={draft.timeWindowStart} onChange={(e) => set('timeWindowStart', e.target.value)} />
          </Field>
          <Field label="Até" error={fieldErrors.timeWindowEnd}>
            <Input type="time" value={draft.timeWindowEnd} onChange={(e) => set('timeWindowEnd', e.target.value)} />
          </Field>
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        <div className="flex gap-3 pt-1">
          {onCancel && (
            <Button variant="secondary" className="flex-1" onClick={onCancel}>
              Cancelar
            </Button>
          )}
          <Button className="flex-[2]" size="lg" onClick={locate} loading={busy} icon={<MapPin className="size-5" />}>
            Localizar endereço
          </Button>
        </div>
      </div>
    );
  }

  // ---- confirm ----
  const lowConfidence = (recognition && recognition.confidence < 0.75) || geo?.status === 'needs_review' || geo?.status === 'ambiguous';
  const corrections = (chosen?.corrections ?? []).filter((c) => c.from && c.to && c.from.toLowerCase() !== c.to.toLowerCase());

  return (
    <div className="space-y-3">
      <h3 className="text-base font-bold">Endereço identificado</h3>
      {lowConfidence && <Banner tone="warn">{LOW_CONFIDENCE}</Banner>}
      {recognition?.usedAi && (
        <Banner tone="info">
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-4" /> Dados interpretados com IA ({recognition.aiProvider}). Confira antes de confirmar.
          </span>
        </Banner>
      )}

      <Card className="space-y-0.5">
        {draft.recipientName && <p className="font-semibold">{draft.recipientName}</p>}
        <p>{final.line1}</p>
        <p>
          {final.line2}
          {final.province && final.province !== final.city ? `, ${final.province}` : ''}
        </p>
        {(draft.priority !== 'normal' || draft.timeWindowStart || draft.timeWindowEnd) && (
          <p className="text-muted pt-1 text-sm">
            {draft.priority !== 'normal' && `Prioridade ${LABELS.priority[draft.priority].toLowerCase()} · `}
            {(draft.timeWindowStart || draft.timeWindowEnd) && `Entregar ${draft.timeWindowStart || '…'}–${draft.timeWindowEnd || '…'}`}
          </p>
        )}
      </Card>

      {corrections.length > 0 && (
        <div className="surface-2 rounded-xl p-3 text-sm">
          <p className="mb-1 font-medium">Correções sugeridas</p>
          {corrections.map((c) => (
            <p key={c.field}>
              {FIELD_LABEL[c.field]}: <s className="text-muted">{c.from}</s> → <strong>{c.to}</strong>
            </p>
          ))}
        </div>
      )}

      {geo?.messages.filter((m) => !m.startsWith('Encontramos mais')).map((m) => (
        <Banner key={m} tone={geo.status === 'not_found' ? 'error' : 'info'}>
          {m}
        </Banner>
      ))}
      {recognition?.warnings.filter((w) => w !== LOW_CONFIDENCE).map((w) => (
        <Banner key={w} tone="info">
          {w}
        </Banner>
      ))}

      {geo && geo.candidates.length > 1 && (geo.status === 'ambiguous' || geo.status === 'needs_review') && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{geo.status === 'ambiguous' ? 'Escolha o endereço correto:' : 'Outras possibilidades:'}</p>
          {geo.candidates.map((c) => (
            <button
              key={`${c.lat},${c.lng}`}
              onClick={() => {
                setChosen(c);
                setManualPoint(null);
              }}
              className={clsx('w-full rounded-xl border p-3 text-left text-sm', chosen === c ? 'border-brand-600 bg-brand-50 dark:bg-brand-800/30' : 'border-app surface')}
            >
              {c.formattedAddress}
              <span className="text-muted block text-xs">{c.provider}</span>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-app">
        <LazyMap
          className="h-56"
          stops={point ? [{ id: 'p', lat: point.lat, lng: point.lng, label: '•', status: 'en_route' }] : []}
          onPick={picking ? (p) => setManualPoint(p) : undefined}
          // while picking, keep the camera still so the user can tap precisely
          fitKey={picking ? 'picking' : point ? `${point.lat.toFixed(5)},${point.lng.toFixed(5)}` : 'none'}
        />
        <button onClick={() => setPicking((v) => !v)} className={clsx('w-full px-3 py-2 text-sm font-medium', picking ? 'bg-amber-100 text-amber-900' : 'surface-2')}>
          {picking ? 'Toque no mapa para marcar o ponto exato · Concluir' : point ? 'Ajustar ponto no mapa' : 'Marcar o ponto no mapa'}
        </button>
      </div>
      {manualPoint && <p className="text-muted text-xs">Ponto ajustado manualmente.</p>}

      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex gap-3 pt-1">
        <Button variant="secondary" className="flex-1" size="lg" icon={<Pencil className="size-5" />} onClick={() => setStep('form')}>
          Editar
        </Button>
        <Button className="flex-[2]" size="lg" disabled={!point} loading={busy} icon={<Check className="size-5" />} onClick={confirm}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function stripNulls(o?: Partial<Record<keyof DeliveryDraft, unknown>> | null): Partial<DeliveryDraft> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o ?? {})) if (v != null) out[k] = v;
  return out as Partial<DeliveryDraft>;
}
