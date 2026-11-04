// Reading a question form's raw values (technical design §2.8). The adapter hands over what the
// form returned; this decides whether it fits the fields that were asked, so the rule is tested
// without a world. Label-only rows may leave undefined slots, so those are skipped.
import type { FormField } from '../types.js';

/** One value per field (text, or chosen index); undefined when the form is unreadable. */
export function answerValues(
  fields: readonly FormField[],
  raw: readonly unknown[] | undefined,
): (string | number)[] | undefined {
  const given = (raw ?? []).filter((v) => v !== undefined);
  if (given.length !== fields.length) return undefined;
  const values = fields.map((field, i) => {
    const v = given[i];
    if (field.type === 'text') return typeof v === 'string' ? v : undefined;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < field.options.length
      ? v : undefined;
  });
  return values.every((v) => v !== undefined) ? values : undefined;
}
