import type { CreateDeliveryInput, RouteDto } from '@derepart/shared';
import { useNavigate, useParams } from 'react-router';
import { DeliveryEditor } from '../components/DeliveryEditor';
import { Banner, Page, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { cacheRoute } from '../lib/offline';
import { setRouteData, useRoute } from '../lib/queries';

/** Manual entry (/rotas/:id/adicionar) and edit (/rotas/:id/entregas/:deliveryId). */
export default function DeliveryFormPage() {
  const { id = '', deliveryId } = useParams();
  const navigate = useNavigate();
  const q = useRoute(id);
  const back = () => navigate(-1);

  if (q.isPending) return <Spinner />;
  const route = q.data;
  const existing = deliveryId ? route?.deliveries.find((d) => d.id === deliveryId) : undefined;
  if (!route || (deliveryId && !existing)) {
    return (
      <Page title="Entrega" back>
        <Banner tone="error">Entrega não encontrada.</Banner>
      </Page>
    );
  }

  async function submit(input: CreateDeliveryInput) {
    const updated = existing
      ? await api<RouteDto>(`/routes/${id}/deliveries/${existing.id}`, { method: 'PATCH', body: input })
      : await api<RouteDto>(`/routes/${id}/deliveries`, { method: 'POST', body: input });
    setRouteData(updated);
    await cacheRoute(updated);
    navigate(route!.status === 'in_progress' ? `/rotas/${id}/executar` : `/rotas/${id}`, { replace: true });
  }

  return (
    <Page title={existing ? 'Editar entrega' : 'Adicionar endereço'} back>
      {route.status === 'in_progress' && !existing && (
        <Banner tone="info">A rota já começou: depois de adicionar, recalcule para encaixar a nova parada no restante do percurso.</Banner>
      )}
      <DeliveryEditor
        initial={
          existing
            ? {
                recipientName: existing.recipientName ?? '',
                phone: existing.phone ?? '',
                street: existing.street ?? '',
                number: existing.number ?? '',
                complement: existing.complement ?? '',
                postalCode: existing.postalCode ?? '',
                city: existing.city ?? '',
                province: existing.province ?? '',
                country: existing.country,
                notes: existing.notes ?? '',
                priority: existing.priority,
                timeWindowStart: existing.timeWindowStart ?? '',
                timeWindowEnd: existing.timeWindowEnd ?? '',
              }
            : undefined
        }
        initialLocation={existing?.lat != null && existing.lng != null ? { lat: existing.lat, lng: existing.lng } : null}
        source={existing?.source ?? 'manual'}
        submitLabel={existing ? 'Salvar' : 'Confirmar'}
        onSubmit={submit}
        onCancel={back}
      />
    </Page>
  );
}
