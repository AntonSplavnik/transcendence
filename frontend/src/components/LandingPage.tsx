import { Button, Card } from './ui';
import { Swords } from 'lucide-react';
import LandingScene from './LandingScene';

export default function LandingPage({ onLogin }: { onLogin: () => void }) {
	return (
		<main className="relative flex flex-col items-center justify-center flex-grow p-6 overflow-hidden">
			<LandingScene />

			<div className="relative z-10 max-w-4xl w-full text-center">
				{/* Hero Section */}
				<div className="mb-12">
					<Swords size={80} className="mx-auto text-gold-400 mb-4" aria-hidden="true" />
					<h1 className="text-5xl font-extrabold tracking-tight mb-2">
						Hit &apos;em good.
					</h1>
					{/* <p className="text-teal-400 text-xl font-bold">Some Game.</p> */}
				</div>

				<div className="flex flex-col gap-7 p-10">
					<p className="text-teal-400 text-xl font-bold">Some Game.</p>
				</div>

				<div className="flex flex-col gap-4 p-10">
					<Card hoverable className="flex flex-col items-center relative overflow-hidden">
						<h2 className="text-2xl font-bold mb-3">Online Multiplayer</h2>
						<p className="text-stone-300 mb-6 text-center">
							Sign in to track your stats and fight players globally.
						</p>
						<Button onClick={onLogin} fullWidth>
							Enter Arena
						</Button>
					</Card>
				</div>
			</div>
		</main>
	);
}
