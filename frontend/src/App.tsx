import { useState, useCallback, useEffect } from 'react';
import LandingPage from "./components/LandingPage";
import GameBoard from "./components/GameBoard";
import AuthPage from "./components/AuthPage";
import Home from "./components/Home";
import Layout from "./components/ui/Layout";
import * as authApi from "./api/auth";
import { retrieveStoredError, getNavigationTarget } from './api/error';
import type { UserInfo } from "./api/types";
import { AUTH_CONFIG, VIEW_CONFIG, ERROR_CONFIG } from './config/constants';

type View = "auth" | "game" | "home" | "landing";

function App() {
	const [view, setView] = useState<View | null>(null);
	const [user, setUser] = useState<UserInfo | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// Check auth status on mount
	useEffect(() => {
		async function checkAuth() {
			// has to use slice at 2 to get rid of / and #
			const urlPath = window.location.pathname.slice(2) || 'landing';
			const lastView = (urlPath as View) || 'landing';
			if (VIEW_CONFIG.PROTECTED_VIEWS.includes(lastView as any)) {
				try {
					const userData = await authApi.getMe();
					setUser(userData.user);
					setView(lastView);
				} catch (error) {
					console.log('User not authenticated, redirecting to landing page.');
					setUser(null);
					setView('auth');
					window.history.replaceState(null, '', '/#auth');
				}
			} else {
				setView(lastView);
			}
		}
		checkAuth();
	}, []);

	// Error handling and navigation on error
	useEffect(() => {
		const storedError = retrieveStoredError();
		if (storedError) {
			console.log(`📋 Stored error detected: ${storedError.type}`);
			const navTarget = getNavigationTarget(storedError.type);
			if (navTarget) {
				console.log(`🧭 Navigating to:  ${navTarget}`);
				setUser(null);
				setView(navTarget);
				window.history.replaceState(null, '', `/#${navTarget}`);
				setErrorMessage(storedError.message);
				setTimeout(() => setErrorMessage(null), ERROR_CONFIG.AUTO_DISMISS_DURATION);
			} else {
				setErrorMessage(storedError.message);
				setTimeout(() => setErrorMessage(null), ERROR_CONFIG.AUTO_DISMISS_DURATION);
			}
		}
	}, []);

	// handle browser navigation (back/forward)
	useEffect(() => {
		const onPopState = async (event: PopStateEvent) => {
			const newView = (event.state?.view as View) ||
				(window.location.pathname.slice(2) as View) ||
				('landing');
			console.log('Navigated to view:', newView);
			if (VIEW_CONFIG.PROTECTED_VIEWS.includes(newView as any)) {
				if (!user)
					try {
						const userData = await authApi.getMe();
						setUser(userData.user);
						setView(newView);
					} catch (error) {
						console.log('Auth required but User not logged in');
						setView('landing');
					}
			} else {
				setView(newView);
			}
		};
		window.addEventListener('popstate', onPopState);
		return () => {
			window.removeEventListener('popstate', onPopState);
		};
	}, [user]);

	// update URL and history on view change
	useEffect(() => {
		if (view) {
			const currentPath = window.location.pathname.slice(2) || 'landing';
			if (currentPath !== view) {
				window.history.pushState({ view }, '', `/#${view}`);
			}
		}
	}, [view]);

	// Proactive token refresh during gameplay ONLY
	useEffect(() => {
		if (view !== 'game') return;
		console.log('🎮 Game started - enabling proactive token refresh');
		const doRefresh = async () => {
			try {
				await authApi.refreshJWT();
				console.log('✅ Token refreshed proactively');
				// TODO: if SessionInfo access_expiry is less than 4h away refresh session
			} catch (error) {
				console.error('❌ Proactive refresh failed:', error);
			}
		};
		doRefresh();
		const refreshInterval = setInterval(doRefresh, AUTH_CONFIG.JWT_REFRESH_INTERVAL);
		// initial refresh upon starting a game
		return () => {
			console.log('🛑 Game ended - disabling proactive refresh');
			clearInterval(refreshInterval);
		};
	}, [view]);

	const goAuth = useCallback(() => setView("auth"), []);
	const goHome = useCallback(() => setView("home"), []);
	const goGame = useCallback(() => setView("game"), []);
	const goLanding = useCallback(() => setView("landing"), []);

	const handleLogout = useCallback(async () => {
		await authApi.logout();
		setUser(null);
		setView("landing");
	}, []);
	// Show loading state while checking auth
	if (view === null) {
		return (
			<div className="min-h-screen bg-gray-900 flex items-center justify-center">
				<div className="text-white text-xl">Loading...</div>
			</div>
		);
	}
	const renderView = () => {
		switch (view) {
			case "landing":
				return <LandingPage onLogin={goAuth} />;
			case "auth":
				return <AuthPage onBack={goLanding} onAuthSuccess={goHome} />;
			case "home":
				return (<Home onGame={goGame} onLogout={handleLogout} />);
			case "game":
				return (<GameBoard mode="online" onLeave={goHome} />);
			default:
				const _exhaustiveCheck: never = view;
				return _exhaustiveCheck;
		}
	};

	return (
		<Layout>
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
