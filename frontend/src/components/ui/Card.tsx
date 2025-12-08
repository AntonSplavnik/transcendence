import React from "react";

export default function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-wood-800 border-2 border-wood-700 rounded-lg shadow-xl p-6 ${className}`}>
      {children}
    </div>
  );
}
