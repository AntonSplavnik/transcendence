import Button from "./ui/Button";
import Card from "./ui/Card";
import { Swords } from 'lucide-react';
import LandingScene from "./LandingScene";

export default function LandingPage({ onLogin }: { onLogin: () => void; }) {
	return (
		<main className="relative flex flex-col items-center justify-center flex-grow p-6">

			<LandingScene />

			<div className="relative z-10 max-w-4xl w-full space-y-8 text-center">

				{/* Hero Section */}
				<div className="mb-12">
					<Swords size={80} className="mx-auto text-primary mb-4" />
					<h1 className="text-5xl font-extrabold tracking-tight text-wood-100 mb-2">
						Hit 'em good.
					</h1>
					<p className="text-wood-300 text-xl">Some Game.</p>
				</div>

				<div className="flex flex-col gap-6 p-10">
					{/* Online Play Card */}
					<Card className="flex flex-col items-center hover:border-primary transition-colors relative overflow-hidden">
						<h2 className="text-2xl font-bold mb-3 text-wood-100">Online Multiplayer</h2>
						<p className="text-wood-300 mb-6 text-center">
							Sign in to track your stats and fight players globally.
						</p>
						<Button onClick={onLogin} className="w-full">
							Enter Arena
						</Button>
					</Card>
				</div>
			</div>
		</main>
	);
}
