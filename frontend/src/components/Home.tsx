import React, { useState } from "react";
import Button from "./ui/Button";
import Card from "./ui/Card";

export default function Home({ onLocal, onLogout, onOnline }: { onLocal: () => void; onLogout: () => void; onOnline: () => void }) {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError("");

		try {
			const token = localStorage.getItem('authToken');
			const response = await fetch('/api/auth/logout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', },
				body: JSON.stringify({ token }),
			});
			console.log("Response: ", response);
			if (response.ok) {
				onLogout();
			} else {
				setError("Logout failed. Please try again.");
			}
		} catch (error) {
			console.error("An error occurred during logout:", error);
			setError('Server error.  Please check your connection or try again later.');
		} finally {
			setIsLoading(false);
		};
	};
	return (
		<main className="p-6 max-w-4xl mx-auto w-full">
			<header className="flex items-center justify-between mb-8 pb-4 border-b border-wood-700">
				<div>
					<h1 className="text-3xl font-bold text-wood-100">Player Dashboard</h1>
					<p className="text-wood-300">Welcome back, Traveler.</p>
				</div>
				<form onSubmit={handleSubmit} className="space-y-4">
					{error && (
						<div className="bg-red-900/20 border border-red-500 text-red-200 px-4 py-2 rounded">
							{error}
						</div>
					)}
					<Button type="submit" disabled={isLoading} variant="secondary" >Log Out</Button>
				</form>
			</header>

			<section className="grid gap-6 md:grid-cols-2">
				<Card>
					<h2 className="text-xl font-bold mb-2 text-primary">Play Game</h2>
					<p className="text-sm text-wood-300 mb-4">
						Jump into a match immediately.
					</p>
					<div className="space-y-2">
						<Button onClick={onLocal} disabled={isLoading} className="w-full">Play Local Match</Button>
						<Button onClick={onOnline} disabled={isLoading} className="w-full">Find Online Match</Button>
					</div>
				</Card>

				<Card>
					<h2 className="text-xl font-bold mb-2 text-wood-100">Recent History</h2>
					<div className="bg-wood-900 rounded p-4 text-center text-wood-400 text-sm italic">
						No recent battles recorded.
					</div>
				</Card>
			</section>
		</main>
	);
}
