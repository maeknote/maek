import { useCallback, useMemo, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import type { TabItem } from "../../types";
import type {
  PropertyItem,
  PropertyValueType,
} from "../../utils/yamlProperties";
import {
  parseYamlToProperties,
  serializePropertiesToYaml,
  createEmptyProperty,
  convertPropertyType,
} from "../../utils/yamlProperties";
import { useTabStore } from "../../stores/tabStore";
import { PropertyRow } from "./PropertyRow";

interface PropertiesViewProps {
  tab: TabItem;
  onSave: () => void;
  onSwitchToRaw: () => void;
}

export function PropertiesView({
  tab,
  onSave,
  onSwitchToRaw,
}: PropertiesViewProps) {
  const { updateFrontmatterRaw } = useTabStore();

  const parsed = useMemo(
    () => parseYamlToProperties(tab.frontmatter.raw),
    [tab.frontmatter.raw],
  );

  const existingKeys = useMemo(
    () => new Set(parsed.properties.map((p) => p.key)),
    [parsed.properties],
  );

  const commitChanges = useCallback(
    (updatedProperties: PropertyItem[]) => {
      const yaml = serializePropertiesToYaml(updatedProperties, tab.frontmatter.raw);
      updateFrontmatterRaw(tab.id, yaml);
    },
    [tab.id, updateFrontmatterRaw],
  );

  const handleKeyChange = useCallback(
    (id: string, newKey: string) => {
      const updated = parsed.properties.map((p) =>
        p.id === id ? { ...p, key: newKey } : p,
      );
      commitChanges(updated);
    },
    [parsed.properties, commitChanges],
  );

  const handleValueChange = useCallback(
    (id: string, newValue: string | number | boolean | string[] | null) => {
      const updated = parsed.properties.map((p) =>
        p.id === id ? { ...p, value: newValue } : p,
      );
      commitChanges(updated);
    },
    [parsed.properties, commitChanges],
  );

  const handleTypeChange = useCallback(
    (id: string, newType: PropertyValueType) => {
      const updated = parsed.properties.map((p) =>
        p.id === id ? convertPropertyType(p, newType) : p,
      );
      commitChanges(updated);
    },
    [parsed.properties, commitChanges],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const updated = parsed.properties.filter((p) => p.id !== id);
      commitChanges(updated);
    },
    [parsed.properties, commitChanges],
  );

  const handleAdd = useCallback(() => {
    const newProp = createEmptyProperty();
    commitChanges([...parsed.properties, newProp]);
  }, [parsed.properties, commitChanges]);

  const handleSaveKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave();
      }
    },
    [onSave],
  );

  if (!parsed.canEdit) {
    return (
      <div className="px-4 py-3 text-center text-xs text-muted-text">
        <p>Cannot display as properties.</p>
        <button
          type="button"
          onClick={onSwitchToRaw}
          className="mt-1 text-muted-text underline transition-colors hover:text-neutral-ink"
        >
          Switch to YAML view
        </button>
      </div>
    );
  }

  return (
    <div onKeyDown={handleSaveKeyDown} className="pb-2">
      {parsed.properties.map((prop) => (
        <PropertyRow
          key={prop.id}
          property={prop}
          onKeyChange={handleKeyChange}
          onValueChange={handleValueChange}
          onTypeChange={handleTypeChange}
          onDelete={handleDelete}
          onSwitchToRaw={onSwitchToRaw}
          existingKeys={existingKeys}
        />
      ))}

      <button
        type="button"
        onClick={handleAdd}
        className="mt-0.5 flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-tertiary-text transition-colors hover:bg-surface-overlay hover:text-muted-text"
      >
        <Plus className="h-3 w-3" />
        Add property
      </button>
    </div>
  );
}
