import React from "react";
import Button from "./ui/Button";

function Dashboard({ onLocal }: { onLocal: () => void }) {
  return (
    <main className="p-6 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">My Game</h1>
        <div className="text-sm text-gray-600">Simple starter</div>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="p-4 rounded-lg border bg-white shadow-sm">
          <h2 className="mb-2">Quick Play</h2>
          <p className="text-sm mb-4">Start a local game to test mechanics.</p>
          <Button onClick={onLocal}>Play Local</Button>
        </div>
      </section>
    </main>
  )
}

export { Dashboard };
export default Dashboard;
