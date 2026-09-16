/** Supported database view types */
export type DatabaseViewType = "table" | "kanban" | "timeline" | "calendar";

/** View types that can be created as database display tabs. */
export type DatabaseCustomViewType = Exclude<DatabaseViewType, "chart">;

/** View-specific configuration for timeline view */
export interface TimelineViewConfig {
  /** date or date-range column ID used for positioning */
  dateColumnId: string | null;
  /** Zoom level */
  zoom: "day" | "week" | "month";
  /** Persisted sort rules. Phase 1 emits at most one rule. */
  sort?: DatabaseSortRule[];
  /** Persisted filter state. */
  filter?: DatabaseFilterState;
}

/** View-specific configuration for calendar view */
export interface CalendarViewConfig {
  /** date column ID used for calendar placement */
  dateColumnId: string | null;
  /** Persisted sort rules. Phase 1 emits at most one rule. */
  sort?: DatabaseSortRule[];
  /** Persisted filter state. */
  filter?: DatabaseFilterState;
}

/** View-specific configuration for kanban view */
export interface KanbanViewConfig {
  /** select column ID used for grouping */
  groupColumnId: string | null;
  /** Per-lane color mapping: option value → preset color key */
  laneColors?: Record<string, string>;
  /**
   * Column ids the user has selected to preview on each card. The row title
   * is always shown; this controls the additional fields beneath it. When
   * empty or undefined, the card falls back to the first non-group columns.
   */
  cardFieldIds?: string[];
  /** Persisted sort rules. Phase 1 emits at most one rule. */
  sort?: DatabaseSortRule[];
  /** Persisted filter state. */
  filter?: DatabaseFilterState;
}

/**
 * View-specific configuration for table view.
 *
 * All fields are optional so legacy `{ type: 'table' }` rows (written before
 * this config existed) can be normalized to `{ type: 'table', config: {} }`
 * at hydration time without any semantic drift.
 */
export interface TableViewConfig {
  /**
   * Explicit display order of columns by id. Ids no longer present in the
   * schema are ignored at render time; schema columns not listed here fall
   * back to `schema.order` sequencing. See `resolveColumnOrder` in the
   * database feature.
   */
  columnOrder?: string[];
  /** Persisted sort rules. Phase 1 emits at most one rule. */
  sort?: DatabaseSortRule[];
  /** Persisted filter state. */
  filter?: DatabaseFilterState;
}

/** Discriminated union of view-specific configurations */
export type ViewTypeConfig =
  | { type: "table"; config: TableViewConfig }
  | { type: "kanban"; config: KanbanViewConfig }
  | { type: "timeline"; config: TimelineViewConfig }
  | { type: "calendar"; config: CalendarViewConfig }
  | { type: "chart" };

export type DatabaseViewConfigByType = {
  table: TableViewConfig;
  kanban: KanbanViewConfig;
  timeline: TimelineViewConfig;
  calendar: CalendarViewConfig;
};

/** A named display view over a database's shared schema and rows. */
export interface DatabaseViewDefinition {
  id: string;
  name: string;
  type: DatabaseCustomViewType;
  config: DatabaseViewConfigByType[DatabaseCustomViewType];
  createdAt: number;
  updatedAt: number;
}

/** Supported column data types for database feature */
export type DatabaseColumnType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "date-range"
  | "select"
  | "multi-select"
  | "list";

/** Display format for number columns */
export type NumberFormat =
  | "plain"
  | "integer"
  | "decimal"
  | "percent"
  | "currency-usd"
  | "currency-krw";

/** Aggregation functions displayed at the bottom of a column */
export type DatabaseAggregation =
  | "none"
  | "count"
  | "count-empty"
  | "count-not-empty"
  | "count-unique"
  | "percent-empty"
  | "percent-not-empty"
  | "sum"
  | "average"
  | "min"
  | "max"
  | "median"
  | "range"
  | "earliest"
  | "latest"
  | "date-range-span";

/** Column schema definition (stored as JSON in databases.schema_json) */
export interface DatabaseColumnSchema {
  /** Stable identifier that survives column renames */
  id: string;
  /** YAML key name used in frontmatter */
  name: string;
  /** Value type */
  type: DatabaseColumnType;
  /** Display order (ascending) */
  order: number;
  /** Options list for select / multi-select */
  options?: string[];
  /** Display format for number columns */
  numberFormat?: NumberFormat;
  /** Selected aggregation function */
  aggregation?: DatabaseAggregation;
}

/** Value payload for date-range columns */
export interface DatabaseDateRangeValue {
  start: string | null;
  end: string | null;
}

