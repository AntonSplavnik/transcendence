import { useEffect } from "react";
import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import type { StoredError } from "../../api/error";

export const AUTO_DISMISS_MS = 9000;

export interface ErrorBannerProps {
  error: StoredError | null;
  onDismiss: () => void;
  duration?: number;
  variant?: "error" | "warning" | "info";
}

const variantStyles: Record<string, { bg: string; icon: React.ReactNode }> = {
  error: {
    bg: "bg-danger/90 border-danger-light text-white",
    icon: <AlertCircle size={18} />,
  },
  warning: {
    bg: "bg-warning-dark/90 border-warning text-warning-light",
    icon: <AlertTriangle size={18} />,
  },
  info: {
    bg: "bg-info-dark/90 border-info text-info-light",
    icon: <Info size={18} />,
  },
};

export default function ErrorBanner({
  error,
  onDismiss,
  duration = AUTO_DISMISS_MS,
  variant = "error",
}: ErrorBannerProps) {
  useEffect(() => {
    if (error) {
      const timeoutId = window.setTimeout(onDismiss, duration);
      return () => clearTimeout(timeoutId);
    }
  }, [error, onDismiss, duration]);

  if (!error) return null;

  const styles = variantStyles[variant];

  return (
    <div
      className={`
        fixed top-4 left-1/2 -translate-x-1/2 z-50
        ${styles.bg} border
        px-5 py-3 rounded-lg shadow-lg max-w-md
        shadow-[0_4px_16px_rgba(0,0,0,0.3)]
      `}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true">{styles.icon}</span>
        <span className="text-sm font-medium">{error.message}</span>
        <button
          onClick={onDismiss}
          className="ml-2 opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Dismiss notification"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
