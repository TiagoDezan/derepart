// Generates the PWA PNG icons (no image dependencies): node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 118, 110]; // teal-700
const FG = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Map pin with a route dot; `inset` shrinks the glyph (maskable safe zone), `rounded` clips corners. */
function render(size, { inset = 0.18, rounded = true } = {}) {
  const ss = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.2;
  const g0 = size * inset;
  const gs = size - 2 * g0;
  const cx = size / 2;
  const cy = g0 + gs * 0.4;
  const R = gs * 0.33;
  const hole = gs * 0.13;
  const tipY = g0 + gs * 0.95;
  const inPin = (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= R) return d > hole;
    // tangent triangle from the circle down to the tip
    if (y < cy || y > tipY) return false;
    const t = (y - cy) / (tipY - cy);
    return Math.abs(x - cx) <= R * (1 - t) * 0.92;
  };
  const inBg = (x, y) => {
    if (!rounded) return true;
    const qx = Math.min(x, size - x);
    const qy = Math.min(y, size - y);
    if (qx >= r || qy >= r) return true;
    return Math.hypot(r - qx, r - qy) <= r;
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          if (inBg(px, py)) {
            bg++;
            if (inPin(px, py)) fg++;
          }
        }
      const n = ss * ss;
      const a = bg / n;
      const f = bg ? fg / bg : 0;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(BG[k] * (1 - f) + FG[k] * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), render(192));
writeFileSync(new URL('icon-512.png', out), render(512));
writeFileSync(new URL('icon-maskable-512.png', out), render(512, { inset: 0.26, rounded: false }));
writeFileSync(new URL('apple-touch-icon.png', out), render(180, { inset: 0.2, rounded: false }));
console.log('icons written');
