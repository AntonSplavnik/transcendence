import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth';
import { setAuthFailureCallback, setTosNotAcceptedCallback } from '../api/client';
import type { AuthResponse, Session, User } from '../api/types';
import * as userApi from '../api/user';
import { useJwtRefresh } from '../hooks/useJwtRefresh';

interface AuthContextType {
	user: User | null;
	session: Session | null;
	authChecked: boolean;
	/**
	 * Whether the current user has accepted the current ToS version.
	 * Derived by comparing the user's `tos_accepted_at` against the server's
	 * current ToS timestamp. Forced to `false` when the backend has explicitly
	 * rejected a request with 403 `TosNotAccepted` (see `tosRequired` below).
	 */
	hasAcceptedTos: boolean;
	/**
	 * Whether we have enough information to make a ToS acceptance decision.
	 * True when either:
	 * - The `/api/tos` timestamp was fetched successfully, OR
	 * - The backend responded with 403 `TosNotAccepted` on any gated endpoint
	 *   (so we know acceptance is needed even if the timestamp fetch failed).
	 *
	 * Consumers gate ToS UI on this to avoid flickering a "please accept"
	 * prompt before we know whether acceptance is actually needed.
	 */
	tosLoaded: boolean;
	login: (email: string, password: string, mfaCode?: string) => Promise<void>;
	register: (nickname: string, email: string, password: string, tos: boolean) => Promise<void>;
	reauth: (password: string, mfa_code?: string) => Promise<void>;
	acceptTos: () => Promise<void>;
	logout: () => Promise<void>;
	clearAuth: () => void;
	refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Derive whether the user has accepted the current ToS by comparing
 * parsed timestamps. String comparison is unreliable across ISO-8601
 * variants (fractional seconds, `Z` vs `+00:00`), so we compare epoch ms.
 */
function deriveHasAcceptedTos(user: User | null, tosTimestamp: string | null): boolean {
	if (!user || !user.tos_accepted_at || !tosTimestamp) return false;
	return new Date(user.tos_accepted_at).getTime() >= new Date(tosTimestamp).getTime();
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [authChecked, setAuthChecked] = useState(false);
	// ── ToS acceptance state ───────────────────────────────────────────
	//
	// Two independent signals determine whether to show the ToS gate:
	//
	// 1. `tosTimestamp` — fetched from GET /api/tos after login. Compared
	//    against the user's `tos_accepted_at` to derive `hasAcceptedTos`.
	//    This is the happy path.
	//
	// 2. `tosRequired` — set to `true` when any API call returns
	//    403 TosNotAccepted (via the callback registered with
	//    `setTosNotAcceptedCallback` in client.ts). This is the fallback:
	//    if the /api/tos fetch fails (network error, server error),
	//    `tosTimestamp` stays null, but `tosRequired` still lets us show
	//    the gate as soon as the backend actually rejects a request.
	//
	// Together they feed the two context values consumers care about:
	//   tosLoaded      = tosTimestamp !== null || tosRequired
	//   hasAcceptedTos = tosRequired ? false : <timestamp comparison>
	const [tosTimestamp, setTosTimestamp] = useState<string | null>(null);
	const [tosRequired, setTosRequired] = useState(false);

	const hasAcceptedTos = useMemo(
		() => (tosRequired ? false : deriveHasAcceptedTos(user, tosTimestamp)),
		[user, tosTimestamp, tosRequired],
	);

	const clearAuth = useCallback(() => {
		console.log('🔒 Clearing authentication data');
		setUser(null);
		setSession(null);
		setTosTimestamp(null);
		setTosRequired(false);
	}, []);

	const setAuthData = (data: AuthResponse) => {
		setUser(data.user);
		setSession(data.session);
		setAuthChecked(true);
	};

	const handleSessionUpdate = useCallback((newSession: Session) => {
		setSession(newSession);
	}, []);

	useJwtRefresh({
		session,
		onSessionUpdate: handleSessionUpdate,
		onAuthLost: clearAuth,
	});

	// Register clearAuth as the handler for JWT refresh failures in the axios interceptor
	useEffect(() => {
		setAuthFailureCallback(clearAuth);
		return () => setAuthFailureCallback(null);
	}, [clearAuth]);

	// Fetch the current ToS timestamp from the server.
	const fetchTosTimestamp = useCallback(async () => {
		try {
			const info = await authApi.getTosTimestamp();
			setTosTimestamp(info.current_tos_timestamp);
		} catch (err) {
			console.error('Failed to fetch ToS timestamp:', err);
		}
	}, []);

	// Fetch ToS timestamp when a user becomes available. No user means no need
	// for the timestamp, and the backend is guaranteed to be reachable at this
	// point (it just served the auth response).
	useEffect(() => {
		if (user) {
			fetchTosTimestamp();
		}
	}, [user, fetchTosTimestamp]);

	// Register callback for 403 TosNotAccepted from the axios interceptor
	// (client.ts). Two things happen when the callback fires:
	// 1. `tosRequired = true` — immediately enables the ToS gate UI even if
	//    the /api/tos fetch never succeeded (see state comment above).
	// 2. Re-fetch the timestamp — so that `deriveHasAcceptedTos` can do a
	//    proper comparison once the user accepts and the page reloads.
	useEffect(() => {
		setTosNotAcceptedCallback(() => {
			setTosRequired(true);
			fetchTosTimestamp();
		});
		return () => setTosNotAcceptedCallback(null);
	}, [fetchTosTimestamp]);

	// initial auth check on mount
	useEffect(() => {
		async function checkAuth() {
			try {
				const data: AuthResponse = await userApi.getMe();
				setAuthData(data);
				console.log('✅ Initial Auth Check: User is authenticated');
			} catch {
				console.log('Initial Auth Check: Not logged in');
				clearAuth();
			} finally {
				setAuthChecked(true);
			}
		}
		checkAuth();
	}, [clearAuth]);

	// Login Handler
	const login = async (email: string, password: string, mfaCode?: string) => {
		const data: AuthResponse = await authApi.login(email, password, mfaCode);
		setAuthData(data);
	};

	// Register handler
	const register = async (nickname: string, email: string, password: string, tos: boolean) => {
		const data: AuthResponse = await authApi.register(nickname, email, password, tos);
		setAuthData(data);
	};

	//reauth handler
	const reauth = async (password: string, mfa_code?: string) => {
		const data: AuthResponse = await authApi.reauth(password, mfa_code);
		setAuthData(data);
	};

	// Logout Handler
	const logout = async (): Promise<void> => {
		try {
			await authApi.logout();
			console.log('✅ Logged out successfully');
		} catch (error) {
			console.error('❌ Logout failed (will clear local state):', error);
		} finally {
			clearAuth();
		}
	};

	// Accept the current ToS: call the API, clear the forced-false flag,
	// and refresh user data so `hasAcceptedTos` derives to true.
	const acceptTos = useCallback(async (): Promise<void> => {
		await authApi.acceptTos();
		setTosRequired(false);
		const data = await userApi.getMe();
		setAuthData(data);
	}, []);

	// Refresh user data from server
	const refreshUser = async (): Promise<void> => {
		const data = await userApi.getMe();
		setAuthData(data);
	};

	return (
		<AuthContext.Provider
			value={{
				user,
				session,
				authChecked,
				hasAcceptedTos,
				tosLoaded: tosTimestamp !== null || tosRequired,
				acceptTos,
				login,
				register,
				reauth,
				logout,
				clearAuth,
				refreshUser,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth(): AuthContextType {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error('useAuth must be used within an AuthProvider');
	}
	return context;
}
