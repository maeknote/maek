// Toast Component - Individual toast notification display

import { X } from "lucide-react";
import { useToast } from "./ToastContext";

const typeStyles = {
  success: "bg-green-500 text-white",
  error: "bg-red-500 text-white",
  info: "bg-neutral-700 text-white",
};

export function ToastContainer() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg
            min-w-[200px] max-w-[400px]
            animate-in slide-in-from-right-5 fade-in duration-200
            ${typeStyles[toast.type]}
          `}
        >
          <span className="flex-1 text-sm font-medium">{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.onClick();
                dismissToast(toast.id);
              }}
              className="px-2 py-1 text-xs font-semibold bg-white/20 hover:bg-white/30 rounded transition-colors"
            >
              {toast.action.label}
            </button>
          )}
          <button
            onClick={() => dismissToast(toast.id)}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
