import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors';
import { GeminiAiProvider } from './gemini';

const label = {
  recipientName: 'Juan García',
  phone: null,
  street: 'Calle San Miguel',
  number: '15',
  complement: '2ºB',
  postalCode: '29620',
  city: 'Torremolinos',
  province: 'Málaga',
  country: 'es',
  notes: null,
  confidence: 0.92,
};

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const provider = () => new GeminiAiProvider('test-key', 'gemini-3.8-flash', 'https://generativelanguage.googleapis.com/v1beta', 5000);

afterEach(() => vi.unstubAllGlobals());

describe('GeminiAiProvider', () => {
  it('sends a structured-output generateContent request and parses the JSON answer', async () => {
    const fetch = mockFetch(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(label) }] }, finishReason: 'STOP' }] });
    const res = await provider().interpretText('C/ San Migel 15, 2ºB\n29620 Torremolino');

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema.required).toContain('postalCode');
    expect(body.system_instruction.parts[0].text).toMatch(/RECIPIENT/);
    expect(body.contents[0].parts[0].text).toContain('San Migel');

    expect(res.fields).toMatchObject({ street: 'Calle San Miguel', number: '15', postalCode: '29620', country: 'ES' });
    expect(res.confidence).toBeCloseTo(0.92);
  });

  it('sends the photo as inline_data', async () => {
    const fetch = mockFetch(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(label) }] } }] });
    await provider().interpretImage('QUJD', 'image/jpeg', 'ocr text');
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.contents[0].parts[0]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } });
  });

  it('maps an invalid key to AI_NOT_CONFIGURED', async () => {
    mockFetch(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    await expect(provider().interpretText('x'.repeat(10))).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });

  it('maps quota errors and blocked prompts to friendly codes', async () => {
    mockFetch(429, { error: { status: 'RESOURCE_EXHAUSTED' } });
    await expect(provider().interpretText('x'.repeat(10))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    mockFetch(200, { promptFeedback: { blockReason: 'SAFETY' } });
    const err = await provider().interpretText('x'.repeat(10)).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('AI_FAILED');
  });
});
