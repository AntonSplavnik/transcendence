import { useState, useCallback, useEffect } from 'react';
import LandingPage from "./components/LandingPage";
import GameBoard from "./components/GameBoard";
import AuthPage from "./components/AuthPage";
import Home from "./components/Home";
import Layout from "./components/ui/Layout";
import './App.css'

type View = "auth" | "game-local" | "game-online" | "home" | "landing";

function App() {
	const [view, setView] = useState<View>("landing");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useEffect(() => {
		const storedError = localStorage.getItem('auth_error');

		if (storedError) {
			try {
				const errorData = JSON.parse(storedError);
				setErrorMessage(errorData.message);
				localStorage.removeItem('auth_error');
				setTimeout(() => setErrorMessage(null), 5000);
			} catch (e) {
				console.error('Failed to parse auth error:', e);
				localStorage.removeItem('auth_error');
			}
		}
	}, []);

	// JWT refresh timer
	useEffect(() => {
		const refreshInterval = 14 * 60 * 1000;

		const refreshJwt = async () => {
			try {
				await fetch('/api/auth/session-management/refresh-jwt', {
					method: 'POST',
					credentials: 'include',
				});
			} catch (error) {
				console.error('JWT refresh failed:', error);
			}
		};

		const intervalId = setInterval(refreshJwt, refreshInterval);
		return () => clearInterval(intervalId);
	}, []);

	const goAuth = useCallback(() => setView("auth"), []);
	const goHome = useCallback(() => setView("home"), []);
	const goGameLocal = useCallback(() => setView("game-local"), []);
	const goGameOnline = useCallback(() => setView("game-online"), []);
	const goLanding = useCallback(() => setView("landing"), []);

	const handleLogout = useCallback(async () => {
		await fetch('/api/auth/logout', {
			method: 'POST',
			credentials: 'include',
		});
		setView("landing");
	}, []);

	const renderView = () => {
		switch (view) {
			case "landing":
				return <LandingPage onLogin={goAuth} onLocal={goGameLocal} />;
			case "auth":
				return <AuthPage onBack={goLanding} onAuthSuccess={goHome} />;
			case "home":
				return (
					<Home
						onLocal={goGameLocal}
						onOnline={goGameOnline}
						onLogout={handleLogout}
					/>
				);
			case "game-local":
				return (
					<GameBoard
						mode="local"
						onLeave={goLanding}
					/>
				);
			case "game-online":
				return (
					<GameBoard
						mode="online"
						onLeave={goHome}
					/>
				);
			default:
				const _exhaustiveCheck: never = view;
				return _exhaustiveCheck;
		}
	};

	return (
		<Layout>
			{/* Error notification */}
			{errorMessage && (
				<div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 
                        bg-red-900/90 border border-red-500 text-red-100 
                        px-6 py-3 rounded-lg shadow-lg max-w-md">
					<div className="flex items-center gap-2">
						<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
							<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
						</svg>
						<span>{errorMessage}</span>
						<button
							onClick={() => setErrorMessage(null)}
							className="ml-2 text-red-200 hover:text-white"
						>
							✕
						</button>
					</div>
				</div>
			)}
			{renderView()}
		</Layout>
	);
}

export { App }
export default App;
