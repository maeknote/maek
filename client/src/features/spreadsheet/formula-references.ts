function columnNumber(label: string): number {
  let result = 0;
  for (const char of label) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function columnLabel(value: number): string {
  let current = value;
  let result = "";
  while (current > 0) {
    current--;
    result = String.fromCharCode(65 + current % 26) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function transformFormulaReferences(
  formula: string,
  transform: (column: number, row: number, absoluteColumn: string, absoluteRow: string) => [number, number] | null,
): string {
  if (!formula.startsWith("=")) return formula;
  const quoted = new Uint8Array(formula.length);
  let inString = false;
  for (let index = 0; index < formula.length; index++) {
    quoted[index] = Number(inString);
    if (formula[index] === '"') {
      if (inString && formula[index + 1] === '"') {
        quoted[index + 1] = 1;
        index++;
      } else inString = !inString;
    }
  }
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)/gi, (reference, absoluteColumn: string, column: string, absoluteRow: string, row: string, offset: number) => {
    const before = formula[offset - 1] ?? "";
    const after = formula[offset + reference.length] ?? "";
    if (quoted[offset] || formula[offset + reference.length] === "(" || /[A-Z0-9_.]/i.test(before) || /[A-Z0-9_]/i.test(after)) return reference;
    const [nextColumn, nextRow] = transform(columnNumber(column.toUpperCase()), Number(row), absoluteColumn, absoluteRow) ?? [0, 0];
    if (nextColumn < 1 || nextColumn > 16_384 || nextRow < 1 || nextRow > 1_048_576) return "#REF!";
    return `${absoluteColumn}${columnLabel(nextColumn)}${absoluteRow}${nextRow}`;
  });
}

export function adjustFormulaReferences(formula: string, rowOffset: number, columnOffset: number): string {
  return transformFormulaReferences(formula, (column, row, absoluteColumn, absoluteRow) => [
    absoluteColumn ? column : column + columnOffset,
    absoluteRow ? row : row + rowOffset,
  ]);
}

/** Update absolute and relative references when spreadsheet rows or columns move. */
export function shiftFormulaReferences(
  formula: string,
  axis: "row" | "column",
  boundary: number,
  delta: -1 | 1,
): string {
  return transformFormulaReferences(formula, (column, row) => {
    const coordinate = axis === "row" ? row : column;
    if (delta === -1 && coordinate === boundary) return null;
    const adjusted = delta === 1
      ? coordinate >= boundary ? coordinate + 1 : coordinate
      : coordinate > boundary ? coordinate - 1 : coordinate;
    return axis === "row" ? [column, adjusted] : [adjusted, row];
  });
}
