import {
  expandStreetType,
  isSpanishPostalCode,
  nameSimilarity,
  provinceFromPostalCode,
  type AddressCorrection,
  type AddressIssue,
  type GeocodeCandidate,
  type GeocodeResponse,
} from '@derepart/shared';
import type { AddressQuery, RawCandidate } from './types';

const digits = (v: string | null | undefined) => (v ?? '').match(/\d+/)?.[0] ?? '';

/**
 * Compares what the user/OCR gave us with what a geocoder returned, field by field.
 * Never trust a geocoder blindly: CartoCiudad may return portal 10 for "15", or a street
 * in another province when the postal code is in the free text.
 */
export function scoreCandidate(q: AddressQuery, c: RawCandidate): GeocodeCandidate {
  let score = 1;
  const issues: AddressIssue[] = [];
  const corrections: AddressCorrection[] = [];

  if (q.street) {
    const sim = nameSimilarity(q.street, c.street, true);
    if (!c.street || sim < 0.55) {
      score -= 0.45;
      issues.push('street_mismatch');
    } else if (sim < 0.999) {
      score -= (1 - sim) * 0.3;
      corrections.push({ field: 'street', from: q.street, to: c.street });
    }
  }

  if (q.number && digits(q.number)) {
    if (!c.number) {
      score -= 0.15;
      issues.push('number_missing');
    } else if (digits(c.number) !== digits(q.number)) {
      score -= 0.3;
      issues.push('number_mismatch');
      corrections.push({ field: 'number', from: q.number, to: c.number });
    }
  }

  const spanish = (q.country || 'ES').toUpperCase() === 'ES';
  let postalMatches = false;
  if (q.postalCode) {
    if (spanish && !isSpanishPostalCode(q.postalCode)) {
      score -= 0.05;
      issues.push('postal_code_invalid');
    } else if (c.postalCode && c.postalCode !== q.postalCode) {
      const sameProvince = spanish
        ? (c.provinceCode ?? provinceFromPostalCode(c.postalCode)?.code) === provinceFromPostalCode(q.postalCode)?.code
        : true;
      if (sameProvince) {
        score -= 0.12;
        issues.push('postal_code_mismatch');
        corrections.push({ field: 'postalCode', from: q.postalCode, to: c.postalCode });
      } else {
        score -= 0.5;
        issues.push('province_mismatch');
      }
    } else if (c.postalCode === q.postalCode) {
      postalMatches = true;
    }
  }

  if (q.city && c.city) {
    const sim = nameSimilarity(q.city, c.city);
    if (sim < 0.6) {
      // A label city may be a district of the municipality (e.g. Churriana → Málaga):
      // when the postal code agrees we only note the correction.
      if (postalMatches) score -= 0.05;
      else {
        score -= 0.3;
        issues.push('city_mismatch');
      }
      corrections.push({ field: 'city', from: q.city, to: c.city });
    } else if (sim < 0.999) {
      corrections.push({ field: 'city', from: q.city, to: c.city });
    }
  }

  if (q.street) {
    if (c.precision === 'street' && q.number) {
      score -= 0.1;
      if (!issues.includes('number_missing')) issues.push('low_precision');
    } else if (c.precision === 'locality') {
      score -= 0.35;
      issues.push('low_precision');
    } else if (c.precision === 'approximate') {
      score -= 0.5;
      issues.push('low_precision');
    }
  } else {
    // free-text search (start point): rank by precision only
    score = { rooftop: 0.95, street: 0.85, locality: 0.7, approximate: 0.5 }[c.precision];
  }

  return { ...stripInternal(c), score: Math.max(0, Math.min(1, Math.round(score * 1000) / 1000)), issues, corrections };
}

function stripInternal(c: RawCandidate): Omit<GeocodeCandidate, 'score' | 'issues' | 'corrections'> {
  const { provinceCode: _ignored, ...rest } = c;
  return rest;
}

const ISSUE_MESSAGES: Record<AddressIssue, (q: AddressQuery, c: GeocodeCandidate) => string> = {
  number_mismatch: (q, c) => `O número ${q.number} não foi encontrado; o ponto mais próximo é o nº ${c.number}. Confira no mapa.`,
  number_missing: (q) => `Não encontramos o número ${q.number}; o ponto marca a rua. Ajuste no mapa se necessário.`,
  postal_code_mismatch: (q, c) => `O código postal informado (${q.postalCode}) difere do encontrado (${c.postalCode}).`,
  postal_code_invalid: () => 'O código postal parece inválido (na Espanha são 5 dígitos, ex.: 29620).',
  province_mismatch: () => 'O endereço encontrado fica em outra província. Verifique o código postal e a cidade.',
  city_mismatch: (q, c) => `A cidade "${q.city}" não confere com "${c.city}".`,
  street_mismatch: () => 'O nome da rua encontrado é bem diferente do informado.',
  low_precision: () => 'Localização aproximada: confirme o ponto no mapa.',
};

/** Decides ok / needs_review / ambiguous / not_found and explains why, in plain language. */
export function classify(q: AddressQuery, candidates: GeocodeCandidate[]): GeocodeResponse {
  const sorted = dedupe([...candidates].sort((a, b) => b.score - a.score));
  const best = sorted[0];
  if (!best || best.score < 0.4) {
    return {
      status: 'not_found',
      best: null,
      candidates: sorted.slice(0, 5),
      messages: ['Não conseguimos localizar este endereço. Verifique o número e o código postal.'],
    };
  }
  const messages = best.issues.map((i) => ISSUE_MESSAGES[i](q, best));
  const rivals = sorted.filter(
    (c) => c !== best && best.score - c.score < 0.06 && distanceDeg(c, best) > 0.002 && c.city !== best.city,
  );
  if (rivals.length > 0) {
    return {
      status: 'ambiguous',
      best,
      candidates: sorted.slice(0, 5),
      messages: ['Encontramos mais de um endereço possível. Escolha o correto.', ...messages],
    };
  }
  const material = best.issues.length > 0 || best.score < 0.85;
  const corrected = best.corrections.filter((c) => c.field !== 'number');
  if (!material && corrected.length) {
    messages.push('Corrigimos alguns dados do endereço. Confira antes de confirmar.');
  }
  return { status: material ? 'needs_review' : 'ok', best, candidates: sorted.slice(0, 5), messages };
}

function distanceDeg(a: GeocodeCandidate, b: GeocodeCandidate) {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng);
}

function dedupe(cands: GeocodeCandidate[]): GeocodeCandidate[] {
  const out: GeocodeCandidate[] = [];
  for (const c of cands) {
    if (!out.some((o) => distanceDeg(o, c) < 0.00015 && o.number === c.number)) out.push(c);
  }
  return out;
}

export function normalizeQuery(q: AddressQuery): AddressQuery {
  const country = (q.country || 'ES').toUpperCase();
  const postalCode = q.postalCode?.replace(/\s+/g, '') || null;
  return {
    ...q,
    country,
    street: q.street ? expandStreetType(q.street) : null,
    number: q.number?.trim() || null,
    postalCode,
    city: q.city?.trim() || null,
    province: q.province?.trim() || (country === 'ES' ? (provinceFromPostalCode(postalCode)?.name ?? null) : null),
  };
}
