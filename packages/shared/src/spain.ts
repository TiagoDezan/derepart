import { SPANISH_POSTAL_CODE } from './schemas';

/**
 * Spanish provinces indexed by the two first digits of the postal code (= INE code).
 * Names follow CartoCiudad spelling, which is what its `provincia_filter` expects.
 */
export const SPANISH_PROVINCES: Record<string, string> = {
  '01': 'Araba/Álava',
  '02': 'Albacete',
  '03': 'Alacant/Alicante',
  '04': 'Almería',
  '05': 'Ávila',
  '06': 'Badajoz',
  '07': 'Illes Balears',
  '08': 'Barcelona',
  '09': 'Burgos',
  '10': 'Cáceres',
  '11': 'Cádiz',
  '12': 'Castelló/Castellón',
  '13': 'Ciudad Real',
  '14': 'Córdoba',
  '15': 'A Coruña',
  '16': 'Cuenca',
  '17': 'Girona',
  '18': 'Granada',
  '19': 'Guadalajara',
  '20': 'Gipuzkoa',
  '21': 'Huelva',
  '22': 'Huesca',
  '23': 'Jaén',
  '24': 'León',
  '25': 'Lleida',
  '26': 'La Rioja',
  '27': 'Lugo',
  '28': 'Madrid',
  '29': 'Málaga',
  '30': 'Murcia',
  '31': 'Navarra',
  '32': 'Ourense',
  '33': 'Asturias',
  '34': 'Palencia',
  '35': 'Las Palmas',
  '36': 'Pontevedra',
  '37': 'Salamanca',
  '38': 'Santa Cruz de Tenerife',
  '39': 'Cantabria',
  '40': 'Segovia',
  '41': 'Sevilla',
  '42': 'Soria',
  '43': 'Tarragona',
  '44': 'Teruel',
  '45': 'Toledo',
  '46': 'València/Valencia',
  '47': 'Valladolid',
  '48': 'Bizkaia',
  '49': 'Zamora',
  '50': 'Zaragoza',
  '51': 'Ceuta',
  '52': 'Melilla',
};

export function isSpanishPostalCode(value: string | null | undefined): value is string {
  return !!value && SPANISH_POSTAL_CODE.test(value);
}

export function provinceFromPostalCode(postalCode: string | null | undefined): { code: string; name: string } | null {
  if (!isSpanishPostalCode(postalCode)) return null;
  const code = postalCode.slice(0, 2);
  return { code, name: SPANISH_PROVINCES[code] };
}

/** Street-type abbreviations used on Spanish labels → canonical form. */
export const STREET_TYPE_ABBREVIATIONS: [RegExp, string][] = [
  [/^(c\/|c\.|cl\.?|cl\/|calle)\s*/i, 'Calle '],
  [/^(avda\.?|avd\.?|av\.?|avenida)\s+/i, 'Avenida '],
  [/^(pza\.?|plz\.?|pl\.?|plaza)\s+/i, 'Plaza '],
  [/^(p[ºo°]\.?|pso\.?|paseo)\s+/i, 'Paseo '],
  [/^(ctra\.?|crta\.?|carretera)\s+/i, 'Carretera '],
  [/^(cmno\.?|cno\.?|camino)\s+/i, 'Camino '],
  [/^(urb\.?|urbanizaci[oó]n)\s+/i, 'Urbanización '],
  [/^(rda\.?|ronda)\s+/i, 'Ronda '],
  [/^(trav\.?|trva\.?|travesía|travesia)\s+/i, 'Travesía '],
  [/^(glta\.?|glorieta)\s+/i, 'Glorieta '],
  [/^(pje\.?|psje\.?|pasaje)\s+/i, 'Pasaje '],
  [/^(blvr\.?|bulevar)\s+/i, 'Bulevar '],
  [/^(pol\.?|pg\.?|polígono|poligono)\s+/i, 'Polígono '],
  [/^(cjón\.?|callejón|callejon)\s+/i, 'Callejón '],
];

export function expandStreetType(street: string): string {
  const s = street.trim().replace(/\s+/g, ' ');
  for (const [re, canonical] of STREET_TYPE_ABBREVIATIONS) {
    if (re.test(s)) return canonical + s.replace(re, '').trim();
  }
  return s;
}

const STREET_TYPE_WORDS =
  /^(calle|avenida|plaza|paseo|carretera|camino|urbanizacion|ronda|travesia|glorieta|pasaje|bulevar|poligono|callejon|carrer|rua|kalea)\s+/;

/** Lowercase, strip accents, punctuation and the street type word; for fuzzy comparison. */
export function normalizeForCompare(value: string | null | undefined, { dropStreetType = false } = {}): string {
  if (!value) return '';
  let s = expandStreetType(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (dropStreetType) s = s.replace(STREET_TYPE_WORDS, '');
  s = s.replace(/\b(de|del|la|las|el|los|d)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/** Normalised Levenshtein similarity in [0,1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** Similarity that tolerates bilingual names like "SANT MIQUEL / SAN MIGUEL". */
export function nameSimilarity(input: string | null | undefined, candidate: string | null | undefined, dropStreetType = false): number {
  const a = normalizeForCompare(input, { dropStreetType });
  if (!a || !candidate) return 0;
  return Math.max(
    ...candidate.split('/').map((part) => {
      const b = normalizeForCompare(part, { dropStreetType });
      return Math.max(similarity(a, b), tokenContainment(a, b));
    }),
  );
}

/**
 * Labels often use the short form of an official name ("Calle Larios" for
 * "Calle Marqués de Larios"). When every input word (≥ 3 letters) appears in the candidate,
 * allowing small typos, the names are considered close (0.85), not identical.
 */
function tokenContainment(a: string, b: string): number {
  const inTokens = a.split(' ').filter((t) => t.length >= 3);
  const candTokens = b.split(' ');
  if (inTokens.length === 0 || candTokens.length <= inTokens.length) return 0;
  const all = inTokens.every((t) => candTokens.some((c) => similarity(t, c) >= 0.8));
  return all ? 0.85 : 0;
}

/** "CALLE SAN MIGUEL" → "Calle San Miguel" (keeps small connector words lowercase). */
export function titleCase(value: string): string {
  const small = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'i', 'd']);
  return value
    .toLowerCase()
    .split(/(\s+|\/|-)/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}
