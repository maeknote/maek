import { Document, isMap, isSeq, isScalar, parseDocument } from "yaml";

export type PropertyValueType =
  "string" | "number" | "boolean" | "list" | "null" | "unknown";

export interface PropertyItem {
  id: string;
  key: string;
  value: string | number | boolean | string[] | null;
  valueType: PropertyValueType;
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
        });
      } else {
        properties.push({
          id: `prop_${key}`,
          key,
          value: null,
          valueType: "unknown",
        });
      }
    } else if (isMap(val)) {
      properties.push({
        id: `prop_${key}`,
        key,
        value: null,
        valueType: "unknown",
      });
    } else {
      properties.push({
        id: `prop_${key}`,
        key,
        value: null,
        valueType: "unknown",
      });
    }
  }

  return { properties, canEdit: true };
}

export function serializePropertiesToYaml(properties: PropertyItem[]): string {
  const doc = new Document();
  doc.contents = doc.createNode({});

  for (const prop of properties) {
    if (prop.valueType === "unknown") continue;

    let value: unknown;
    switch (prop.valueType) {
      case "string":
        value = prop.value ?? "";
        break;
      case "number":
        value =
          typeof prop.value === "number" ? prop.value : Number(prop.value) || 0;
        break;
      case "boolean":
        value = Boolean(prop.value);
        break;
      case "list":
        value = Array.isArray(prop.value) ? prop.value : [];
        break;
      case "null":
        value = null;
        break;
      default:
        value = prop.value;
    }

    doc.set(prop.key, value);
  }

  return doc.toString().trimEnd();
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
