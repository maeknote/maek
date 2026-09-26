import { adjustFormulaReferences } from "./formula-references";

/**
 * Fill-series inference for the fill handle. Given the seed values along the
 * fill axis, produce `count` new values continuing the pattern.
 *
 * Rules (per plan F-2):
 *  - A single seed repeats.
 *  - Two or more consistent numeric seeds extend by the common step.
 *  - Two or more consistent YYYY-MM-DD date seeds extend by the day step.
 *  - Otherwise the seed pattern repeats cyclically.
 *  - Formulas adjust relative references by the destination offset, keeping $.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function parseIsoDate(value: string): number | null {
  if (!DATE_RE.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) ? null : time;
}

function formatIsoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function numericStep(seeds: string[]): number | null {
  const numbers = seeds.map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  if (numbers.length < 2) return null;
  const step = numbers[1]! - numbers[0]!;
  for (let index = 2; index < numbers.length; index++) {
    if (Math.abs(numbers[index]! - numbers[index - 1]! - step) > 1e-9) return null;
  }
  return step;
}

function dateStepDays(seeds: string[]): number | null {
  const times = seeds.map(parseIsoDate);
  if (times.some((t) => t === null)) return null;
  if (times.length < 2) return null;
  const step = (times[1]! - times[0]!) / MS_PER_DAY;
  for (let index = 2; index < times.length; index++) {
    if ((times[index]! - times[index - 1]!) / MS_PER_DAY !== step) return null;
  }
  return step;
}

/**
 * Compute the filled values. `rowOffsets`/`colOffsets` describe how each
 * produced cell is displaced from the seed cell it derives from, used only to
 * adjust formula references. For non-formula seeds the offsets are ignored.
 */
export function computeFillValues(options: {
  seeds: string[];
  count: number;
  /** For formula seeds: per-produced-cell reference offset (row, column). */
  offsetFor?: (index: number) => { row: number; column: number };
}): string[] {
  const { seeds, count } = options;
  if (count <= 0 || seeds.length === 0) return [];

  const allFormulas = seeds.every((s) => s.startsWith("="));
  if (allFormulas) {
    const offsetFor = options.offsetFor ?? (() => ({ row: 0, column: 0 }));
    return Array.from({ length: count }, (_, index) => {
      const seed = seeds[index % seeds.length]!;
      const { row, column } = offsetFor(index);
      return adjustFormulaReferences(seed, row, column);
    });
  }

  if (seeds.length === 1) {
    return Array.from({ length: count }, () => seeds[0]!);
  }

  const step = numericStep(seeds);
  if (step !== null) {
    const last = Number(seeds[seeds.length - 1]!);
    return Array.from({ length: count }, (_, index) => {
      const value = last + step * (index + 1);
      // Preserve integer formatting when the step and seeds are integers.
      return Number.isInteger(value) ? String(value) : String(value);
    });
  }

  const dateStep = dateStepDays(seeds);
  if (dateStep !== null) {
    const lastTime = parseIsoDate(seeds[seeds.length - 1]!)!;
    return Array.from({ length: count }, (_, index) => formatIsoDate(lastTime + dateStep * MS_PER_DAY * (index + 1)));
  }

  // Fall back to repeating the seed pattern cyclically.
  return Array.from({ length: count }, (_, index) => seeds[index % seeds.length]!);
}
