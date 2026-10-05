import { formatDistance, formatDuration, formatLiters } from '@derepart/shared';
import { Banner, Card, Page, Spinner, Stat } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useStats } from '../lib/queries';

export default function StatsPage() {
  const q = useStats();
  const s = q.data;
  return (
    <Page title="Estatísticas" back="/">
      {q.isPending && <Spinner />}
      {q.error && <Banner tone="error">{errorMessage(q.error)}</Banner>}
      {s && (
        <>
          <p className="text-muted text-sm">Rotas concluídas: {s.routes}</p>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Entregas realizadas" value={s.deliveriesDone} />
            <Stat label="Taxa de sucesso" value={s.successRate != null ? `${Math.round(s.successRate * 100)}%` : '—'} sub={`${s.deliveriesFailed} não entregue(s)`} />
            <Stat label="Km percorridos" value={`≈ ${formatDistance(s.distanceKm * 1000)}`} sub="estimado pelos trechos" />
            <Stat label="Tempo em rota" value={formatDuration(s.timeOnRouteS)} />
            <Stat label="Média por entrega" value={s.kmPerDelivery != null ? `${s.kmPerDelivery.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : '—'} />
            <Stat label="Ignoradas" value={s.deliveriesSkipped} />
          </div>
          <Card className="space-y-1">
            <p className="font-semibold">Economia estimada com a otimização</p>
            <p className="text-muted text-sm">Comparação com a ordem em que os endereços foram adicionados, medida com o mesmo motor de rotas.</p>
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Stat label="Distância" value={formatDistance(s.savedDistanceKm * 1000)} />
              <Stat label="Tempo" value={formatDuration(s.savedDurationS)} />
              <Stat label="Combustível" value={s.savedFuelL != null ? `≈ ${formatLiters(s.savedFuelL)}` : '—'} sub={s.savedFuelL == null ? 'configure o consumo' : 'estimativa'} />
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
