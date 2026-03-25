import { useState, useCallback, useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { retrieveStoredError } from './api/error';
import type { StoredError } from './api/error';
import AuthPage from './components/AuthPage';
import GameBoard from './components/GameBoard';
import Home from './components/Home';
import LandingPage from './components/LandingPage';
import DisplacedModal from './components/modals/DisplacedModal';
import TosModal from './components/modals/TosModal';
import PrivacyPolicy from './components/PrivacyPolicy';
import SessionManagement from './components/SessionManagement';
import TermsOfService from './components/TermsOfService';
import ConnectionStatusBanner from './components/ui/ConnectionStatusBanner';
import ErrorBanner from './components/ui/ErrorBanner';
import FriendsDrawer from './components/friends/FriendsDrawer';
import Layout from './components/ui/Layout';
import NotificationToast from './components/ui/NotificationToast';
import { useStream } from './contexts/StreamContext';
import type { ConnectionState } from './stream/types';

/**
 * `connecting` and `authenticating` are often very brief during a healthy
 * connection or reconnection flow. Delay their banner slightly so transient
 * handshake progress does not flash on screen, while still surfacing a real
 * problem if setup takes noticeably longer.
 */
const CONNECTION_STATUS_BANNER_DELAY_MS = 700;

type DelayedBannerConnectionState = Extract<
	ConnectionState,
	{ status: 'connecting' | 'authenticating' | 'disconnected' }
>;

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

function shouldDelayConnectionStatusBanner(
	state: ConnectionState,
): state is DelayedBannerConnectionState {
	return (
		state.status === 'connecting' ||
		state.status === 'authenticating' ||
		state.status === 'disconnected'
	);
}

function DelayedConnectionStatusBanner({ state }: { state: DelayedBannerConnectionState }) {
	const [hasDelayElapsed, setHasDelayElapsed] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => {
			setHasDelayElapsed(true);
		}, CONNECTION_STATUS_BANNER_DELAY_MS);

		return () => {
			clearTimeout(timer);
		};
	}, []);

	if (!hasDelayElapsed) {
		return null;
	}

	return <ConnectionStatusBanner state={state} />;
}

/**
 * Show the non-dismissible ToS acceptance modal when an authenticated user
 * has not accepted the current Terms of Service.
 *
 * Waits for `tosLoaded` to avoid flashing the modal before we know whether
 * acceptance is actually needed. `tosLoaded` becomes true either when the
 * /api/tos timestamp is fetched OR when the backend returns 403 TosNotAccepted
 * on any gated endpoint (see AuthContext for details).
 *
 * Hidden on `/terms` where the full ToS page has its own inline accept button.
 */
function TosGate() {
	const { user, authChecked, hasAcceptedTos, tosLoaded } = useAuth();
	const location = useLocation();

	if (!authChecked || !user || !tosLoaded || hasAcceptedTos) {
		return null;
	}
	// On /terms the TermsOfService component shows its own accept button,
	// so we skip the modal to avoid double UI.
	if (location.pathname === '/terms') {
		return null;
	}
	return <TosModal />;
}

/**
 * Connection status banners, displacement modal, and notification toasts.
 * Only rendered for authenticated users who have accepted the current ToS
 * (the stream is intentionally disconnected otherwise).
 */
function RealtimeStatusOverlays() {
	const { user, authChecked, hasAcceptedTos } = useAuth();
	const { connectionState } = useStream();
	const [dismissedDisplacementState, setDismissedDisplacementState] =
		useState<ConnectionState | null>(null);

	if (!authChecked || !user || !hasAcceptedTos) {
		return null;
	}

	const shouldShowDisplacedModal =
		connectionState.status === 'displaced' && dismissedDisplacementState !== connectionState;
	const shouldShowImmediateBanner =
		connectionState.status !== 'connected' &&
		!shouldDelayConnectionStatusBanner(connectionState);

	return (
		<>
			{shouldDelayConnectionStatusBanner(connectionState) ? (
				<DelayedConnectionStatusBanner state={connectionState} />
			) : shouldShowImmediateBanner ? (
				<ConnectionStatusBanner state={connectionState} />
			) : null}
			<NotificationToast />
			{shouldShowDisplacedModal && (
				<DisplacedModal onDismiss={() => setDismissedDisplacementState(connectionState)} />
			)}
		</>
	);
}

