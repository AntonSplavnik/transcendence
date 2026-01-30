import BabylonCanvas from "./GameBoard/BabylonCanvas";
import Button from "./ui/Button";

export default function GameBoard({ onLeave }: { onLeave: () => void }) {
	return (
		<div className="flex flex-col h-screen">
			<div className="bg-wood-800 border-b border-wood-700 p-2 flex justify-between items-center shadow-lg z-10">
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
