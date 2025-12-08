import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
}

export default function Button({ children, variant = "primary", className = "", ...props }: ButtonProps) {
  const baseStyle = "px-4 py-2 rounded font-semibold transition-colors duration-200 border-b-4 active:border-b-0 active:translate-y-1";

  const variants = {
    primary: "bg-primary hover:bg-primary-hover text-primary-text border-amber-900",
    secondary: "bg-wood-700 hover:bg-wood-600 text-wood-100 border-wood-900",
    danger: "bg-red-700 hover:bg-red-600 text-white border-red-900",
  };

  return (
    <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
