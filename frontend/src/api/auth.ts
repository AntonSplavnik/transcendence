import apiClient from './client';
import type {
	AuthResponse,
	Session,
	LoginRequest,
	RegisterRequest,
	ReauthRequest
} from './types';

/**
 * Login with email and password
 * @param email - User email
 * @param password - User password
 * @param mfa_code - Optional 2FA code (required if 2FA is enabled)
 * @returns User session info on successful login
 */
export async function login(
	email: string,
	password: string,
	mfa_code?: string
): Promise<AuthResponse> {
	const payload: LoginRequest = { email, password, mfa_code };
	const response = await apiClient.post<AuthResponse>('/auth/login', payload);
	return response.data;
}

/**
 * Register a new user
 * @param nickname - Display name
 * @param email - User email
 * @param password - User password
 * @returns User session info on successful registration
 */
export async function register(
	nickname: string,
	email: string,
	password: string
): Promise<AuthResponse> {
	const payload: RegisterRequest = { nickname, email, password };
	const response = await apiClient.post<AuthResponse>('/auth/register', payload);
	return response.data;
}

/**
 * Logout current user
 * Clears session and redirects to landing page
 */
export async function logout(): Promise<void> {
	await apiClient.post<void>('/auth/logout');
}

/**
 * Refresh JWT access token
 * Called automatically by axios interceptor when JWT expires
 * @returns Updated session info with new JWT expiry time
 */
export async function refreshJWT(): Promise<Session> {
	const response = await apiClient.post<Session>(
		'/auth/session-management/refresh-jwt'
	);
	return response.data;
}

/**
 * Reauthenticate by providing password again
 * Used when session requires reauth (e.g., after 7 days of inactivity or 30 days since last password entry)
 * @param password - User password
 * @param mfa_code - Optional 2FA code (required if 2FA is enabled)
 * @returns User session info on successful reauth
 */
export async function reauth(
	password: string,
	mfa_code?: string
): Promise<AuthResponse> {
	const payload: ReauthRequest = { password, mfa_code };
	const response = await apiClient.post<AuthResponse>(
		'/auth/session-management/reauth',
		payload
	);
	return response.data;
}
