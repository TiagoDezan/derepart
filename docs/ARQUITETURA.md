# Derepart — Arquitetura e decisões técnicas

> Documento vivo. Preços e limites de terceiros são valores de referência
> (out/2026) — confirme sempre na página oficial antes de contratar.

## 1. Resumo das decisões

| Área | Escolha inicial | Alternativa já suportada |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind, PWA (Workbox) | Empacotar com Capacitor para Android/iOS |
| Mapa (visual) | MapLibre GL + tiles vetoriais OpenFreeMap (grátis, sem chave) | Qualquer estilo MapLibre (MapTiler, Stadia, Protomaps) via `VITE_MAP_STYLE_URL` |
| Backend | Node 22 + Fastify 5 + TypeScript | — |
| Banco | PostgreSQL via Drizzle ORM. Em desenvolvimento: **PGlite** (Postgres real em WASM, sem Docker) | Qualquer Postgres (Neon, Supabase, RDS…) via `DATABASE_URL` |
| Autenticação | **Supabase Auth** (JWT ES256 validado pelas chaves públicas/JWKS do projeto) | Login próprio: e-mail + senha (scrypt) e sessão em cookie httpOnly (`AUTH_PROVIDER=local`) |
| Geocoding | **CartoCiudad (IGN, oficial Espanha)** → fallback Nominatim (OSM) | Google Geocoding (`GEOCODING_PROVIDERS=google`) |
| Matriz / rotas | **OSRM** | Valhalla (preferências de vias) e Google Routes API (trânsito) |
| Otimização | Solver próprio no backend (exato para poucas paradas, ILS + 2-opt/Or-opt para muitas) | Ponto de extensão para OR-Tools / VRP multi-veículo |
| OCR | Tesseract.js **no aparelho** (imagem não sai do celular) | — |
| IA | Opcional, só quando a confiança é baixa: texto primeiro, imagem só com consentimento | `AI_PROVIDER=anthropic`, `openai` ou `gemini` |
| Navegação | Deep links (Google Maps, Waze, Apple Maps, `geo:`) | — |
| Offline | IndexedDB + fila de eventos idempotentes + Service Worker | — |

## 2. Por que esta stack

* **React + Vite + Tailwind** (como você preferiu) é adequado: build rápido, PWA madura
  (`vite-plugin-pwa`), e o mesmo código pode virar app nativo com **Capacitor**, que dá
  acesso a GPS em segundo plano e câmera nativa, coisas que um PWA não consegue no iOS.
* **Backend próprio (Fastify)** em vez de "tudo no Supabase": as chaves de mapas/IA precisam
  ficar no servidor, a otimização é CPU-intensiva e a lógica de negócio (planejamento,
  recálculo, eventos) fica num lugar só. O frontend apenas exibe e envia intenções.
* **Postgres + Drizzle**: SQL real, migrações versionadas e fácil de hospedar em qualquer
  lugar (inclusive no Postgres do Supabase). O **PGlite** permite rodar e testar tudo
  localmente sem Docker, que não está instalado nesta máquina.
* **Monorepo npm workspaces**: `packages/shared` contém tipos, schemas Zod e utilitários
  usados pelos dois lados, o que evita duplicar código e validações.

```
derepart/
├── apps/
│   ├── api/       Fastify, providers, solver, banco
│   └── web/       React PWA
├── packages/
│   └── shared/    schemas Zod, tipos, códigos de erro, geo utils
└── docs/
```

## 3. Comparação de provedores de mapas (foco: Espanha)

### 3.1 Testes reais feitos durante a análise

| Teste | Resultado |
|---|---|
| CartoCiudad: `calle san miguel 15, torremolinos` | Encontrou o **portal 15** exato, CP 29620, ref. catastral |
| CartoCiudad: `C/ San Migel 15, 29620 Torremolino` (erro de OCR) | Corrigiu rua e cidade, **mas devolveu o portal 10** — é preciso validar o número |
| CartoCiudad: `calle larios 5 29005` (sem cidade) | Foi para **Valência** — CP no texto confunde; filtrar por província resolve |
| Nominatim: `Calle San Miguel 15, Torremolinos` | Encontrou o número 15 (via um POI) |
| OSRM (demo) Torremolinos→Málaga | 18,2 km / 20 min; matriz `table` OK |
| Valhalla (FOSSGIS) matriz com `exclude_unpaved` e `use_highways` | OK |

