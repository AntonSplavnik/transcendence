import React, { Suspense, useMemo } from "react";

function isStreamDebuggerEnabled(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === 'streams') {
    return true;
  }
  return localStorage.getItem('debug.streams') === '1';
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const StreamDebugger = useMemo(() => {
    if (!isStreamDebuggerEnabled()) {
      return null;
    }
    return React.lazy(() => import("../StreamDebugger"));
  }, []);

  return (
    <div className="min-h-screen bg-wood-900 text-wood-100 flex flex-col font-sans selection:bg-primary selection:text-white">
      <div className="flex-grow flex flex-col">
        {children}
      </div>
      {StreamDebugger && (
        <Suspense fallback={null}>
          <StreamDebugger />
        </Suspense>
      )}
    </div>
  );
}
