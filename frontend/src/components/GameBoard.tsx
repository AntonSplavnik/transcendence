import GameTestUI from './GameTestUI';

export default function GameBoard({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8">
        <div className="mb-4">
          <button
            onClick={onLeave}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back to Home
          </button>
        </div>
        <GameTestUI />
      </div>
    </div>
  );
}