export default function AppRoutes() {
	const { user, logout, authChecked } = useAuth();
	const { connectionManager } = useStream();
	const navigate = useNavigate();
	const location = useLocation();
	const hideFooter = location.pathname === '/game';
	const isGame = location.pathname === '/game';
	const isLanding = location.pathname === '/landing' || location.pathname === '/';

	const [currentError, setCurrentError] = useState<StoredError | null>(() => {
		const storedError = retrieveStoredError();
		if (storedError) {
			console.log(`📋 Stored error: ${storedError.type}`);
		}
		return storedError;
	});

	// Subscribe to errors stored by the interceptor during SPA navigation (no page reload).
	// On page reload, the useState initializer above handles it instead.
	useEffect(() => {
		const onErrorStored = () => {
			const storedError = retrieveStoredError();
			if (storedError) setCurrentError(storedError);
		};
		window.addEventListener('auth-error-stored', onErrorStored);
		return () => window.removeEventListener('auth-error-stored', onErrorStored);
	}, []);

	const handleAuthSuccess = async () => {
		navigate('/home');
	};

	const handleLogout = async () => {
		// Stop the realtime connection first. During logout the backend closes the
		// WebTransport session before the HTTP response is returned, which would
		// otherwise look like an unexpected disconnect and trigger a reconnect.
		connectionManager.disconnect();
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
			<TosGate />
			<RealtimeStatusOverlays />
			<ErrorBanner error={currentError} onDismiss={handleDismissError} />
			{user && !isGame && <FriendsDrawer />}
			{/* Key on tos_accepted_at so the entire route tree remounts after
			   ToS acceptance. Components that failed to fetch data (403
			   TosNotAccepted) hold stale error state — a remount gives them
			   a fresh start without requiring a full page reload. */}
			<Routes key={user?.tos_accepted_at ?? 'pending'}>
				<Route
					path="/landing"
					element={
						<PublicRoute>
							<LandingPage onLogin={() => navigate('/auth')} />
						</PublicRoute>
					}
				/>
				<Route
					path="/auth"
					element={
						<PublicRoute>
							<AuthPage
								onBack={() => navigate('/landing')}
								onAuthSuccess={handleAuthSuccess}
							/>
						</PublicRoute>
					}
				/>
				<Route
					path="/home"
					element={
						<ProtectedRoute>
							<Home
								onGame={() => navigate('/game')}
								onLogout={handleLogout}
								onSessions={() => navigate('/sessions')}
							/>
						</ProtectedRoute>
					}
				/>
				<Route
					path="/sessions"
					element={
						<ProtectedRoute>
							<SessionManagement
								onBack={() => navigate('/home')}
								onLogout={handleLogout}
							/>
						</ProtectedRoute>
					}
				/>
				<Route
					path="/game"
					element={
						<ProtectedRoute>
							<GameBoard onLeave={() => navigate('/home')} />
						</ProtectedRoute>
					}
				/>

				<Route path="/privacy" element={<PrivacyPolicy onBack={() => navigate(-1)} />} />
				<Route path="/terms" element={<TermsOfService onBack={() => navigate(-1)} />} />

				<Route path="*" element={<Navigate to="/landing" replace />} />
			</Routes>
			{!hideFooter && (
				<footer
					role="contentinfo"
					className="relative z-10 py-1 text-center text-xs text-stone-500"
				>
					<Link
						to="/privacy"
						aria-label="Privacy Policy"
						className="hover:text-gold-400 transition-colors"
					>
						Privacy Policy
					</Link>
					<span className="mx-2">&middot;</span>
					<Link
						to="/terms"
						aria-label="Terms of Service"
						className="hover:text-gold-400 transition-colors"
					>
						Terms of Service
					</Link>
				</footer>
			)}
		</Layout>
	);
}
