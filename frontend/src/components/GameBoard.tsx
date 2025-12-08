import BabylonCanvas from "./GameBoard/BabylonCanvas";
import Button from "./ui/Button";

export default function GameBoard({ mode, onLeave }: { mode: "local" | "online"; onLeave: () => void }) {
  return (
    <div className="flex flex-col h-screen">
      <div className="bg-wood-800 border-b border-wood-700 p-2 flex justify-between items-center shadow-lg z-10">
        <div className="font-bold text-wood-100 px-4">
          <span className="text-wood-400">Mode:</span> {mode.toUpperCase()}
        </div>
        <Button onClick={onLeave} variant="danger" className="py-1 px-3 text-sm">
          Forfeit Match
        </Button>
      </div>

      {/* 3D Canvas Area */}
      <div className="flex-grow bg-black relative">
        <BabylonCanvas />
      </div>
    </div>
  );
}
