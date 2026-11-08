/** Drives repeating-section detection and filling against the fixture. */
import { collectFields, detectFields } from '@/core/detect/collect';
import { findAddButton, inferIndexFromAttributes } from '@/core/detect/repeater';
import { setValue } from '@/core/fill/setValue';
import { resolveValue } from '@/core/profile/resolve';
import { profileSchema } from '@/core/profile/schema';

const PROFILE = profileSchema.parse({
  schemaVersion: 1,
  updatedAt: 0,
  work: [
    { id: 'w1', company: 'Analytical Engines', title: 'Principal Engineer', isCurrent: true },
    { id: 'w2', company: 'Difference Machines', title: 'Senior Engineer', isCurrent: false },
    { id: 'w3', company: 'Babbage & Co', title: 'Engineer', isCurrent: false },
  ],
  education: [
    { id: 'e1', school: 'MIT', degree: "Bachelor's Degree" },
    { id: 'e2', school: 'Cambridge', degree: "Master's Degree" },
  ],
});

Object.assign(window, {
  /** What row each field was assigned to, and what it resolves to. */
  __fwRows: () =>
    detectFields(collectFields(), { includeDemographics: false })
      .filter((f) => f.status === 'matched')
      .map((f) => ({
        id: f.candidate.element.id || f.candidate.element.getAttribute('name'),
        key: f.key,
        row: f.rowIndex,
        value:
          resolveValue(PROFILE, f.key, { index: f.rowIndex })[0] ?? null,
      })),

  /** Fill every recognised field and report what each control holds. */
  __fwFillRows: () => {
    const out: Record<string, string> = {};
    for (const field of detectFields(collectFields(), { includeDemographics: false })) {
      if (field.status !== 'matched') continue;
      const el = field.candidate.element;
      if (!(el instanceof HTMLInputElement)) continue;
      const values = resolveValue(PROFILE, field.key, { index: field.rowIndex });
      if (values[0]) setValue(el, values[0]);
      out[el.id || `${el.name}#${field.rowIndex}`] = el.value;
    }
    return out;
  },

  __fwInfer: (name: string) => inferIndexFromAttributes([name]) ?? null,

  __fwAddButton: (sectionId: string) => {
    const section = document.getElementById(sectionId);
    const button = section ? findAddButton(section) : undefined;
    return button ? (button.textContent ?? '').trim() : null;
  },

  __fwRowCount: (section: string) => {
    const fields = detectFields(collectFields(), { includeDemographics: false }).filter(
      (f) => f.status === 'matched' && f.key.startsWith(`${section}.`),
    );
    return new Set(fields.map((f) => (f.status === 'matched' ? f.rowIndex : 0))).size;
  },
});
