import apiClient from './client';
import type {
	AuthResponse,
	Session,
	TwoFactorStartResponse,
	TwoFactorConfirmResponse,
	PasswordMfaPayload,
	SessionManagementPayload,
	ChangePasswordPayload,
	UserStats,
	AchievementWithProgress,
} from './types';

// ==================== USER INFO ====================

/**
 * Get current user and session info
 */
export async function getMe(): Promise<AuthResponse> {
	const response = await apiClient.get<AuthResponse>('/user/me');
	return response.data;
}

// ==================== USER DESCRIPTION ====================

export async function updateDescription(description: string): Promise<void> {
	await apiClient.put('/user/description', { description });
}

// ==================== TWO-FACTOR AUTHENTICATION ====================

export async function start2FA(password: string): Promise<TwoFactorStartResponse> {
	const response = await apiClient.post<TwoFactorStartResponse>('/user/2fa/start', {
		password,
	});
	return response.data;
}

export async function confirm2FA(
	password: string,
	code: string,
): Promise<TwoFactorConfirmResponse> {
	const response = await apiClient.post<TwoFactorConfirmResponse>('/user/2fa/confirm', {
		password,
		code,
	});
	return response.data;
}

export async function disable2FA(password: string, mfa_code: string): Promise<void> {
	await apiClient.post('/user/2fa/disable', {
		password,
		mfa_code,
	});
}

// ==================== CURRENT SESSION ====================

/**
 * Get current session info (no password required)
 */
export async function getSession(): Promise<Session> {
	const response = await apiClient.get<Session>('/user/session');
	return response.data;
}

// ==================== PASSWORD ====================

/**
 * Change password for the current user.
 * By default deauths all other sessions unless keepOtherSessionsLoggedIn is true.
 */
export async function changePassword(
	password: string,
	newPassword: string,
	mfaCode?: string,
	keepOtherSessionsLoggedIn: boolean = false,
): Promise<void> {
	const payload: ChangePasswordPayload = {
		password,
		new_password: newPassword,
		mfa_code: mfaCode,
		keep_other_sessions_logged_in: keepOtherSessionsLoggedIn,
	};
	await apiClient.post('/user/change-password', payload);
}

// ==================== SESSION MANAGEMENT ====================

export async function getSessions(password: string, mfaCode?: string): Promise<Session[]> {
	const payload: PasswordMfaPayload = { password, mfa_code: mfaCode }; // ✅ Reused type
	const response = await apiClient.post<Session[]>('/user/sessions', payload);
	return response.data;
}

export async function deleteSessions(
	password: string,
	sessionIds: number[],
	mfa_code?: string,
): Promise<void> {
	const payload: SessionManagementPayload = {
		password,
		session_ids: sessionIds,
		mfa_code,
	};
	await apiClient.delete('/user/sessions', { data: payload });
}

export async function logout(): Promise<void> {
	await apiClient.post('/user/logout');
}

// ==================== STATS ====================

export async function getMyStats(): Promise<UserStats> {
	const response = await apiClient.get<UserStats>('/stats/@me');
	return response.data;
}

export async function logoutOtherSessions(password: string, mfa_code?: string): Promise<void> {
	const payload: PasswordMfaPayload = { password, mfa_code };
	await apiClient.post('/user/logout-other-sessions', payload);
}

export async function logoutSessions(
	password: string,
	sessionIds: number[],
	mfa_code?: string,
): Promise<void> {
	const payload: SessionManagementPayload = {
		password,
		session_ids: sessionIds,
		mfa_code,
	};
	await apiClient.post('/user/logout-sessions', payload);
}

// ==================== ACHIEVEMENTS ====================

export async function getMyAchievements(): Promise<AchievementWithProgress[]> {
	const response = await apiClient.get<AchievementWithProgress[]>('/stats/achievements');
	return response.data;
}
