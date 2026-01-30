import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { retrieveStoredError, getNavigationTarget } from './api/error';
import LandingPage from './components/LandingPage';
import AuthPage from './components/AuthPage';
import Home from './components/Home';
import GameBoard from './components/GameBoard';
import Layout from './components/ui/Layout';
import ErrorBanner from './components/ui/ErrorBanner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const { user, authChecked } = useAuth();

	if (!authChecked) {
		return <>{children}</>;
	}
	if (!user) {
		return <Navigate to="/auth" replace />;
	}
	return <>{children}</>;
}

export default function AppRoutes() {
	const { logout } = useAuth();
	const navigate = useNavigate();

	useEffect(() => {
		const storedError = retrieveStoredError();
		if (storedError) {
			console.log(`📋 Stored error: ${storedError.type}`);
			const navTarget = getNavigationTarget(storedError.type);
			if (navTarget) {
				// clearAuth not needed because cleared by getMe failure
				// clearAuth();
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

	return (
		<Layout>
			<ErrorBanner />
			<Routes>
				<Route path="/landing" element={<LandingPage onLogin={() => navigate('/auth')} />} />
				<Route path="/auth" element={<AuthPage onBack={() => navigate('/landing')} onAuthSuccess={handleAuthSuccess} />} />
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