Conclusão prática: **nenhum geocoder deve ser aceito cegamente**. O sistema cruza CP,
província (2 primeiros dígitos do CP), município e número do portal antes de confiar
no resultado, e pede confirmação quando algo diverge.

### 3.2 Tabela comparativa

| Critério | Google Maps Platform | OSM + OSRM | OSM + Valhalla | OSM + GraphHopper |
|---|---|---|---|---|
| **Geocoding na Espanha** | Excelente (portal, tolerante a erros) | Usar CartoCiudad (oficial, nível portal, grátis) + Nominatim | idem | idem (hospedado tem geocoder próprio) |
| **Qualidade das rotas** | Excelente | Muito boa (rede OSM na Espanha é muito completa) | Muito boa | Muito boa |
| **Trânsito** | Sim, em tempo real e histórico (SKU Pro) | Não (velocidades estimadas por tipo de via) | Não (só históricos se você fornecer) | Não no open source; parcial no hospedado |
| **Preferências de via** | Evitar pedágio/autoestrada/balsa | Só via perfil (recompilar) | **Sim, em tempo de consulta**: `use_highways`, `exclude_unpaved`, `use_tracks`, `use_living_roads` | Sim: *custom models* |
| **Matriz** | Até 625 elementos/requisição; **pago por elemento** | Ilimitada se auto-hospedado; muito rápida | Boa; mais lenta que OSRM | Boa |
| **Otimização multi-paradas** | Route Optimization API (cara) ou `optimizeWaypointOrder` (≤25, só tempo) | `trip` (TSP simples) | `optimized_route` (TSP simples) | API de VRP com janelas (hospedado, pago) |
| **Custo** | Free cap mensal por SKU (Essentials ≈10 mil, Pro ≈5 mil). Depois ≈ US$5/mil geocodings, ≈ US$5–10/mil **elementos** de matriz | Grátis (software). Servidor próprio ≈ €10–25/mês para a Espanha | Grátis; servidor ≈ €15–30/mês | Open source grátis; hospedado a partir de dezenas de €/mês |
| **Limites públicos** | Por quota/cobrança | Servidor demo: sem SLA, uso leve, só desenvolvimento | Servidor FOSSGIS: uso leve | Plano free: créditos diários |
| **Uso comercial** | Sim, mas os **Termos exigem exibir conteúdo Google num mapa Google** e limitam cache (coordenadas ≤30 dias) | Sim (ODbL, com atribuição); demo público **não** é para produção | Sim (auto-hospedado) | Sim |
| **Facilidade** | Alta | Alta (HTTP simples) | Alta | Média |
| **Escalabilidade** | Infinita, mas o custo cresce linearmente | Excelente (milhares de matrizes/s por servidor) | Boa | Boa |
| **Navegação curva a curva** | Deep link grátis para o app Google Maps | Usa deep link do Google Maps/Waze (grátis, sem chave) | idem | idem |

### 3.3 Exemplo de custo (1 entregador, 22 dias/mês, 30 entregas/dia, 2 recálculos/dia)

* Matriz inicial: 31×31 = 961 elementos; recálculos ≈ 2×(20×20) = 800 → ≈ 1.760 elementos/dia
  ≈ **38.700 elementos/mês**.
* Google, matriz sem trânsito: (38.700 − 10.000) × US$5/1000 ≈ **US$145/mês**.
  Com trânsito (Pro): (38.700 − 5.000) × US$10/1000 ≈ **US$340/mês**. Isso é só para um motorista.
* OSRM auto-hospedado: **custo fixo** do servidor (≈ €10–25/mês), independente do volume.
* Geocoding: 660 endereços/mês, o que cabe no free cap do Google e é grátis no CartoCiudad.

### 3.4 Recomendação

**Arquitetura híbrida com provedores trocáveis por variável de ambiente:**

1. **Geocoding**: CartoCiudad (dados oficiais do Catastro/IGN, nível de portal, grátis,
   CC-BY 4.0) como primário, Nominatim como fallback, Google opcional.
