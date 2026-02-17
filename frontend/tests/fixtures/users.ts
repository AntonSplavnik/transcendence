import type { User, Session, AuthResponse } from '../../src/api/types';

export function createMockUser(overrides?: Partial<User>): User {
	return {
		id: 1,
		nickname: 'TestUser',
		email: 'test@example.com',
		created_at: '2024-01-01T00:00:00Z',
		totp_enabled: false,
		totp_confirmed_at: null,
		...overrides,
	};
}

export function createMockSession(overrides?: Partial<Session>): Session {
	const now = new Date();
	const accessExpiry = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes
	const loginExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

	return {
		session_id: 1,
		user_id: 1,
		created_at: now.toISOString(),
		last_used_at: now.toISOString(),
		access_expiry: accessExpiry.toISOString(),
		login_expiry: loginExpiry.toISOString(),
		device_name: 'Chrome on Linux',
		ip_address: '127.0.0.1',
		...overrides,
	};
}

export function createMockAuthResponse(
	userOverrides?: Partial<User>,
	sessionOverrides?: Partial<Session>
): AuthResponse {
	return {
		user: createMockUser(userOverrides),
		session: createMockSession(sessionOverrides),
	};
}

export function createMockSessionNearExpiry(minutesLeft: number = 10): Session {
	const now = new Date();
	const accessExpiry = new Date(now.getTime() + minutesLeft * 60 * 1000);

	return createMockSession({
		access_expiry: accessExpiry.toISOString(),
	});
}
