import { expandStreetType, provinceFromPostalCode, SPANISH_PROVINCES, titleCase, type ParsedLabel } from '@derepart/shared';

/**
 * Rule-based parser for Spanish shipping labels (OCR text). Handles:
 *  - street type abbreviations (C/, Avda., Pza., Pº, Ctra.…)
 *  - number glued to / separated from the street ("C/San Miguel,15", "nº 15", "s/n")
 *  - floor/door complements ("2ºB", "3º izq", "bajo", "esc. 2", "puerta 4")
 *  - postal code with OCR confusions (O→0, l/I→1, S→5, B→8) and city on the same line
 *  - sender block ("Remitente") vs. recipient block ("Destinatario")
 */

export interface LabelParseResult {
  fields: ParsedLabel;
  /** 0–1: completeness and plausibility of the extracted fields. */
  confidence: number;
  missing: (keyof ParsedLabel)[];
}

const STREET_PREFIX =
  /^(c\/|c\.|cl\.?\s|calle|avda\.?|avd\.?|av\.?\s|avenida|pza\.?|plaza|p[ºo°]\.?\s|pso\.?|paseo|ctra\.?|carretera|camino|cmno\.?|urb\.?|urbanizaci[oó]n|ronda|rda\.?|traves[ií]a|trav\.?|glorieta|pasaje|pje\.?|bulevar|pol[ií]gono|pol\.?\s|callej[oó]n|carrer|rúa|rua)/i;
const RECIPIENT_MARKERS = /^(destinatario|destinat\.|entregar a|para|ship to|deliver to|consignee|a la atenci[oó]n de|att?n?\.?)\s*[:\-]?\s*/i;
const SENDER_MARKERS = /^(remitente|remite|from|sender|exp\.?|expedidor|devolver a|return to)\b/i;
const NOISE_LINE = /^(tel[eé]?f?o?n?o?|tlf|m[oó]vil|phone|email|e-mail|ref|referencia|pedido|order|tracking|n[ºo°]\s*env[ií]o|peso|weight|bultos|fecha|date)\b/i;
const PHONE = /(?:\+?34[\s.-]?)?(?:[6789]\d{2})[\s.-]?\d{3}[\s.-]?\d{3}\b/;
const COMPLEMENT =
  /\b((?:\d{1,2}\s?[ºª°o]\s?[a-z]?\b)(?:\s?(?:izq(?:da)?|dcha|der(?:echa)?|izquierda|centro)\.?)?|bajo\s?[a-z]?|[aá]tico|entreplanta|entresuelo|esc(?:alera)?\.?\s?\w+|puerta\s?\w+|pta\.?\s?\w+|piso\s?\w+|portal\s?\w+|bloque\s?\w+|blq\.?\s?\w+|local\s?\w+|casa\s?\w+)/gi;

/** Fixes OCR letter/digit confusions inside a token that should be numeric. */
export function fixDigits(token: string): string {
  return token.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[S]/g, '5').replace(/[B]/g, '8').replace(/[Z]/g, '2');
}

