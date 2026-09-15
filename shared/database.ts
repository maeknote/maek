export type DatabaseViewType = "table" | "kanban" | "calendar" | "timeline";
export type DatabaseColumnType =
  | "text" | "number" | "boolean" | "date" | "date-range"
  | "select" | "multi-select" | "list";

export interface DatabaseSortRule { columnId: string; direction: "asc" | "desc" }
export type DatabaseFilterOperator =
  | "is-empty" | "is-not-empty"
  | "text-equals" | "text-not-equals" | "text-contains" | "text-not-contains"
  | "text-starts-with" | "text-ends-with"
  | "num-eq" | "num-neq" | "num-gt" | "num-gte" | "num-lt" | "num-lte" | "num-between"
  | "bool-checked" | "bool-unchecked"
  | "date-on" | "date-before" | "date-after" | "date-between" | "date-is-today"
  | "date-last-n-days" | "date-next-n-days"
  | "select-is" | "select-is-not"
  | "list-contains" | "list-not-contains" | "list-contains-all";
export interface DatabaseFilterCondition { columnId: string; operator: DatabaseFilterOperator; value?: unknown }
export interface DatabaseFilterState { combinator: "and"; conditions: DatabaseFilterCondition[] }
export interface DatabaseViewState { sort: DatabaseSortRule[]; filter: DatabaseFilterState }

export type NumberFormat = "plain" | "integer" | "decimal" | "percent" | "currency-usd" | "currency-krw";
export type DatabaseAggregation = "none" | "count" | "count-empty" | "count-not-empty" | "count-unique" |
  "percent-empty" | "percent-not-empty" | "sum" | "average" | "min" | "max" | "median" | "range" |
  "earliest" | "latest" | "date-range-span";
export interface DatabaseColumnSchema {
  id: string; name: string; type: DatabaseColumnType; order: number;
  options?: string[]; numberFormat?: NumberFormat; aggregation?: DatabaseAggregation;
}
export interface TableViewConfig { columnOrder?: string[]; sort?: DatabaseSortRule[]; filter?: DatabaseFilterState }
export interface KanbanViewConfig extends DatabaseViewState { groupColumnId: string | null; laneColors?: Record<string,string>; cardFieldIds?: string[] }
export interface CalendarViewConfig extends DatabaseViewState { dateColumnId: string | null }
export interface TimelineViewConfig extends DatabaseViewState { dateColumnId: string | null; zoom: "day" | "week" | "month" }
export type DatabaseViewConfig = TableViewConfig | KanbanViewConfig | CalendarViewConfig | TimelineViewConfig;
export interface DatabaseViewDefinition {
  id: string; name: string; type: DatabaseViewType; config: DatabaseViewConfig; createdAt: number; updatedAt: number;
}
export interface DatabaseManifest {
  version: 1; type: "database"; id: string; name: string; schema: DatabaseColumnSchema[];
  views: DatabaseViewDefinition[]; activeViewId: string; createdAt: number; updatedAt: number;
}
export interface DatabaseMeta extends DatabaseManifest { folderPath: string }
export interface DatabaseRow {
  id: string; databaseId: string; fileName: string; path: string;
  yamlData: Record<string, unknown>; fileMtime: number; hash: string;
  sortOrder: number; createdAt: number; updatedAt: number;
}
export const EMPTY_VIEW_STATE: DatabaseViewState = { sort: [], filter: { combinator: "and", conditions: [] } };
