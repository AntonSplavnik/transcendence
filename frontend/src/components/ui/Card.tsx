import React from "react";

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "elevated" | "inset";
  accent?: "gold" | "danger" | "success" | "info" | "none";
  hoverable?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const accentBorder: Record<string, string> = {
  none: "",
  gold: "border-t-[3px] border-t-gold-400",
  danger: "border-t-[3px] border-t-danger",
  success: "border-t-[3px] border-t-success",
  info: "border-t-[3px] border-t-info",
};

const paddingStyles: Record<string, string> = {
  none: "p-0",
  sm: "p-3",
  md: "p-5",
  lg: "p-8",
};

export default function Card({
  children,
  className = "",
  variant = "default",
  accent = "none",
  hoverable = false,
  padding = "md",
}: CardProps) {
  const base =
    variant === "inset"
      ? "bg-stone-900 border border-stone-700/50 rounded-lg"
      : "card-stone";

  const elevation =
    variant === "elevated" ? "ring-1 ring-gold-400/10" : "";

  const hover = hoverable
    ? "hover:ring-1 hover:ring-gold-400/30 hover:shadow-[0_0_16px_rgba(224,160,48,0.08)] transition-all duration-200 cursor-pointer"
    : "";

  return (
    <div
      className={`
        ${base} ${elevation} ${accentBorder[accent]}
        ${paddingStyles[padding]} ${hover} ${className}
      `}
    >
      {children}
    </div>
  );
}
