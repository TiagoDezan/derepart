import type { CreateDeliveryInput, RecognitionResult, RouteDto } from '@derepart/shared';
import clsx from 'clsx';
import { Camera, CheckCircle2, ImagePlus, Loader2, RotateCcw, Sparkles, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DeliveryEditor } from '../components/DeliveryEditor';
import { Banner, Button, Page, Sheet } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { cacheRoute } from '../lib/offline';
import { canvasToBase64, preprocess, recognizeLabel, warmUpOcr } from '../lib/ocr';
import { setRouteData, useConfig, useMe, useRoute } from '../lib/queries';

type Status = 'queued' | 'ocr' | 'parsing' | 'ready' | 'error' | 'added';
interface ScanItem {
  id: string;
  thumb: string;
  blob: Blob;
  canvas?: HTMLCanvasElement;
  status: Status;
  ocrText?: string;
  ocrConfidence?: number;
  result?: RecognitionResult;
  error?: string;
}

export default function ScanPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const route = useRoute(id);
  const me = useMe();
  const config = useConfig();
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [items, setItems] = useState<ScanItem[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const processing = useRef(false);

  const patch = useCallback((itemId: string, p: Partial<ScanItem>) => setItems((list) => list.map((it) => (it.id === itemId ? { ...it, ...p } : it))), []);

  // camera
  useEffect(() => {
    let active: MediaStream | null = null;
    void warmUpOcr().catch(() => undefined);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(new ApiError('CAMERA_UNAVAILABLE').message);
        return;
      }
      try {
        active = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        setStream(active);
      } catch (err) {
        setCameraError(new ApiError((err as Error).name === 'NotAllowedError' ? 'CAMERA_DENIED' : 'CAMERA_UNAVAILABLE').message);
      }
    })();
    return () => active?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream]);

  // free thumbnails on leave (images are never stored)
  useEffect(() => () => items.forEach((it) => URL.revokeObjectURL(it.thumb)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function enqueue(blob: Blob) {
    setItems((list) => [{ id: crypto.randomUUID(), blob, thumb: URL.createObjectURL(blob), status: 'queued' }, ...list]);
  }

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    c.toBlob((b) => b && enqueue(b), 'image/jpeg', 0.92);
  }

  // sequential processing queue: OCR on device → server parse + geocode
  useEffect(() => {
    if (processing.current) return;
    const next = [...items].reverse().find((it) => it.status === 'queued');
    if (!next) return;
    processing.current = true;
    void (async () => {
      try {
        let { canvas, ocrText, ocrConfidence } = next;
        if (!ocrText) {
          patch(next.id, { status: 'ocr' });
          canvas = await preprocess(next.blob);
          const ocr = await recognizeLabel(canvas);
          ocrText = ocr.text;
          ocrConfidence = ocr.confidence;
          patch(next.id, { canvas, ocrText, ocrConfidence });
        }
        if (!ocrText || ocrText.trim().length < 5) throw new ApiError('OCR_FAILED');
        patch(next.id, { status: 'parsing' });
        const result = await api<RecognitionResult>('/recognition/text', { method: 'POST', body: { text: ocrText, ocrConfidence, allowAi: true } });
        patch(next.id, { status: 'ready', result });
      } catch (err) {
        patch(next.id, { status: 'error', error: errorMessage(err) || new ApiError('OCR_FAILED').message });
      } finally {
        processing.current = false;
        setItems((l) => [...l]); // trigger next
      }
    })();
  }, [items, patch]);

  const current = items.find((it) => it.id === reviewing) ?? null;
  const aiAvailable = !!config.data?.aiProvider;
  const aiImagesAllowed = !!me.data?.settings.allowAiImages;

  async function analyseWithAi(item: ScanItem) {
    setAiBusy(true);
    setAiError(null);
    try {
      const canvas = item.canvas ?? (await preprocess(item.blob));
      const result = await api<RecognitionResult>('/recognition/image', {
        method: 'POST',
        body: { imageBase64: canvasToBase64(canvas), mimeType: 'image/jpeg', ocrText: item.ocrText ?? null },
      });
      patch(item.id, { result, status: 'ready', canvas });
      setReviewing(null);
      setTimeout(() => setReviewing(item.id), 0); // remount the editor with the new result
    } catch (err) {
      setAiError(errorMessage(err));
    } finally {
      setAiBusy(false);
    }
  }

  async function add(item: ScanItem, input: CreateDeliveryInput) {
    const updated = await api<RouteDto>(`/routes/${id}/deliveries`, {
      method: 'POST',
      body: { ...input, source: item.result?.usedAi ? 'ai' : 'ocr' },
    });
    setRouteData(updated);
    await cacheRoute(updated);
    patch(item.id, { status: 'added', canvas: undefined });
    setReviewing(null);
  }

  const added = items.filter((i) => i.status === 'added').length;
  const pending = items.filter((i) => i.status === 'ready').length;
  const backTo = route.data?.status === 'in_progress' ? `/rotas/${id}/executar` : `/rotas/${id}`;

  return (
    <Page
      title="Escanear etiquetas"
      back={backTo}
      bleed
      footer={
        <Button size="lg" variant={pending ? 'secondary' : 'primary'} className="mb-1 w-full" onClick={() => navigate(backTo)}>
          Concluir ({added} adicionada{added === 1 ? '' : 's'}
          {pending ? `, ${pending} para revisar` : ''})
        </Button>
      }
    >
      <div className="relative bg-black">
        {stream ? (
          <video ref={video} autoPlay playsInline muted className="h-[46vh] w-full object-cover" />
        ) : (
          <div className="grid h-[30vh] place-items-center p-6 text-center text-white/80">
            <div className="space-y-3">
              <p>{cameraError ?? 'Abrindo a câmera…'}</p>
              <Button variant="secondary" icon={<ImagePlus className="size-5" />} onClick={() => fileInput.current?.click()}>
                Tirar / escolher foto
              </Button>
            </div>
          </div>
        )}
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {stream && (
          <>
            <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-white/70" />
            <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-6">
              <button onClick={() => fileInput.current?.click()} aria-label="Escolher foto" className="grid size-12 place-items-center rounded-full bg-black/50 text-white">
                <ImagePlus className="size-6" />
              </button>
              <button onClick={capture} aria-label="Fotografar etiqueta" className="grid size-20 place-items-center rounded-full border-4 border-white bg-white/30 active:bg-white/60">
                <Camera className="size-8 text-white" />
              </button>
              <span className="size-12" />
            </div>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => {
            Array.from(e.target.files ?? []).forEach(enqueue);
            e.target.value = '';
          }}
        />
      </div>

      <div className="space-y-2 p-4">
        <p className="text-muted text-xs">A leitura (OCR) é feita no próprio celular. As fotos não são armazenadas.</p>
        {items.length === 0 && <Banner tone="info">Enquadre a etiqueta com boa luz e toque no botão. Você pode fotografar várias seguidas.</Banner>}
        {items.map((it) => (
          <button
            key={it.id}
            disabled={it.status !== 'ready' && it.status !== 'error'}
            onClick={() => setReviewing(it.id)}
            className={clsx('surface flex w-full items-center gap-3 rounded-xl border border-app p-2 text-left', it.status === 'added' && 'opacity-60')}
          >
            <img src={it.thumb} alt="" className="size-14 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <ItemStatus item={it} />
              {it.result && (
                <p className="truncate text-sm">
                  {[it.result.fields.recipientName, it.result.geocode?.best?.formattedAddress ?? [it.result.fields.street, it.result.fields.number, it.result.fields.city].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(' — ')}
                </p>
              )}
              {it.error && <p className="truncate text-sm text-red-600">{it.error}</p>}
            </div>
            {it.status === 'error' && (
              <span
                role="button"
                aria-label="Tentar de novo"
                className="text-muted p-2"
                onClick={(e) => {
                  e.stopPropagation();
                  patch(it.id, { status: 'queued', error: undefined });
                }}
              >
                <RotateCcw className="size-5" />
              </span>
            )}
          </button>
        ))}
      </div>

      <Sheet open={!!current} onClose={() => setReviewing(null)} title="Confirmar endereço">
        {current && (
          <div className="space-y-3">
            <img src={current.thumb} alt="Etiqueta" className="max-h-40 w-full rounded-xl object-contain" />
            {current.result && current.result.confidence < 0.75 && aiAvailable && !current.result.usedAi && (
              <div className="surface-2 space-y-2 rounded-xl p-3 text-sm">
                {aiImagesAllowed ? (
                  <>
                    <p>
                      A leitura ficou incerta. Você pode enviar <strong>esta foto</strong> para a IA ({config.data?.aiProvider}) interpretar. A imagem não é armazenada.
                    </p>
                    <Button size="sm" variant="secondary" icon={<Sparkles className="size-4" />} loading={aiBusy} onClick={() => analyseWithAi(current)}>
                      Analisar foto com IA
                    </Button>
                  </>
                ) : (
                  <p className="text-muted">A análise da foto por IA está desativada. Você pode ativá-la em Configurações → Privacidade.</p>
                )}
                {aiError && <p className="text-red-600">{aiError}</p>}
              </div>
            )}
            <DeliveryEditor
              key={`${current.id}:${current.result?.usedAi ?? 'x'}:${current.status}`}
              initial={current.result ? { ...current.result.fields } : undefined}
              initialGeocode={current.result?.geocode?.best ? current.result.geocode : null}
              recognition={current.result ?? null}
              source={current.result?.usedAi ? 'ai' : 'ocr'}
              onSubmit={(input) => add(current, input)}
              onCancel={() => setReviewing(null)}
            />
          </div>
        )}
      </Sheet>
    </Page>
  );
}

function ItemStatus({ item }: { item: ScanItem }) {
  const map: Record<Status, [string, React.ReactNode]> = {
    queued: ['Na fila…', <Loader2 key="q" className="size-4 animate-spin" />],
    ocr: ['Lendo a etiqueta…', <Loader2 key="o" className="size-4 animate-spin" />],
    parsing: ['Identificando o endereço…', <Loader2 key="p" className="size-4 animate-spin" />],
    ready: ['Toque para confirmar', <CheckCircle2 key="r" className="size-4 text-sky-600" />],
    error: ['Falhou — toque para preencher', <XCircle key="e" className="size-4 text-red-600" />],
    added: ['Adicionada à rota', <CheckCircle2 key="a" className="size-4 text-emerald-600" />],
  };
  const [label, icon] = map[item.status];
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold">
      {icon} {label}
      {item.result && item.status === 'ready' && item.result.confidence < 0.75 && <span className="text-amber-600">· verificar</span>}
    </span>
  );
}
