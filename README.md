# Derepart: rotas de entrega otimizadas

PWA para entregadores: fotografe as etiquetas, confirme os endereços, calcule a melhor
ordem das entregas e navegue parada a parada com o Google Maps, o Waze ou o Apple Maps.

A análise de arquitetura e a comparação Google Maps × OpenStreetMap (OSRM/Valhalla) estão em
[docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Como rodar (desenvolvimento)

Requisitos: Node 22+. Não precisa de Docker nem de banco instalado (usa PGlite, um Postgres embutido).

```bash
npm install
cp apps/api/.env.example apps/api/.env     # ajuste NOMINATIM_USER_AGENT com seu e-mail
npm run seed                               # dados de teste (com a API parada)
npm run dev                                # API :8787 + web :5173
```

Abra http://localhost:5173 e entre com **demo@derepart.local / demo12345**. A rota
"Rota de teste — Costa del Sol" tem 12 endereços reais (destinatários fictícios), prontos para calcular.

> **No celular:** a câmera e o GPS só funcionam em HTTPS (ou em `localhost`). Para testar no
> telefone, publique em um domínio com HTTPS ou use um túnel (`cloudflared tunnel --url http://localhost:5173`).
> Depois use “Adicionar à tela inicial” para instalar o PWA.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API (tsx watch) e web (Vite) juntos |
| `npm test` | Testes unitários e de integração (solver, parser, fluxo completo da API, offline) |
| `npm run typecheck` | TypeScript em todos os pacotes |
| `npm run seed` | Recria a conta demo e a rota de teste (API parada) |
| `npm run check:providers --workspace @derepart/api` | Testa ao vivo geocoding + matriz + otimização com os provedores do `.env` |
| `npm run e2e` | Teste ponta a ponta da interface (Edge/Chrome instalado; app rodando) |
| `npm run build` e `npm start` | Build de produção; a API pode servir o PWA (`SERVE_WEB_DIST=../web/dist`) |

## Onde configurar as chaves

Todas as chaves ficam **só** em `apps/api/.env` (servidor). O frontend nunca recebe chaves.

| Variável | Para quê |
|---|---|
| `MAP_PROVIDER=osrm \| valhalla \| google` | Motor de rotas/matriz |
| `GEOCODING_PROVIDERS=cartociudad,nominatim` | Cadeia de geocoders (a ordem define o fallback) |
| `GOOGLE_MAPS_API_KEY` | Necessária para `MAP_PROVIDER=google` ou geocoder `google` (ative Geocoding API e Routes API) |
| `AI_PROVIDER=anthropic \| openai \| none` | IA para etiquetas difíceis |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude (padrão `claude-opus-5-5`) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | OpenAI ou gateway compatível |
| `DATA_ENCRYPTION_KEY` | **Obrigatória em produção**: criptografa nome, telefone, complemento e notas |
| `DATABASE_URL` | Postgres de produção (vazio = PGlite local) |

No frontend (`apps/web/.env`) há apenas variáveis públicas: `VITE_MAP_STYLE_URL` e `VITE_API_URL`.

## Estrutura

```
apps/api/src
  providers/maps/     MapProvider (facade) + CartoCiudad, Nominatim, Google, OSRM, Valhalla
  providers/ai/       AiProvider: anthropic, openai, none
  optimization/       solver TSP/VRP: Held–Karp, branch & bound, ILS + 2-opt/Or-opt
  modules/routes/     rotas, entregas, planejamento, recálculo, eventos (offline idempotente)
  modules/recognition AddressRecognitionService: parser de etiquetas + IA + geocoding
  auth/, db/, services/retention.ts
apps/web/src
  pages/              Nova rota, Rota (plano/resumo), Escanear, Executar, Histórico, Estatísticas, Configurações
  components/         MapView (MapLibre), DeliveryEditor (editar → localizar → confirmar)
  lib/                api, offline (IndexedDB + fila), ocr (Tesseract.js no aparelho), device (GPS, deep links)
packages/shared       tipos, schemas Zod, códigos de erro com mensagens amigáveis, geo, formatação
```

## O que foi testado

* **Solver**: igual à força bruta (ótimo) em instâncias assimétricas, abertas e fechadas, com janelas
  e prioridades. ILS dentro de 1% do ótimo; 40 paradas em menos de 1 s.
* **API (integração, Postgres real em memória)**: cadastro/login, CSRF, validação, geocoding com
  correções, criação de rota, criptografia em repouso, otimização, início, eventos offline
  duplicados, entrega adicionada durante a rota, recálculo só do restante, falha com motivo,
  finalização, histórico, estatísticas, isolamento entre usuários, retenção e exclusão de dados.
* **Interface (E2E em Edge, celular 390×844)**: o fluxo completo da seção 38 da especificação,
  incluindo OCR real de uma etiqueta, uma entrega registrada offline e sincronizada, e o build de
  produção servido pela API com CSP.
* **Provedores reais**: CartoCiudad, Nominatim, OSRM e Valhalla foram chamados de verdade.
  **Google e IA não foram testados ao vivo** (não há chaves); o código segue a documentação
  oficial e só será exercitado quando as chaves forem configuradas.

## Limitações conhecidas

* **Sem trânsito em tempo real** com OSRM/Valhalla; o app avisa. Com `MAP_PROVIDER=google` o
  trânsito entra na matriz, mas a cobrança é por elemento (veja a estimativa no documento de arquitetura).
* **Servidores públicos** (OSRM demo, Nominatim, Valhalla FOSSGIS) servem apenas para desenvolvimento.
  Em produção, use um OSRM próprio com o extrato da Espanha.
* **GPS em segundo plano**: um PWA não acompanha a posição enquanto o Google Maps está em primeiro
  plano. Por isso a detecção de desvio funciona com o app aberto, e a "distância real" é estimada
  pelos trechos percorridos. Um build nativo (Capacitor) resolve isso.
* **Horários** são interpretados no fuso Europe/Madrid.
* **Multi-motorista** (VRP com vários veículos): o modelo de dados (organizações, papéis, veículos)
  já está preparado, mas a distribuição automática ainda não foi implementada.
