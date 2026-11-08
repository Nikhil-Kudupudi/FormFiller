/**
 * Drives the combobox engine directly against the dropdown fixture.
 *
 * The window typings live with the spec that consumes them, so there is one
 * declaration rather than two that can drift apart.
 */
import { fillCombobox, displayedValue } from '@/core/fill/combobox';

Object.assign(window, {
  __fwCombo: async (id: string, candidates: string[], typeInto?: boolean) => {
    const el = document.getElementById(id);
    if (!el) return { ok: false, reason: 'no such element' };
    return fillCombobox(el, candidates, { typeInto: typeInto ?? false });
  },
  __fwShown: (id: string) => {
    const el = document.getElementById(id);
    return el ? displayedValue(el) : undefined;
  },
});
