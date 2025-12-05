import React from "react";


function LandingPage({ onLogin, onLocal }: { onLogin: () => void; onLocal: () => void }) {
  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">My Game</h1>
      <div className="flex gap-3">
        <button onClick={onLocal} className="px-4 py-2 bg-blue-600 rounded">Play Local</button>
        <button onClick={onLogin} className="px-4 py-2 bg-gray-700 rounded">Play Online</button>
      </div>
    </main>
  )
}

export { LandingPage };
export default LandingPage;
