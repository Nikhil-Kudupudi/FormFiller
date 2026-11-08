/** Drives date detection and filling against the date fixture. */
import { candidatesForInput, classifyDatePart, detectMask } from '@/core/fill/date';
import { collectFields, dateGroupLabel, detectFields } from '@/core/detect/collect';
import { selectOption, setValue } from '@/core/fill/setValue';
import { resolveValue } from '@/core/profile/resolve';
import { profileSchema } from '@/core/profile/schema';

const PROFILE = profileSchema.parse({
  schemaVersion: 1,
  updatedAt: 0,
  work: [{ id: 'w1', company: 'Acme', startDate: '2022-03', endDate: '2024-11', isCurrent: false }],
  education: [{ id: 'e1', school: 'MIT', startDate: '2016-09', endDate: '2020-05' }],
});

Object.assign(window, {
  /** What each control was understood to be. */
  __fwDates: () => {
    const detected = detectFields(collectFields(), { includeDemographics: false });
    return detected.map((f) => ({
      label: f.candidate.label,
      id: f.candidate.element.id,
      part: f.candidate.datePart ?? null,
      mask: detectMask(f.candidate.element),
      status: f.status,
      key: f.status === 'matched' ? f.key : null,
      values:
        f.status === 'matched'
          ? resolveValue(PROFILE, f.key, {
              ...(f.candidate.datePart ? { datePart: f.candidate.datePart } : {}),
            })
          : [],
    }));
  },

  /** Fill every recognised date control and report what landed. */
  __fwFillDates: () => {
    const detected = detectFields(collectFields(), { includeDemographics: false });
    const out: Record<string, string> = {};

    for (const field of detected) {
      if (field.status !== 'matched') continue;
      const el = field.candidate.element;
      const values = resolveValue(PROFILE, field.key, {
        ...(field.candidate.datePart ? { datePart: field.candidate.datePart } : {}),
      });
      if (values.length === 0) continue;

      if (el instanceof HTMLSelectElement) {
        selectOption(el, values);
        out[el.id] = el.value;
      } else if (el instanceof HTMLInputElement) {
        for (const value of candidatesForInput(el, values[0] ?? '')) {
          if (setValue(el, value)) break;
        }
        out[el.id] = el.value;
      }
    }
    return out;
  },

  __fwPart: (id: string) => {
    const el = document.getElementById(id);
    return el ? (classifyDatePart(el) ?? null) : null;
  },
});

