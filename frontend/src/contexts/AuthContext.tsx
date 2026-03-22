import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth';
import * as userApi from '../api/user';
import { useJwtRefresh } from '../hooks/useJwtRefresh';
import { setAuthFailureCallback } from '../api/client';
import type { User, Session, AuthResponse } from '../api/types';

interface AuthContextType {
	user: User | null;
	session: Session | null;
	authChecked: boolean;
	/**
	 * Whether the current user has accepted the current ToS version.
	 * Returns `false` when the ToS timestamp has not been fetched yet.
	 * Use `tosLoaded` to distinguish "not accepted" from "unknown".
	 */
	hasAcceptedTos: boolean;
	/** Whether the server's ToS timestamp has been fetched successfully. */
	tosLoaded: boolean;
	login: (email: string, password: string, mfaCode?: string) => Promise<void>;
	register: (nickname: string, email: string, password: string, tos: boolean) => Promise<void>;
	reauth: (password: string, mfa_code?: string) => Promise<void>;
	logout: () => Promise<void>;
	clearAuth: () => void;
	refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Derive whether the user has accepted the current ToS by comparing
 * timestamps. Both are ISO-8601 strings so lexicographic comparison works.
 */
function deriveHasAcceptedTos(user: User | null, tosTimestamp: string | null): boolean {
	if (!user || !user.tos_accepted_at || !tosTimestamp) return false;
	return user.tos_accepted_at >= tosTimestamp;
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [authChecked, setAuthChecked] = useState(false);
	const [tosTimestamp, setTosTimestamp] = useState<string | null>(null);

	const hasAcceptedTos = useMemo(
		() => deriveHasAcceptedTos(user, tosTimestamp),
		[user, tosTimestamp],
	);

	const clearAuth = useCallback(() => {
		console.log('🔒 Clearing authentication data');
		setUser(null);
		setSession(null);
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

	// Re-fetch ToS timestamp when the interceptor detects a TosNotAccepted error.
	// This ensures the client has an up-to-date timestamp even if the ToS version
	// was bumped after the page loaded.
	useEffect(() => {
		const onTosNotAccepted = () => {
			fetchTosTimestamp();
		};
		window.addEventListener('tos-not-accepted', onTosNotAccepted);
		return () => window.removeEventListener('tos-not-accepted', onTosNotAccepted);
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
				tosLoaded: tosTimestamp !== null,
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
