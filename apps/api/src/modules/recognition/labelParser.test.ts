import { describe, expect, it } from 'vitest';
import { fixDigits, parseLabel } from './labelParser';

describe('parseLabel', () => {
  it('parses a typical multi-line label', () => {
    const r = parseLabel(`DESTINATARIO:
JUAN GARCIA LOPEZ
C/ San Miguel, 15, 2ºB
29620 Torremolinos (Málaga)
Tel: 612 345 678`);
    expect(r.fields).toMatchObject({
      recipientName: 'Juan Garcia Lopez',
      street: 'Calle San Miguel',
      number: '15',
      complement: '2ºB',
      postalCode: '29620',
      city: 'Torremolinos',
      province: 'Málaga',
      phone: '612345678',
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('handles the OCR example from the spec (single line, typos)', () => {
    const r = parseLabel('C/ San Migel 15, 29620 Torremolino');
    expect(r.fields.street).toBe('Calle San Migel');
    expect(r.fields.number).toBe('15');
    expect(r.fields.postalCode).toBe('29620');
    expect(r.fields.city).toBe('Torremolino');
    expect(r.fields.province).toBe('Málaga');
  });

  it('fixes OCR digit confusion in the postal code', () => {
    expect(fixDigits('29O1O')).toBe('29010');
    const r = parseLabel(`María López
Avda. Andalucía 32
29O1O Málaga`);
    expect(r.fields.postalCode).toBe('29010');
    expect(r.fields.street).toBe('Avenida Andalucía');
    expect(r.fields.number).toBe('32');
    expect(r.fields.recipientName).toBe('María López');
  });

  it('ignores the sender block', () => {
    const r = parseLabel(`Remitente: Tienda Online SL
Polígono Industrial 4, 28001 Madrid
Destinatario: Pedro Fernández
Calle Z 8
29140 Churriana`);
    expect(r.fields.recipientName).toBe('Pedro Fernández');
    expect(r.fields.street).toBe('Calle Z');
    expect(r.fields.number).toBe('8');
    expect(r.fields.postalCode).toBe('29140');
    expect(r.fields.city).toBe('Churriana');
  });

  it('supports s/n and floor on the next line', () => {
    const r = parseLabel(`Ana Silva
Pza. de la Constitución s/n
Bajo A
29640 Fuengirola`);
    expect(r.fields.street).toBe('Plaza de la Constitución');
    expect(r.fields.number).toBe('s/n');
    expect(r.fields.complement).toBe('Bajo A');
  });

  it('accepts OCR variants of the ordinal sign (2%B, 3° izq)', () => {
    const a = parseLabel('JUAN GARCIA LOPEZ\nC/ San Migel 15, 2%B\n29620 Torremolino (Malaga)');
    expect(a.fields).toMatchObject({ street: 'Calle San Migel', number: '15', complement: '2ºB' });
    // real Tesseract output for "2ºB"
    const real = parseLabel('DESTINATARIO:\n\nJUAN GARCIA LOPEZ\n\nC/ San Migel 15, 2*%B\n\n29620 Torremolino (Málaga)\nTel: 612 345 678\n');
    expect(real.fields).toMatchObject({ street: 'Calle San Migel', number: '15', complement: '2ºB', phone: '612345678' });
    const b = parseLabel('Avda. Andalucía 32, 3° izq\n29010 Málaga');
    expect(b.fields).toMatchObject({ street: 'Avenida Andalucía', number: '32', complement: '3º izq' });
  });

  it('reports low confidence on garbage', () => {
    const r = parseLabel('~~ ||| x9 ^^ lorem');
    expect(r.confidence).toBeLessThan(0.4);
    expect(r.missing).toContain('postalCode');
  });
});
