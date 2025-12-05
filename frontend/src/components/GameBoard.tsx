import React from "react";
import BabylonCanvas from "./GameBoard/BabylonCanvas";
import Button from "./ui/Button";

export default function GameBoard({ mode, onLeave }: { mode: "local" | "online"; onLeave: () => void }) {
  return (
    <div className="p-4">
      <div className="flex justify-between mb-2">
        <div>Mode: {mode}</div>
        <Button onClick={onLeave}>Leave</Button>
      </div>
      <BabylonCanvas />
    </div>
  );
}
