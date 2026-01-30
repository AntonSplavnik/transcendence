import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import * as authApi from '../api/auth';
import type { User, Session, AuthResponse } from '../api/types';

interface AuthContextType {
	user: User | null;
	session: Session | null;
	authChecked: boolean;
	login: (email: string, password: string, mfaCode?: string) => Promise<void>;
	register: (nickname: string, email: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
	clearAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [authChecked, setAuthChecked] = useState(false);

	const clearAuth = () => {
		console.log('🔒 Clearing authentication data');
		setUser(null);
		setSession(null);
	};

	const setAuthData = (data: AuthResponse) => {
		setUser(data.user);
		setSession(data.session);
		setAuthChecked(true);
	}

	// initial auth check on mount
	useEffect(() => {
		async function checkAuth() {
			try {
				const data: AuthResponse = await authApi.getMe();
				setAuthData(data);
				console.log('✅ Initial Auth Check: User is authenticated');
			} catch (error) {
				console.log('Initial Auth Check: Not logged in');
				clearAuth();
			} finally {
				setAuthChecked(true);
			}
		}
		checkAuth();
	}, []);

	// Login Handler
	const login = async (email: string, password: string, mfaCode?: string) => {
		const data: AuthResponse = await authApi.login(email, password, mfaCode);
		setAuthData(data);
	};

	// Register handler
	const register = async (nickname: string, email: string, password: string) => {
		const data: AuthResponse = await authApi.register(nickname, email, password);
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

	return (
		<AuthContext.Provider value={{
			user,
			session,
			authChecked,
			login,
			register,
			logout,
			clearAuth
		}}>
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