2. **Matriz + rotas**: OSRM. Em desenvolvimento, o servidor demo; em produção,
   um **OSRM próprio com o extrato da Espanha** (Geofabrik). A ordem das paradas depende
   dos *custos relativos* entre os pontos, e esses custos são bem capturados mesmo sem trânsito.
3. **Valhalla** quando você quiser que as preferências "evitar vias não pavimentadas e
   caminhos" sejam aplicadas na própria consulta (`MAP_PROVIDER=valhalla`).
4. **Google Routes** como upgrade (`MAP_PROVIDER=google`) quando o trânsito em tempo real
   justificar o custo, por exemplo no centro de Málaga em horário de pico.
5. **Otimização sempre no nosso backend**, sobre a matriz de qualquer provedor. Assim
   prioridades, janelas de horário, perfis e pesos ficam sob nosso controle e não
   dependem do fornecedor.

Assim, a qualidade da ordenação fica praticamente igual à do Google. A diferença está na
precisão do ETA em horário de pico (sem trânsito, o ETA tende a ser otimista), e o app
deixa isso explícito.

## 4. Otimização da rota

### 4.1 Função objetivo (multi-critério)

Para cada perfil existe um conjunto de pesos (`packages/shared/src/optimization.ts`),
preparado para ficar configurável no futuro:

```
custo(arco i→j) = wTempo · tempo_ij / tempo_médio + wDist · dist_ij / dist_média
custo(rota)     = Σ custo(arcos)
                + penalidade_atraso · minutos fora da janela de horário
                + peso_prioridade · horário de chegada (alta/urgente chegam antes)
```

| Perfil | wTempo | wDist | Simplicidade |
|---|---|---|---|
| ⚡ Mais rápido | 1,0 | 0,05 | não |
| ⛽ Mais econômico | 0,15 | 1,0 | não |
| 🛣 Equilibrado | 0,6 | 0,4 | sim |

**Combustível, com honestidade**: com consumo médio fixo (L/100 km) informado pelo usuário,
o combustível é proporcional à distância. Por isso o perfil econômico minimiza a distância.
O app mostra litros e € como **estimativa** (≈) e nunca com precisão maior que a do dado.

**Simplicidade / "familiaridade"**: o sistema **não sabe** quais vias você conhece. Ele usa
critérios objetivos:

* No Valhalla, opções de consulta: evitar não pavimentadas, trilhas e vias residenciais
  de passagem; preferir vias principais.
* Para qualquer provedor: o solver gera as K melhores sequências distintas. Para cada uma
  o backend pede a rota detalhada e mede **manobras, trocas de via e manobras/km**. No modo
  equilibrado, escolhe a mais simples entre as que custam no máximo +3% (ou +3 min) da melhor.
  Isso implementa a regra "não aceitar rota que economiza poucos minutos e complica muito".

### 4.2 Algoritmos por tamanho

| Paradas | Método |
|---|---|
| ≤ 9 com janelas/prioridades | Busca exaustiva (ótimo garantido) |
| ≤ 12 sem restrições | Held–Karp, programação dinâmica (ótimo garantido) |
| maiores | Multi-start (inserção mais barata + aleatorizada) → busca local (2-opt assimétrico, Or-opt 1–3, swap) → **Iterated Local Search** com perturbação *double-bridge*, com orçamento de tempo (~1,5 s) |

O solver trabalha com matrizes **assimétricas** (ida ≠ volta, por causa de sentido único) e
avalia cada movimento com a função objetivo completa, incluindo janelas e prioridades.

**Comparação**: o custo da "ordem original" (ordem de inserção) é calculado com a mesma
matriz. A economia mostrada compara duas sequências medidas pelo mesmo motor. Para as estatísticas,
a economia fica **fixa no último cálculo antes de iniciar a rota**. Recálculos durante a rota não
a aumentam, porque comparar o restante com uma nova "ordem original" inflaria o número.

**Janelas de horário já encerradas** (ex.: a rota começa às 17h e a janela era 14h–16h) geram
apenas um aviso e destaque em vermelho. Elas não reordenam a rota, porque a penalidade de atraso
puxaria a parada para o início sem nenhum benefício.

