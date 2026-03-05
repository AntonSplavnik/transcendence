import { useState, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { retrieveStoredError } from './api/error';
import type { StoredError } from './api/error';
import LandingPage from './components/LandingPage';
import AuthPage from './components/AuthPage';
import Home from './components/Home';
import SessionManagement from './components/SessionManagement';
import GameBoard from './components/GameBoard';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';
import Layout from './components/ui/Layout';
import ErrorBanner from './components/ui/ErrorBanner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const { user } = useAuth();
	if (!user) {
		return <Navigate to="/auth" replace />;
	}
	return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
	const { user } = useAuth();
	if (user) {
		return <Navigate to="/home" replace />;
	}
	return <>{children}</>;
}

export default function AppRoutes() {
	const { logout, authChecked } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();
	const hideFooter = location.pathname === '/game';
	const isLanding = location.pathname === '/landing' || location.pathname === '/';

	const [currentError, setCurrentError] = useState<StoredError | null>(() => {
		const storedError = retrieveStoredError();
		if (storedError) {
			console.log(`📋 Stored error: ${storedError.type}`);
		}
		return storedError;
	});

	const handleAuthSuccess = async () => {
		navigate('/home');
	};

	const handleLogout = async () => {
		await logout();
		navigate('/landing');
	};

	const handleDismissError = useCallback(() => {
		setCurrentError(null);
	}, []);

	if (!authChecked) {
		return <Layout>{null}</Layout>;
	}
	return (
		<Layout className={isLanding ? 'h-screen overflow-hidden' : ''}>
			<ErrorBanner error={currentError} onDismiss={handleDismissError} />
			<Routes>
				<Route path="/landing" element={
					<PublicRoute>
						<LandingPage onLogin={() => navigate('/auth')} />
					</PublicRoute>
				} />
				<Route path="/auth" element={
					<PublicRoute>
						<AuthPage onBack={() => navigate('/landing')} onAuthSuccess={handleAuthSuccess} />
					</PublicRoute>
				} />
				<Route path="/home" element={
					<ProtectedRoute>
						<Home
							onGame={() => navigate('/game')}
							onLogout={handleLogout}
							onSessions={() => navigate('/sessions')}
						/>
					</ProtectedRoute>
				}
				/>
				<Route path="/sessions" element={
					<ProtectedRoute>
						<SessionManagement
							onBack={() => navigate('/home')}
							onLogout={handleLogout}
						/>
					</ProtectedRoute>
				}
				/>
				<Route path="/game" element={
					<ProtectedRoute>
						<GameBoard onLeave={() => navigate('/home')} />
					</ProtectedRoute>
				}
				/>

				<Route path="/privacy" element={
					<PrivacyPolicy onBack={() => navigate(-1)} />
				} />
				<Route path="/terms" element={
					<TermsOfService onBack={() => navigate(-1)} />
				} />

				<Route path="*" element={<Navigate to="/landing" replace />} />
			</Routes>
			{!hideFooter && (
				<footer role="contentinfo"
					className="relative z-10 py-1 text-center text-xs text-stone-500">
					<Link to="/privacy" aria-label="Privacy Policy" className="hover:text-gold-400 transition-colors">
						Privacy Policy
					</Link>
					<span className="mx-2">&middot;</span>
					<Link to="/terms" aria-label="Terms of Service" className="hover:text-gold-400 transition-colors">
						Terms of Service
					</Link>
				</footer>
			)}
		</Layout>
	);
}
