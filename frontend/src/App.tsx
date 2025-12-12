import { useState, useCallback, useEffect } from 'react';
import LandingPage from "./components/LandingPage";
import GameBoard from "./components/GameBoard";
import AuthPage from "./components/AuthPage";
import Home from "./components/Home";
import Layout from "./components/ui/Layout";
import './App.css'

type View = "landing" | "auth" | "game-local" | "game-online" | "home";

function App() {
	const [view, setView] = useState<View>("landing");
	const [isAuthenticated, setIsAuthenticated] = useState(false);

	// Check if user is already logged in on mount
	useEffect(() => {
		const token = localStorage.getItem('authToken');
		if (token) {
			setIsAuthenticated(true);
			setView("home");
		}
	}, []);


	const goLanding = useCallback(() => setView("landing"), []);
	const goAuth = useCallback(() => setView("auth"), []);
	const goHome = useCallback(() => setView("home"), []);
	const goGameLocal = useCallback(() => setView("game-local"), []);
	const goGameOnline = useCallback(() => setView("game-online"), []);

	const handleAuthSuccess = useCallback(() => {
		setIsAuthenticated(true);
		setView("home");
	}, []);

	const handleLogout = useCallback(() => {
		localStorage.removeItem('authToken');
		setIsAuthenticated(false);
		setView("landing");
	}, []);

	return (
		<Layout>
			{view === "landing" && (
				<LandingPage
					onLogin={goAuth}
					onLocal={goGameLocal}
				/>
			)}

			{view === "auth" && (
				<AuthPage
					onBack={goLanding}
					onAuthSuccess={handleAuthSuccess}
				/>
			)}

			{view === "home" && isAuthenticated && (
				<Home
					onLocal={goGameLocal}
					onOnline={goGameOnline}
					onLogout={handleLogout}
				/>
			)}

			{(view === "game-local" || view === "game-online") && (
				<GameBoard
					mode={view === "game-local" ? "local" : "online"}
					onLeave={isAuthenticated ? goHome : goLanding}  // Return to appropriate screen
				/>
			)}
		</Layout>
	);
}

export { App }
export default App