function cleanLine(line: string): string {
  return line
    // OCR often reads the ordinal sign of "2ºB" as %, °, * or "*%" (seen with Tesseract)
    .replace(/(\d)\s?[%°*º]{1,2}(?=\s?[A-Za-z]?\b)/g, '$1º')
    .replace(/[|_~^*"“”«»<>{}\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function findPostalCode(line: string): { code: string; index: number; length: number } | null {
  // Candidates: 5-char tokens mixing digits and confusable letters, with ≥ 3 real digits.
  const re = /(?<![\w])([0-9OoIlSBZ]{5})(?![\w])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const raw = m[1];
    if ((raw.match(/\d/g) ?? []).length < 3) continue;
    const code = fixDigits(raw);
    if (provinceFromPostalCode(code)) return { code, index: m.index, length: raw.length };
  }
  return null;
}

function looksLikeName(line: string): boolean {
  if (/\d/.test(line)) return false;
  if (STREET_PREFIX.test(line) || NOISE_LINE.test(line) || SENDER_MARKERS.test(line)) return false;
  const words = line.split(' ').filter(Boolean);
  return words.length >= 1 && words.length <= 6 && line.length >= 3 && /^[\p{L}\s.'-]+$/u.test(line);
}

function splitStreetNumber(line: string): { street: string; number: string | null; complement: string | null } {
  let rest = line.replace(/\s*,\s*/g, ', ');
  const complements: string[] = [];
  rest = rest.replace(COMPLEMENT, (c) => {
    complements.push(c.trim());
    return ' ';
  });
  let number: string | null = null;
  const sn = /\b(s\/n|sin n[uú]mero)\b/i.exec(rest);
  if (sn) {
    number = 's/n';
    rest = rest.replace(sn[0], ' ');
  } else {
    // "nº 15", "num. 15", ", 15", " 15", "15-17", "km 3,5" — first number after the street name
    const re = /(?:,|\s)\s*(?:n[ºo°.]?|num\.?|número|no\.?)?\s*(\d{1,4}(?:\s?[-/]\s?\d{1,4})?(?:\s?[a-zA-Z](?![a-zA-Z]))?)(?=\s|,|$)/i;
    const m = re.exec(rest);
    if (m) {
      number = m[1].replace(/\s+/g, '');
      rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    }
  }
  const street = expandStreetType(
    rest
      .replace(/\s*,\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[,.\-\s]+$/, '')
      .trim(),
  );
  return { street, number, complement: complements.length ? complements.join(' ').replace(/\s+/g, ' ') : null };
}

export function parseLabel(text: string): LabelParseResult {
  let lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length > 1);

  // Keep only the recipient block when the label also contains the sender.
  const recipientIdx = lines.findIndex((l) => RECIPIENT_MARKERS.test(l));
  const senderIdx = lines.findIndex((l) => SENDER_MARKERS.test(l));
  if (recipientIdx >= 0) {
    const end = senderIdx > recipientIdx ? senderIdx : lines.length;
    const first = lines[recipientIdx].replace(RECIPIENT_MARKERS, '');
    lines = [first, ...lines.slice(recipientIdx + 1, end)].filter((l) => l.length > 1);
  } else if (senderIdx >= 0) {
    // sender block first, recipient after a gap: drop the sender lines (up to 4)
    const next = lines.findIndex((l, i) => i > senderIdx + 1 && (looksLikeName(l) || RECIPIENT_MARKERS.test(l)));
    if (next > 0 && next - senderIdx <= 5) lines = lines.slice(next);
  }

  const fields: ParsedLabel = {
    recipientName: null,
    phone: null,
    street: null,
    number: null,
    complement: null,
    postalCode: null,
    city: null,
    province: null,
    country: 'ES',
    notes: null,
  };

  // phone (anywhere)
  for (const l of lines) {
    const m = PHONE.exec(l);
    if (m && !findPostalCode(m[0])) {
      fields.phone = m[0].replace(/[\s.-]/g, '');
      break;
    }
  }

  // postal code + city
  let cpLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const pc = findPostalCode(lines[i]);
    if (!pc) continue;
    fields.postalCode = pc.code;
    cpLine = i;
    const after = lines[i]
      .slice(pc.index + pc.length)
      .replace(/^[\s,.\-]+/, '')
      .trim();
    const before = lines[i].slice(0, pc.index).replace(/[\s,.\-]+$/, '').trim();
    const cityRaw = after || (before && !STREET_PREFIX.test(before) ? before : '');
    if (cityRaw) {
      const prov = /\(([^)]+)\)|[,-]\s*([^,]+)$/.exec(cityRaw);
      let city = cityRaw.replace(/\([^)]*\)/, '').trim();
      if (prov && city.includes(',')) city = city.split(',')[0].trim();
      fields.city = titleCase(city.replace(/[,.\s]+$/, ''));
      const provName = (prov?.[1] ?? '').trim();
      if (provName) fields.province = titleCase(provName);
    }
    // street on the same line before the code (single-line labels)
    if (before && STREET_PREFIX.test(before)) {
      Object.assign(fields, splitStreetNumber(before));
    }
    break;
  }
  if (!fields.province && fields.postalCode) fields.province = provinceFromPostalCode(fields.postalCode)?.name ?? null;
  if (!fields.city && cpLine >= 0 && lines[cpLine + 1] && looksLikeName(lines[cpLine + 1])) {
    fields.city = titleCase(lines[cpLine + 1]);
  }

  // street line: prefer a line with a street type; else a line with letters + number before the CP line
  let streetIdx = -1;
  if (!fields.street) {
    streetIdx = lines.findIndex((l, i) => i !== cpLine && STREET_PREFIX.test(l));
    if (streetIdx < 0) {
      const limit = cpLine >= 0 ? cpLine : lines.length;
      for (let i = 0; i < limit; i++) {
        if (/\p{L}{3,}.*\d/u.test(lines[i]) && !NOISE_LINE.test(lines[i]) && !PHONE.test(lines[i])) {
          streetIdx = i;
          break;
        }
      }
    }
    if (streetIdx >= 0) {
      Object.assign(fields, splitStreetNumber(lines[streetIdx]));
      // complement often on the next line ("2º B", "Bajo A")
      const nxt = lines[streetIdx + 1];
      if (!fields.complement && nxt && streetIdx + 1 !== cpLine && new RegExp(`^${COMPLEMENT.source}$`, 'i').test(nxt)) {
        fields.complement = nxt;
      }
    }
  }

  // recipient: the closest name-like line above the street
  const nameSearchEnd = streetIdx >= 0 ? streetIdx : cpLine >= 0 ? cpLine : lines.length;
  for (let i = nameSearchEnd - 1; i >= 0; i--) {
    if (looksLikeName(lines[i]) && !Object.values(SPANISH_PROVINCES).includes(lines[i])) {
      fields.recipientName = titleCase(lines[i]);
      break;
    }
  }

  const missing = (['street', 'number', 'postalCode', 'city', 'recipientName'] as const).filter((k) => !fields[k]);
  let confidence = 0;
  if (fields.street && fields.street.length >= 4) confidence += 0.3;
  if (fields.number) confidence += 0.15;
  if (fields.postalCode) confidence += 0.25;
  if (fields.city) confidence += 0.15;
  if (fields.recipientName) confidence += 0.1;
  if (fields.street && /\p{L}{3,}/u.test(fields.street.replace(/^\p{L}+\s/u, ''))) confidence += 0.05;
  return { fields, confidence: Math.min(1, confidence), missing: [...missing] };
}
