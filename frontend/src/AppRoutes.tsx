import { useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { retrieveStoredError, getNavigationTarget } from './api/error';
import type { StoredError } from './api/error';
import LandingPage from './components/LandingPage';
import AuthPage from './components/AuthPage';
import Home from './components/Home';
import GameBoard from './components/GameBoard';
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

	const [currentError, setCurrentError] = useState<StoredError | null>(null);

	useEffect(() => {
		const storedError = retrieveStoredError();
		if (storedError) {
			console.log(`📋 Stored error: ${storedError.type}`);
			setCurrentError(storedError);
			const navTarget = getNavigationTarget(storedError.type);
			if (navTarget) {
				// clearAuth not needed because cleared by getMe failure
				navigate(`/${navTarget}`, { replace: true });
			}
		}
	}, [navigate]);

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
		<Layout>
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

				<Route path="*" element={<Navigate to="/landing" replace />} />
			</Routes>
		</Layout>
	);
}
