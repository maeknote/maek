import type { Editor } from "@tiptap/react";
import { findTable, TableMap } from "@tiptap/pm/tables";

/**
 * Find table at current selection and get its info
 */
export function getTableInfo(editor: Editor) {
  const { state } = editor;
  const table = findTable(state.selection.$from);
  if (!table) return null;

  const map = TableMap.get(table.node);
  return {
    table,
    map,
    rowCount: map.height,
    colCount: map.width,
  };
}

/**
 * Find table node by document position
 */
export function findTableByPos(editor: Editor, tablePos: number) {
  const { state } = editor;
  const node = state.doc.nodeAt(tablePos);
  if (!node || node.type.name !== "table") return null;

  const map = TableMap.get(node);
  return {
    node,
    pos: tablePos,
    start: tablePos + 1,
    map,
    rowCount: map.height,
    colCount: map.width,
  };
}

/**
 * Add row at the end of a table (by table position)
 */
export function addRowToTable(editor: Editor, tablePos: number): boolean {
  const tableInfo = findTableByPos(editor, tablePos);
  if (!tableInfo) return false;

  const { map, start, node } = tableInfo;
  const lastRowIndex = map.height - 1;
  const cellPos = map.positionAt(lastRowIndex, 0, node);
  const absolutePos = start + cellPos;

  // Focus and set selection to last row's first cell
  editor.commands.focus();
  editor.commands.setTextSelection(absolutePos + 1);

  // Add row after
  return editor.chain().addRowAfter().run();
}

/**
 * Add column at the end of a table (by table position)
 */
export function addColumnToTable(editor: Editor, tablePos: number): boolean {
  const tableInfo = findTableByPos(editor, tablePos);
  if (!tableInfo) return false;

  const { map, start, node } = tableInfo;
  const lastColIndex = map.width - 1;
  const cellPos = map.positionAt(0, lastColIndex, node);
  const absolutePos = start + cellPos;

  // Focus and set selection to first row's last cell
  editor.commands.focus();
  editor.commands.setTextSelection(absolutePos + 1);

  // Add column after
  return editor.chain().addColumnAfter().run();
}

/**
 * Execute table menu action
 */
export function executeTableAction(
  editor: Editor,
  action: string,
  targetIndex: number,
): boolean {
  // Focus the editor first
  editor.commands.focus();

  switch (action) {
    case "addRowAbove":
      // Need to select a cell in the target row first
      return selectRowAndExecute(editor, targetIndex, () =>
        editor.chain().addRowBefore().run(),
      );

    case "addRowBelow":
      return selectRowAndExecute(editor, targetIndex, () =>
        editor.chain().addRowAfter().run(),
      );

    case "deleteRow":
      return selectRowAndExecute(editor, targetIndex, () =>
        editor.chain().deleteRow().run(),
      );

    case "addColumnLeft":
      return selectColumnAndExecute(editor, targetIndex, () =>
        editor.chain().addColumnBefore().run(),
      );

    case "addColumnRight":
      return selectColumnAndExecute(editor, targetIndex, () =>
        editor.chain().addColumnAfter().run(),
      );

    case "deleteColumn":
      return selectColumnAndExecute(editor, targetIndex, () =>
        editor.chain().deleteColumn().run(),
      );

    default:
      return false;
  }
}

/**
 * Select a cell in the specified row and execute action
 */
function selectRowAndExecute(
  editor: Editor,
  rowIndex: number,
  action: () => boolean,
): boolean {
  const info = getTableInfo(editor);
  if (!info) return false;

  const { table, map } = info;
  const cellPos = map.positionAt(rowIndex, 0, table.node);
  const absolutePos = table.start + cellPos;

  // Set selection to the cell
  editor.commands.setTextSelection(absolutePos + 1);

  return action();
}

/**
 * Select a cell in the specified column and execute action
 */
function selectColumnAndExecute(
  editor: Editor,
  colIndex: number,
  action: () => boolean,
): boolean {
  const info = getTableInfo(editor);
  if (!info) return false;

  const { table, map } = info;
  const cellPos = map.positionAt(0, colIndex, table.node);
  const absolutePos = table.start + cellPos;

  editor.commands.setTextSelection(absolutePos + 1);

  return action();
}
