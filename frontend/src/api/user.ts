import apiClient from './client';
import type {
	AuthResponse,
	Session,
	TwoFactorStartResponse,
	TwoFactorConfirmResponse,
	PasswordMfaPayload,
	SessionManagementPayload,
} from './types';

// ==================== USER INFO ====================

/**
 * Get current user and session info
 */
export async function getMe(options?: { silent?: boolean }): Promise<AuthResponse> {
	const response = await apiClient.get<AuthResponse>('/user/me', {
		_silent: options?.silent
	} as any);
	return response.data;
}

// ==================== TWO-FACTOR AUTHENTICATION ====================

export async function start2FA(password: string): Promise<TwoFactorStartResponse> {
	const response = await apiClient.post<TwoFactorStartResponse>('/user/2fa/start', {
		password,
	});
	return response.data;
}

export async function confirm2FA(password: string, code: string): Promise<TwoFactorConfirmResponse> {
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

// ==================== SESSION MANAGEMENT ====================

export async function getSessions(password: string, mfaCode?: string): Promise<Session[]> {
	const payload: PasswordMfaPayload = { password, mfa_code: mfaCode };  // ✅ Reused type
	const response = await apiClient.post<Session[]>('/user/sessions', payload);
	return response.data;
}

export async function deleteSessions(password: string, sessionIds: number[], mfa_code?: string): Promise<void> {
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

export async function logoutOtherSessions(password: string, mfa_code?: string): Promise<void> {
	const payload: PasswordMfaPayload = { password, mfa_code };
	await apiClient.post('/user/logout-other-sessions', payload);
}

export async function logoutSessions(password: string, sessionIds: number[], mfa_code?: string): Promise<void> {
	const payload: SessionManagementPayload = {
		password,
		session_ids: sessionIds,
		mfa_code,
	};
	await apiClient.post('/user/logout-sessions', payload);
}
