import { z } from 'zod';

/** Output contract shared by every AI provider. */
export const aiLabelSchema = z.object({
  recipientName: z.string().nullable(),
  phone: z.string().nullable(),
  street: z.string().nullable(),
  number: z.string().nullable(),
  complement: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  country: z.string(),
  notes: z.string().nullable(),
  confidence: z.number(),
});
export type AiLabel = z.infer<typeof aiLabelSchema>;

export const LABEL_SYSTEM_PROMPT = `You extract the RECIPIENT delivery address from Spanish parcel labels.
The input is OCR text (it may contain recognition errors) and/or a photo of the label.

Rules:
- Ignore the sender ("Remitente", "From", return address), carrier logos, barcodes and tracking numbers.
- street: full street name with its type expanded ("C/" → "Calle", "Avda." → "Avenida", "Pza." → "Plaza", "Pº" → "Paseo", "Ctra." → "Carretera"). Fix obvious OCR typos only when you are confident (e.g. "San Migel" → "San Miguel").
- number: building number only ("15", "15-17", "s/n"). Put floor/door ("2ºB", "Bajo", "Esc. 2") in complement.
- postalCode: 5 digits for Spain. Fix OCR digit confusions (O→0, l/I→1, S→5) only if the result is a valid Spanish postal code.
- city: municipality or locality as written on the label, correctly spelled; province in its own field.
- country: ISO 3166-1 alpha-2 code, "ES" unless the label clearly says otherwise.
- notes: delivery instructions printed on the label (e.g. "dejar en conserjería"), else null.
- Use null for anything not present. Never invent data.
- confidence: 0–1, how sure you are that street, number, postal code and city are correct.`;

export function toAiResult(parsed: AiLabel) {
  const { confidence, ...fields } = parsed;
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    fields: {
      recipientName: clean(fields.recipientName),
      phone: clean(fields.phone),
      street: clean(fields.street),
      number: clean(fields.number),
      complement: clean(fields.complement),
      postalCode: clean(fields.postalCode),
      city: clean(fields.city),
      province: clean(fields.province),
      country: (clean(fields.country) ?? 'ES').toUpperCase().slice(0, 2),
      notes: clean(fields.notes),
    },
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}
