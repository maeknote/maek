import { useCallback, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import type { PropertyValueType } from "../../utils/yamlProperties";

interface PropertyValueEditorProps {
  value: string | number | boolean | string[] | null;
  valueType: PropertyValueType;
  onChange: (value: string | number | boolean | string[] | null) => void;
  onTypeChange?: (newType: PropertyValueType) => void;
  onSwitchToRaw?: () => void;
}

export function PropertyValueEditor({
  value,
  valueType,
  onChange,
  onTypeChange,
  onSwitchToRaw,
}: PropertyValueEditorProps) {
  switch (valueType) {
    case "string":
      return (
        <StringEditor value={(value as string) ?? ""} onChange={onChange} />
      );
    case "number":
      return (
        <NumberEditor value={(value as number) ?? 0} onChange={onChange} />
      );
    case "boolean":
      return <BooleanEditor value={Boolean(value)} onChange={onChange} />;
    case "list":
      return (
        <ListEditor
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      );
    case "null":
      return <NullEditor onConvert={() => onTypeChange?.("string")} />;
    case "unknown":
      return <UnknownEditor onSwitchToRaw={onSwitchToRaw} />;
    default:
      return null;
  }
}

function StringEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="empty"
      className="h-7 w-full min-w-0 rounded border-0 bg-transparent px-2 font-mono text-[13px] text-neutral-ink outline-none transition-colors placeholder:text-tertiary-text focus:bg-[var(--color-input-bg)]"
    />
  );
}

function NumberEditor({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [localValue, setLocalValue] = useState(String(value));

  const handleBlur = useCallback(() => {
    const parsed = parseFloat(localValue);
    onChange(isNaN(parsed) ? 0 : parsed);
  }, [localValue, onChange]);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-7 w-full min-w-0 rounded border-0 bg-transparent px-2 font-mono text-[13px] text-neutral-ink outline-none transition-colors focus:bg-[var(--color-input-bg)]"
    />
  );
}

function BooleanEditor({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn("toggle-switch", value && "active")}
        aria-label={value ? "true" : "false"}
      />
      <span className="text-xs text-muted-text">
        {value ? "true" : "false"}
      </span>
    </div>
  );
}

function ListEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setInputValue("");
  }, [inputValue, value, onChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      } else if (
        e.key === "Backspace" &&
        inputValue === "" &&
        value.length > 0
      ) {
        onChange(value.slice(0, -1));
      }
    },
    [handleAdd, inputValue, value, onChange],
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 px-1.5 py-0.5">
      {value.map((item, index) => (
        <span
          key={`${index}_${item}`}
          className="inline-flex items-center gap-0.5 rounded-md bg-surface-overlay px-1.5 py-0.5 text-xs text-neutral-ink"
        >
          {item}
          <button
            type="button"
            onClick={() => handleRemove(index)}
            className="ml-0.5 rounded p-0 text-muted-text transition-colors hover:text-neutral-ink"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue.trim()) handleAdd();
        }}
        placeholder={value.length === 0 ? "Add item..." : ""}
        className="h-6 min-w-[60px] flex-1 border-0 bg-transparent px-1 text-xs text-neutral-ink outline-none placeholder:text-tertiary-text"
      />
    </div>
  );
}

function NullEditor({ onConvert }: { onConvert: () => void }) {
  return (
    <button
      type="button"
      onClick={onConvert}
      className="px-2 text-xs italic text-tertiary-text transition-colors hover:text-muted-text"
    >
      null — click to edit
    </button>
  );
}

function UnknownEditor({ onSwitchToRaw }: { onSwitchToRaw?: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[11px] text-muted-text">
        Object
      </span>
      {onSwitchToRaw && (
        <button
          type="button"
          onClick={onSwitchToRaw}
          className="text-[11px] text-muted-text underline transition-colors hover:text-neutral-ink"
        >
          Edit in YAML
        </button>
      )}
    </div>
  );
}
