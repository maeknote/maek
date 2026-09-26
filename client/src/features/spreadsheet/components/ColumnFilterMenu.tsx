import { useMemo, useState } from "react";
import { FloatingMenu } from "@renderer/shared/components";
import { distinctColumnValues, type ColumnFilter } from "../filtering";
import type { SheetSession } from "../sheet-session";

/**
 * Per-column filter menu: value multi-select (OR), empty/non-empty, text
 * contains, and numeric comparison. The value list is searchable.
 */
export function ColumnFilterMenu({
  session,
  column,
  anchor,
  onClose,
}: {
  session: SheetSession;
  column: number;
  anchor: { x: number; y: number } | null;
  onClose: () => void;
}) {
  const existing: ColumnFilter = session.filters[column] ?? {};
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(existing.values ?? []));
  const [contains, setContains] = useState(existing.contains ?? "");

  const values = useMemo(() => {
    if (!session.document) return [];
    const all = distinctColumnValues({
      document: session.document,
      column,
      headerMode: session.headerMode,
      getDisplayValue: session.displayValue,
    });
    const needle = search.toLocaleLowerCase();
    return needle ? all.filter((v) => v.toLocaleLowerCase().includes(needle)) : all;
  }, [session.document, column, session.headerMode, session.displayValue, search]);

  const apply = () => {
    const next: ColumnFilter = {};
    if (selected.size) next.values = [...selected];
    if (contains) next.contains = contains;
    const filters = { ...(session.view.filters ?? {}) };
    if (Object.keys(next).length) filters[String(column)] = next;
    else delete filters[String(column)];
    session.updateView({ filters });
    onClose();
  };

  const clear = () => {
    const filters = { ...(session.view.filters ?? {}) };
    delete filters[String(column)];
    session.updateView({ filters });
    onClose();
  };

  const toggle = (value: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  return (
    <FloatingMenu isOpen position={anchor} onClose={onClose} minWidth={220}>
      <div className="csv-filter-menu">
        <input
          className="csv-filter-search"
          placeholder="Search values"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="csv-filter-values" role="listbox">
          {values.slice(0, 500).map((value) => (
            <label key={value || "(empty)"} className="csv-filter-value">
              <input type="checkbox" checked={selected.has(value)} onChange={() => toggle(value)} />
              <span>{value === "" ? "(empty)" : value}</span>
            </label>
          ))}
        </div>
        <input
          className="csv-filter-contains"
          placeholder="Text contains…"
          value={contains}
          onChange={(e) => setContains(e.target.value)}
        />
        <div className="csv-filter-actions">
          <button type="button" onClick={clear}>Clear</button>
          <button type="button" onClick={apply}>Apply</button>
        </div>
      </div>
    </FloatingMenu>
  );
}
