import React from "react";

export interface BadgeProps {
  variant: "success" | "warning" | "danger" | "info" | "neutral";
  children: React.ReactNode;
  size?: "sm" | "md";
  dot?: boolean;
  className?: string;
}

const variantStyles: Record<string, { badge: string; dot: string }> = {
  success: {
    badge: "bg-success/15 text-success-light border-success/30",
    dot: "bg-success",
  },
  warning: {
    badge: "bg-warning/15 text-warning-light border-warning/30",
    dot: "bg-warning",
  },
  danger: {
    badge: "bg-danger/15 text-danger-light border-danger/30",
    dot: "bg-danger",
  },
  info: {
    badge: "bg-info/15 text-info-light border-info/30",
    dot: "bg-info",
  },
  neutral: {
    badge: "bg-stone-700 text-stone-300 border-stone-600",
    dot: "bg-stone-400",
  },
};

const sizeStyles: Record<string, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
};

export default function Badge({
  variant,
  children,
  size = "sm",
  dot = false,
  className = "",
}: BadgeProps) {
  const styles = variantStyles[variant];

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full font-medium border
        ${styles.badge} ${sizeStyles[size]} ${className}
      `}
      role="status"
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${styles.dot}`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
