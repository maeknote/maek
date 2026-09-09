import { useCallback, useEffect, useState, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import type {
  PropertyItem,
  PropertyValueType,
} from "../../utils/yamlProperties";
import { PropertyValueEditor } from "./PropertyValueEditor";

const TYPE_LABELS: Record<PropertyValueType, string> = {
  string: "text",
  number: "num",
  boolean: "bool",
  list: "list",
  null: "null",
  unknown: "obj",
};

const CONVERTIBLE_TYPES: PropertyValueType[] = [
  "string",
  "number",
  "boolean",
  "list",
];

interface PropertyRowProps {
  property: PropertyItem;
  onKeyChange: (id: string, newKey: string) => void;
  onValueChange: (
    id: string,
    newValue: string | number | boolean | string[] | null,
  ) => void;
  onTypeChange: (id: string, newType: PropertyValueType) => void;
  onDelete: (id: string) => void;
  onSwitchToRaw: () => void;
  existingKeys: Set<string>;
}

export function PropertyRow({
  property,
  onKeyChange,
  onValueChange,
  onTypeChange,
  onDelete,
  onSwitchToRaw,
  existingKeys,
}: PropertyRowProps) {
  const [localKey, setLocalKey] = useState(property.key);
  const [keyError, setKeyError] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const typeRef = useRef<HTMLButtonElement>(null);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocalKey(property.key);
  }, [property.key]);

  useEffect(() => {
    return () => {
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    };
  }, []);

  const revertKey = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    setKeyError(true);
    revertTimerRef.current = setTimeout(() => {
      setLocalKey(property.key);
      setKeyError(false);
    }, 600);
  }, [property.key]);

  const handleKeyBlur = useCallback(() => {
    const trimmed = localKey.trim();
    if (trimmed === property.key) {
      setKeyError(false);
      return;
    }
    if (
      trimmed === "" ||
      (existingKeys.has(trimmed) && trimmed !== property.key)
    ) {
      revertKey();
      return;
    }
    setKeyError(false);
    onKeyChange(property.id, trimmed);
  }, [
    localKey,
    property.key,
    property.id,
    existingKeys,
    onKeyChange,
    revertKey,
  ]);

  const handleKeyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        setLocalKey(property.key);
        setKeyError(false);
        e.currentTarget.blur();
      }
    },
    [property.key],
  );

  const handleValueChange = useCallback(
    (newValue: string | number | boolean | string[] | null) => {
      onValueChange(property.id, newValue);
    },
    [property.id, onValueChange],
  );

  const handleTypeChangeFromEditor = useCallback(
    (newType: PropertyValueType) => {
      onTypeChange(property.id, newType);
    },
    [property.id, onTypeChange],
  );

  const handleTypeSelect = useCallback(
    (type: PropertyValueType) => {
      setShowTypeMenu(false);
      if (type !== property.valueType) {
        onTypeChange(property.id, type);
      }
    },
    [property.id, property.valueType, onTypeChange],
  );

  return (
    <div className="group flex min-h-[32px] items-center gap-1 rounded-md transition-colors hover:bg-surface-overlay">
      {/* Key input */}
      <div className="w-[35%] shrink-0">
        <input
          type="text"
          value={localKey}
          onChange={(e) => {
            setLocalKey(e.target.value);
            setKeyError(false);
          }}
          onBlur={handleKeyBlur}
          onKeyDown={handleKeyKeyDown}
          spellCheck={false}
          className={cn(
            "h-7 w-full rounded border-0 bg-transparent px-2 text-[13px] font-medium text-neutral-ink outline-none transition-colors placeholder:text-tertiary-text focus:bg-[var(--color-input-bg)]",
            keyError && "text-red-600 dark:text-red-400",
          )}
          placeholder="key"
        />
      </div>

      {/* Type badge */}
      <div className="relative shrink-0">
        <button
          ref={typeRef}
          type="button"
          onClick={() => {
            if (property.valueType !== "unknown") setShowTypeMenu((v) => !v);
          }}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] text-muted-text transition-colors",
            property.valueType !== "unknown" && "hover:bg-surface-overlay",
          )}
        >
          {TYPE_LABELS[property.valueType]}
        </button>
        {showTypeMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowTypeMenu(false)}
            />
            <div className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-input-border bg-surface py-1 shadow-md">
              {CONVERTIBLE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleTypeSelect(type)}
                  className={cn(
                    "flex w-full px-3 py-1 text-left text-xs transition-colors hover:bg-surface-overlay",
                    type === property.valueType
                      ? "font-medium text-neutral-ink"
                      : "text-muted-text",
                  )}
                >
                  {TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Value editor */}
      <div className="min-w-0 flex-1">
        <PropertyValueEditor
          value={property.value}
          valueType={property.valueType}
          onChange={handleValueChange}
          onTypeChange={handleTypeChangeFromEditor}
          onSwitchToRaw={onSwitchToRaw}
        />
      </div>

      {/* Delete button */}
      <button
        type="button"
        onClick={() => onDelete(property.id)}
        className="mr-1 shrink-0 rounded p-1 text-muted-text opacity-0 transition-all hover:bg-surface-overlay hover:text-neutral-ink group-hover:opacity-100"
        aria-label="Delete property"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