/** Database metadata (one per folder) */
export interface DatabaseMeta {
  version: 1;
  type: "database";
  id: string;
  /** Workspace-root-relative POSIX path to the database folder */
  folderPath: string;
  /** Display name */
  name: string;
  /** Column schema definitions */
  schema: DatabaseColumnSchema[];
  /** Named display views over the same schema and rows. */
  views: DatabaseViewDefinition[];
  /** Active view id for this database. */
  activeViewId: string;
  /** Active view type for this database (defaults to 'table'). Compatibility projection. */
  viewType?: DatabaseViewType;
  /** Active view-specific configuration. Compatibility projection. */
  viewConfig?: ViewTypeConfig;
  /**
   * @deprecated Superseded by `TableViewConfig` (sort / filter now persist
   * inside `viewConfig.config` on the `'table'` variant). Kept only for
   * backwards-compatible reads during rollout; new code should not write to
   * or read from this field.
   */
  viewState?: DatabaseViewState;
  createdAt: number;
  updatedAt: number;
}

// --- Sort / filter view state ---

/**
 * Operator identifiers for filter conditions. A single flat union is used
 * (rather than a discriminated union per column type) so filter conditions
 * serialize cleanly and the type-compatibility check lives in one place
 * (`OPERATORS_BY_TYPE` in `filterOperators.ts`).
 */
export type DatabaseFilterOperator =
  // Common
  | "is-empty"
  | "is-not-empty"
  // Text
  | "text-equals"
  | "text-not-equals"
  | "text-contains"
  | "text-not-contains"
  | "text-starts-with"
  | "text-ends-with"
  // Number
  | "num-eq"
  | "num-neq"
  | "num-gt"
  | "num-gte"
  | "num-lt"
  | "num-lte"
  | "num-between"
  // Boolean
  | "bool-checked"
  | "bool-unchecked"
  // Date (single + range)
  | "date-on"
  | "date-before"
  | "date-after"
  | "date-between"
  | "date-is-today"
  | "date-last-n-days"
  | "date-next-n-days"
  // Select
  | "select-is"
  | "select-is-not"
  // Multi-select / list
  | "list-contains"
  | "list-not-contains"
  | "list-contains-all";

/** A single filter condition on one column. `value` shape depends on operator. */
export interface DatabaseFilterCondition {
  /** Stable column id (survives rename) */
  columnId: string;
  operator: DatabaseFilterOperator;
  /** Operator-specific payload; omitted for no-argument operators. */
  value?: unknown;
}

/** Filter state for a database view. Phase 1 only supports `and`. */
export interface DatabaseFilterState {
  combinator: "and";
  conditions: DatabaseFilterCondition[];
}

export type SortDirection = "asc" | "desc";

export interface DatabaseSortRule {
  columnId: string;
  direction: SortDirection;
}

/** Aggregated view state attached to a database table view. */
export interface DatabaseViewState {
  /** Sort rules, applied in order. Phase 1 only emits 0 or 1 rules. */
  sort: DatabaseSortRule[];
  filter: DatabaseFilterState;
}

/** Safe initial value for a brand-new (unsorted, unfiltered) view. */
export const EMPTY_VIEW_STATE: DatabaseViewState = {
  sort: [],
  filter: { combinator: "and", conditions: [] },
};

