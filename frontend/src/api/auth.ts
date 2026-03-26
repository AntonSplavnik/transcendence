import apiClient from './client';
import type { AuthResponse, Session, TosInfo } from './types';

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
	mfa_code?: string,
): Promise<AuthResponse> {
	const response = await apiClient.post<AuthResponse>('/auth/login', {
		email,
		password,
		mfa_code,
	});
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
	password: string,
	tos: boolean,
): Promise<AuthResponse> {
	const response = await apiClient.post<AuthResponse>('/auth/register', {
		nickname,
		email,
		password,
		tos,
	});
	return response.data;
}

/**
 * Logout current user
 * Clears session and redirects to landing page
 */
export async function logout(): Promise<void> {
	await apiClient.post<void>('/user/logout');
}

/**
 * Refresh JWT access token
 * Called automatically by axios interceptor when JWT expires
 * @returns Updated session info with new JWT expiry time
 */
export async function refreshJWT(): Promise<Session> {
	const response = await apiClient.post<Session>('/auth/session-management/refresh-jwt');
	return response.data;
}

/** Accept the current Terms of Service and receive a fresh JWT. */
export async function acceptTos(): Promise<Session> {
	const response = await apiClient.post<Session>('/auth/session-management/accept-tos');
	return response.data;
}

/** Fetch the current ToS version timestamp from the server (unauthenticated). */
export async function getTosTimestamp(): Promise<TosInfo> {
	const response = await apiClient.get<TosInfo>('/tos');
	return response.data;
}

/**
 * Reauthenticate by providing password again.
 * Used when session requires reauth (e.g., after prolonged inactivity).
 */
export async function reauth(password: string, mfa_code?: string): Promise<AuthResponse> {
	const response = await apiClient.post<AuthResponse>('/auth/session-management/reauth', {
		password,
		mfa_code,
	});
	return response.data;
}
