import { isMap, isSeq, isScalar, parseDocument, type YAMLMap } from "yaml";

export type PropertyValueType =
  "string" | "number" | "boolean" | "list" | "null" | "unknown";

export interface PropertyItem {
  id: string;
  key: string;
  value: string | number | boolean | string[] | null;
  valueType: PropertyValueType;
  /**
   * The parsed value for a property the compact editor cannot edit (maps and
   * non-scalar sequences). Keep it so editing a neighbouring property never
   * deletes database fields such as a date range.
   */
  preservedValue?: unknown;
  /** Original key retained so a rename updates the existing YAML pair. */
  originalKey?: string;
  /** Original editable value, used to leave unchanged YAML nodes byte-stable. */
  originalValue?: unknown;
}

export interface ParseResult {
  properties: PropertyItem[];
  canEdit: boolean;
}

function detectValueType(value: unknown): PropertyValueType {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "unknown";
}

export function parseYamlToProperties(raw: string | null): ParseResult {
  if (raw === null || raw.trim() === "") {
    return { properties: [], canEdit: true };
  }

  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    return { properties: [], canEdit: false };
  }

  const contents = doc.contents;
  if (!isMap(contents)) {
    return { properties: [], canEdit: false };
  }

  const properties: PropertyItem[] = [];
  const seenKeys = new Set<string>();
  const values = doc.toJS() as Record<string, unknown>;

  for (const pair of contents.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);

    // Duplicate keys -> force raw mode
    if (seenKeys.has(key)) {
      return { properties: [], canEdit: false };
    }
    seenKeys.add(key);

    const val = pair.value;

    if (isScalar(val)) {
      const valueType = detectValueType(val.value);
      properties.push({
        id: `prop_${key}`,
        key,
        value: val.value as string | number | boolean | null,
        valueType,
        originalKey: key,
        originalValue: val.value,
      });
    } else if (isSeq(val)) {
      const allScalar = val.items.every((item) => isScalar(item));
      if (allScalar) {
        const listValues = val.items.map((item) =>
          isScalar(item) ? String(item.value ?? "") : "",
        );
        properties.push({
          id: `prop_${key}`,
          key,
          value: listValues,
          valueType: "list",
          originalKey: key,
          // The editor displays every scalar list entry as text. Compare that
          // projection to detect actual edits while leaving mixed YAML scalar
          // types untouched in the original AST.
          originalValue: listValues,
        });
      } else {
        properties.push({
          id: `prop_${key}`,
          key,
          value: null,
          valueType: "unknown",
          preservedValue: values[key],
          originalKey: key,
          originalValue: values[key],
        });
      }
    } else if (isMap(val)) {
      properties.push({
        id: `prop_${key}`,
        key,
        value: null,
        valueType: "unknown",
        preservedValue: values[key],
        originalKey: key,
        originalValue: values[key],
      });
    } else {
      properties.push({
        id: `prop_${key}`,
        key,
        value: null,
        valueType: "unknown",
        preservedValue: values[key],
        originalKey: key,
        originalValue: values[key],
      });
    }
  }

  return { properties, canEdit: true };
}

export function serializePropertiesToYaml(
  properties: PropertyItem[],
  originalRaw: string | null = null,
): string {
  const doc = parseDocument(originalRaw ?? "");
  const map = (isMap(doc.contents) ? doc.contents : doc.createNode({})) as unknown as YAMLMap;
  (doc as unknown as { contents: unknown }).contents = map;
  if (!isMap(map)) return "";
  const retainedKeys = new Set(properties.map((property) => property.originalKey).filter(Boolean));

  // Remove only properties explicitly deleted from the UI. Retained AST nodes
  // preserve comments, scalar styles, and YAML types in untouched properties.
  for (const pair of [...map.items]) {
    const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    if (!retainedKeys.has(key) && !properties.some((property) => !property.originalKey && property.key === key)) {
      map.items.splice(map.items.indexOf(pair), 1);
    }
  }

  for (const property of properties) {
    const originalKey = property.originalKey;
    const pair = originalKey
      ? map.items.find((item) => isScalar(item.key) && String(item.key.value) === originalKey)
      : undefined;

    if (pair) {
      if (property.key !== originalKey && property.key.trim() !== "")
        pair.key = doc.createNode(property.key.trim()) as never;
      if (property.valueType === "unknown") continue;

      const nextValue = propertyValue(property);
      if (sameValue(nextValue, property.originalValue)) continue;
      const node = doc.createNode(nextValue);
      if (pair.value && typeof pair.value === "object") {
        const oldNode = pair.value as { comment?: string | null; commentBefore?: string | null; spaceBefore?: boolean; type?: unknown };
        node.comment = oldNode.comment;
        node.commentBefore = oldNode.commentBefore;
        node.spaceBefore = oldNode.spaceBefore;
        if (isScalar(node) && isScalar(pair.value)) node.type = pair.value.type;
      }
      pair.value = node as never;
      continue;
    }

    if (property.key.trim() !== "" && property.valueType !== "unknown")
      doc.set(property.key.trim(), propertyValue(property));
  }

  return doc.toString().trimEnd();
}

function propertyValue(property: PropertyItem): unknown {
  switch (property.valueType) {
    case "string": return property.value ?? "";
    case "number": return typeof property.value === "number" ? property.value : Number(property.value) || 0;
    case "boolean": return Boolean(property.value);
    case "list": return Array.isArray(property.value) ? property.value : [];
    case "null": return null;
    case "unknown": return property.preservedValue;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createEmptyProperty(): PropertyItem {
  return {
    id: `prop_${crypto.randomUUID()}`,
    key: "",
    value: "",
    valueType: "string",
  };
}

export function convertPropertyType(
  prop: PropertyItem,
  newType: PropertyValueType,
): PropertyItem {
  const { value } = prop;
  let converted: string | number | boolean | string[] | null;

  switch (newType) {
    case "string":
      if (Array.isArray(value)) converted = value.join(", ");
      else if (value === null) converted = "";
      else converted = String(value);
      break;
    case "number":
      if (typeof value === "number") converted = value;
      else if (typeof value === "string") converted = parseFloat(value) || 0;
      else if (typeof value === "boolean") converted = value ? 1 : 0;
      else converted = 0;
      break;
    case "boolean":
      if (typeof value === "boolean") converted = value;
      else if (typeof value === "string")
        converted = value !== "" && value !== "false" && value !== "0";
      else if (typeof value === "number") converted = value !== 0;
      else converted = false;
      break;
    case "list":
      if (Array.isArray(value)) converted = value;
      else if (typeof value === "string" && value.includes(","))
        converted = value.split(",").map((s) => s.trim());
      else if (value === null || value === "") converted = [];
      else converted = [String(value)];
      break;
    case "null":
      converted = null;
      break;
    default:
      converted = value;
  }

  return { ...prop, value: converted, valueType: newType };
}