### 4.3 Evolução para VRP multi-motorista

O modelo já tem `organizations → memberships (motoristas) → vehicles → routes → deliveries`.
Um futuro `dispatch` recebe N entregas e M veículos, faz *clustering* + inserção
(ou OR-Tools num microserviço) e gera M `routes`. O solver atual é a etapa "TSP por veículo".

## 5. OCR / IA

```
Foto ─► pré-processamento (redução, tons de cinza, contraste) ─► Tesseract.js (no aparelho)
     ─► parser de endereços espanhóis (abreviações C/, Avda., Pza.; CP; nº; piso/porta)
     ─► confiança alta?  sim ─► geocoding + validação cruzada ─► confirmação do usuário
                         não ─► IA com o TEXTO do OCR (sem imagem)
                                └─ ainda ruim? ─► IA com a IMAGEM, só com consentimento
```

* `AddressRecognitionService` (backend) concentra o parse, a decisão de usar IA e a correção.
* `AiProvider` é uma interface implementada por `anthropic`, `openai`, `gemini` e `none`.
* A imagem nunca é gravada no servidor: trafega em memória e é descartada.

## 6. Navegação (Android/iOS)

* **Google Maps**: `https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&travelmode=driving&dir_action=navigate`.
  É URL universal: abre o app no Android e no iOS (se instalado), senão abre a web. Não precisa de chave.
* **Waze**: `https://waze.com/ul?ll=LAT,LNG&navigate=yes`
* **Apple Maps**: `https://maps.apple.com/?daddr=LAT,LNG&dirflg=d`
* **Android "escolher app"**: `geo:LAT,LNG?q=LAT,LNG(Rótulo)`

O app usa as coordenadas que você confirmou (mais precisas que reenviar o texto).

**Limitação do PWA**: com o Google Maps em primeiro plano, o navegador pausa o GPS do PWA.
Por isso a detecção de desvio funciona quando o app está aberto. Com Capacitor (fase futura),
dá para ter GPS em segundo plano.

## 7. Segurança e privacidade

* As chaves secretas ficam apenas em `apps/api/.env`. O frontend conhece só valores públicos: o
  estilo do mapa e a URL e a publishable key do Supabase.
* **Supabase Auth** (padrão quando `SUPABASE_URL` está definido): o app faz login direto no Supabase
  e envia o access token como `Bearer`. A API valida assinatura (ES256), emissor, audiência e
  validade com o JWKS público do projeto, sem segredo. No primeiro acesso cria o perfil e o workspace
  com o mesmo ID do `auth.users`. Excluir a conta apaga também o usuário do Supabase Auth.
* Login próprio (`AUTH_PROVIDER=local`): senhas com `scrypt`, sessão como token aleatório guardado
  como **hash** e cookie `httpOnly; SameSite=Lax; Secure` em produção, com proteção CSRF.
* Toda consulta é filtrada pelo `org_id`/`user_id` da sessão (camada de repositório). Testes
  automatizados verificam que um usuário não acessa dados de outro.
* O nome do destinatário, o complemento e as observações são **criptografados (AES-256-GCM)**
  no banco com `DATA_ENCRYPTION_KEY`.
* Validação Zod em todas as entradas; rate limiting global e mais restrito em
  login/geocoding/OCR/IA; `helmet`.
* **Retenção configurável**: após N dias, os dados pessoais das entregas são apagados e só
  ficam os números agregados (para as estatísticas). Também é possível apagar uma rota,
  todo o histórico ou a conta.
* A localização não é armazenada continuamente. O GPS só é usado em memória para desvio e
  recálculo; o servidor recebe a posição apenas quando você pede para recalcular.

## 8. Offline

* O Service Worker faz cache do app, das fontes, do OCR e dos tiles já vistos.
* A rota ativa (entregas, geometria, sequência) fica espelhada no IndexedDB.
* Marcar uma entrega como entregue/não entregue gera um **evento com UUID do cliente**,
  que é aplicado localmente na hora e enviado ao servidor quando houver conexão. O servidor
  ignora duplicados (idempotência).
* Geocoding, OCR com IA e recálculo exigem internet; o app avisa claramente.
