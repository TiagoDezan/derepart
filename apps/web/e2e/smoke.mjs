/**
 * End-to-end smoke test of the real UI (API + web running, seed applied):
 *   npm run seed && npm run dev   (in another terminal)
 *   node apps/web/e2e/smoke.mjs [screenshotDir]
 * Uses the installed Microsoft Edge (or Chrome with E2E_CHANNEL=chrome) via playwright-core.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? path.resolve('e2e-screenshots');
mkdirSync(OUT, { recursive: true });
let shot = 0;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'pt-BR',
  timezoneId: 'Europe/Madrid',
  geolocation: { latitude: 36.6223, longitude: -4.4999 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/tiles|Failed to load resource/.test(m.text()) && errors.push(m.text()));

const snap = async (name) => {
  const file = path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log('screenshot', path.basename(file));
};
const click = (name) => page.getByRole('button', { name, exact: typeof name === 'string' }).first().click();

try {
  // 1. login
  await page.goto(`${BASE}/entrar`);
  await page.getByLabel('E-mail').fill('demo@derepart.local');
  await page.getByLabel('Senha').fill('demo12345');
  await click('Entrar');
  await page.getByText('Nova rota').first().waitFor();
  await snap('home');

  // 2. open the seeded route
  await page.getByText('Continuar rota').click();
  await page.getByText(/Entregas \(\d+\)/).waitFor();
  await page.waitForTimeout(1500);
  await snap('route-draft');

  // 3. optimise
  await click(/Calcular melhor rota/);
  await page.getByText('🚚 Rota otimizada').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  await snap('route-optimized');
  await page.getByText(/Comparado à ordem original/).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await snap('route-optimized-summary');

  // 4. manual delivery
  await click('Manual');
  await page.getByLabel('Nome do destinatário').fill('Laura Sánchez');
  await page.getByLabel('Rua / endereço').fill('C/ Larios');
  await page.getByLabel('Número').fill('5');
  await page.getByLabel('Código postal').fill('29005');
  await page.getByLabel('Cidade').fill('Malaga');
  await click('Localizar endereço');
  await page.getByText('Endereço identificado').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await snap('manual-confirm');
  await click('Confirmar');
  await page.getByText(/mudaram depois do último cálculo/).waitFor();
  log('manual delivery added; plan marked stale');

  // 5. scan a label (real OCR on a generated label image)
  const label = await context.newPage();
  await label.setViewportSize({ width: 700, height: 420 });
  await label.setContent(`<body style="margin:0;background:#fff;font:600 30px/1.45 Arial;padding:36px;color:#000">
    <div style="font-size:20px;color:#333">DESTINATARIO:</div>
    <div>JUAN GARCIA LOPEZ</div><div>C/ San Migel 15, 2ºB</div><div>29620 Torremolino (Málaga)</div><div style="font-size:22px">Tel: 612 345 678</div></body>`);
  const labelPng = path.join(OUT, 'label.png');
  await label.screenshot({ path: labelPng });
  await label.close();
  await page.goto(page.url().replace(/\/?$/, '/escanear'));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Escolher foto|Tirar \/ escolher foto/ }).first().click();
  await (await chooser).setFiles(labelPng);
  log('label queued, waiting for OCR (downloads the Spanish model on first use)…');
  await page.getByText(/Toque para confirmar|Falhou/).first().waitFor({ timeout: 180_000 });
  await snap('scan-list');
  await page.getByText(/Toque para confirmar|Falhou/).first().click();
  await page.getByText(/Endereço identificado|Localizar endereço/).first().waitFor();
  await page.waitForTimeout(1500);
  await snap('scan-confirm');
  if (await page.getByRole('button', { name: 'Localizar endereço' }).isVisible()) {
    log('recognition needs manual review: locating typed address');
    await click('Localizar endereço');
    await page.getByText('Endereço identificado').waitFor({ timeout: 30_000 });
  }
  {
    await click('Confirmar');
    await page.getByText('Adicionada à rota').waitFor();
    log('scanned delivery added');
  }
  await click(/Concluir/);

  // 6. recalculate and start
  await click(/Recalcular rota/);
  await page.getByText('🚚 Rota otimizada').waitFor({ timeout: 60_000 });
  await click('INICIAR ROTA');
  await page.getByText(/ENTREGA 1 DE/).waitFor();
  await snap('run-first');

  // 7. delivered, then not delivered with reason
  await click('ENTREGUE');
  await page.getByText(/ENTREGA 2 DE/).waitFor();
  await click('NÃO ENTREGUE');
  await click('Cliente ausente');
  await page.getByLabel('Observação (opcional)').fill('Ninguém atendeu');
  await snap('run-fail-reason');
  await click('Registrar não entrega');
  await page.getByText(/ENTREGA 3 DE/).waitFor();

  // 8. offline delivery + sync
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await click('ENTREGUE');
  await page.getByText(/ENTREGA 4 DE/).waitFor();
  await page.getByText(/aguardando sincronização/).waitFor();
  await snap('run-offline');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText(/aguardando sincronização/).waitFor({ state: 'detached', timeout: 30_000 });
  log('offline event synced');

  // 9. add a delivery during the route and recalculate from GPS position
  await click('Nova entrega');
  await page.getByRole('link', { name: /Digitar endereço/ }).click();
  await page.getByLabel('Nome do destinatário').fill('Nova Encomenda');
  await page.getByLabel('Rua / endereço').fill('Calle Hilera');
  await page.getByLabel('Número').fill('8');
  await page.getByLabel('Código postal').fill('29007');
  await click('Localizar endereço');
  await page.getByText('Endereço identificado').waitFor({ timeout: 30_000 });
  await click('Confirmar');
  await page.getByText(/Há entregas novas/).waitFor();
  await snap('run-stale');
  await page.getByRole('button', { name: 'Recalcular' }).first().click();
  await page.getByText(/Há entregas novas/).waitFor({ state: 'detached', timeout: 60_000 });
  await snap('run-recalculated');
  await page.getByRole('button', { name: 'Mapa' }).click();
  await page.waitForTimeout(2500);
  await snap('run-map');
  await page.getByRole('button', { name: 'Lista' }).click();
  await snap('run-list');
  await page.getByRole('button', { name: 'Cartão' }).click();

  // 10. finish
  await click('ENTREGUE');
  await click('Finalizar rota');
  await page.getByText('Resumo da rota').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await snap('route-completed');

  // 11. history & stats & settings
  await page.goto(`${BASE}/historico`);
  await page.getByText('Histórico de rotas').waitFor();
  await page.waitForTimeout(500);
  await snap('history');
  await page.goto(`${BASE}/estatisticas`);
  await page.getByText('Entregas realizadas').waitFor();
  await snap('stats');
  await page.goto(`${BASE}/configuracoes`);
  await page.getByText('Veículo').first().waitFor();
  await snap('settings');
  await page.goto(`${BASE}/rotas/nova`);
  await click('Localização atual');
  await page.getByText('Partida').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2000);
  await snap('new-route-gps');

  if (errors.length) {
    console.log('\nBrowser errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else log('E2E OK — no browser errors');
} catch (err) {
  await snap('failure').catch(() => undefined);
  console.error('E2E FAILED:', err.message);
  if (errors.length) console.log('Browser errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
