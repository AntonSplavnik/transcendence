import BabylonCanvas from './GameBoard/BabylonCanvas';
import { Button } from './ui';

export default function GameBoard({ onLeave }: { onLeave: () => void }) {
	return (
		<div className="flex flex-col h-screen">
			<div className="bg-stone-800 border-b border-stone-700 p-2 flex justify-between items-center shadow-lg z-10">
				<Button onClick={onLeave} variant="danger" size="sm">
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
