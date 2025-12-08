import React from "react";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-wood-900 text-wood-100 flex flex-col font-sans selection:bg-primary selection:text-white">
      <div className="flex-grow flex flex-col">
        {children}
      </div>
    </div>
  );
}