/** Indexed database row (corresponds to one markdown file) */
export interface DatabaseRow {
  path: string;
  hash: string;
  id: string;
  databaseId: string;
  /** File name relative to the database folder (e.g. "row-abc.md") */
  fileName: string;
  /** Parsed frontmatter as arbitrary key/value map */
  yamlData: Record<string, unknown>;
  /** File system mtime (ms) for drift detection */
  fileMtime: number;
  /** Manual sort order (dense integers, 0-based) */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

// --- IPC request / response types for database feature ---

export interface DatabaseCreateRequest {
  workspacePath: string;
  folderPath: string;
  name: string;
  schema?: DatabaseColumnSchema[];
  viewType?: DatabaseViewType;
  viewConfig?: ViewTypeConfig;
}

export type DatabaseCreateResult =
  | { success: true; database: DatabaseMeta }
  | { success: false; error: string };

export interface DatabaseDeleteRequest {
  workspacePath: string;
  databaseId: string;
}

export type DatabaseDeleteResult =
  | { success: true }
  | { success: false; error: string };

export interface DatabaseGetAllRequest {
  workspacePath: string;
}

export type DatabaseGetAllResult =
  | { success: true; databases: DatabaseMeta[] }
  | { success: false; error: string };

export interface DatabaseUpdateSchemaRequest {
  workspacePath: string;
  databaseId: string;
  schema: DatabaseColumnSchema[];
}

export type DatabaseUpdateSchemaResult =
  | { success: true; database: DatabaseMeta }
  | { success: false; error: string };

export interface DatabaseGetRowsRequest {
  workspacePath: string;
  databaseId: string;
}

export type DatabaseGetRowsResult =
  | { success: true; rows: DatabaseRow[] }
  | { success: false; error: string };

export interface DatabaseAddRowRequest {
  workspacePath: string;
  databaseId: string;
  /** Optional initial frontmatter values keyed by column name */
  initialValues?: Record<string, unknown>;
}

export type DatabaseAddRowResult =
  | { success: true; row: DatabaseRow }
  | { success: false; error: string };

export interface DatabaseUpdateCellRequest {
  workspacePath: string;
  databaseId: string;
  rowId: string;
  columnName: string;
  value: unknown;
}

export type DatabaseUpdateCellResult =
  | { success: true; row: DatabaseRow }
  | { success: false; error: string };

export interface DatabaseDeleteRowRequest {
  workspacePath: string;
  databaseId: string;
  rowId: string;
}

export type DatabaseDeleteRowResult =
  | { success: true }
  | { success: false; error: string };

export interface DatabaseSyncRequest {
  workspacePath: string;
  databaseId: string;
}

export type DatabaseSyncResult =
  | { success: true; rows: DatabaseRow[] }
  | { success: false; error: string };

export interface DatabaseRenameRequest {
  workspacePath: string;
  databaseId: string;
  newName: string;
}

export type DatabaseRenameResult =
  | {
      success: true;
      database: DatabaseMeta;
      oldAbsolutePath: string;
      newAbsolutePath: string;
    }
  | { success: false; error: string };

export interface DatabaseInsertRowRequest {
  workspacePath: string;
  databaseId: string;
  /** Row id to insert relative to */
  referenceRowId: string;
  position: "above" | "below";
}

export type DatabaseInsertRowResult =
  | { success: true; row: DatabaseRow }
  | { success: false; error: string };

export interface DatabaseReorderRowsRequest {
  workspacePath: string;
  databaseId: string;
  /** Row ids in the desired display order */
  orderedRowIds: string[];
}

export type DatabaseReorderRowsResult =
  | { success: true }
  | { success: false; error: string };

export interface DatabaseApplyKanbanDropRequest {
  workspacePath: string;
  databaseId: string;
  /** Set when a card crossed to a different lane. Writes the new select value to the row's yaml,
   *  or removes the field entirely when newValue is null (drop onto the No Value lane). */
  rowMove: {
    rowId: string;
    groupColumnName: string;
    /** New option value, or null when the property should be removed (No Value lane). */
    newValue: string | null;
  } | null;
  /** All visible rows in their final sort order. */
  orderedRowIds: string[];
}

export type DatabaseApplyKanbanDropResult =
  | { success: true; rows: DatabaseRow[]; database: DatabaseMeta }
  | { success: false; error: string };

export interface DatabaseRenameRowRequest {
  workspacePath: string;
  databaseId: string;
  rowId: string;
  newTitle: string;
}

export type DatabaseRenameRowResult =
  | { success: true; row: DatabaseRow }
  | { success: false; error: string };

export interface DatabaseUpdateViewTypeRequest {
  workspacePath: string;
  databaseId: string;
  viewType: DatabaseViewType;
  viewConfig?: ViewTypeConfig;
}

export type DatabaseUpdateViewTypeResult =
  | { success: true; database: DatabaseMeta }
  | { success: false; error: string };

export interface DatabaseSetActiveViewRequest {
  workspacePath: string;
  databaseId: string;
  viewId: string;
}

export type DatabaseSetActiveViewResult =
  | { success: true; database: DatabaseMeta }
  | { success: false; error: string };

export interface DatabaseCreateViewRequest {
  workspacePath: string;
  databaseId: string;
  type: DatabaseCustomViewType;
}

export type DatabaseCreateViewResult =
  | { success: true; database: DatabaseMeta }
  | { success: false; error: string };

export interface DatabaseUpdateViewRequest {
  workspacePath: string;
  databaseId: string;
  viewId: string;
  name?: string;
  config?: DatabaseViewConfigByType[DatabaseCustomViewType];
}

export type DatabaseUpdateViewResult =
  | { success: true; database: DatabaseMeta }
  | { success: false; error: string };

export interface DatabaseDeleteViewRequest {
  workspacePath: string;
  databaseId: string;
  viewId: string;
}

export type DatabaseDeleteViewResult =
  | { success: true; database: DatabaseMeta }
  | { success: false; error: string };

export type DatabaseManifest = Omit<
  DatabaseMeta,
  "folderPath" | "viewType" | "viewConfig" | "viewState"
>;
export type DatabaseViewConfig = DatabaseViewDefinition["config"];
