import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createMockAuthResponse, createMockSession, createMockUser } from '../fixtures/users';
import { createMockApiError } from '../fixtures/errors';
import type { AuthResponse, TwoFactorStartResponse, TwoFactorConfirmResponse } from '../../src/api/types';

// Default mock responses
const defaultUser = createMockUser();
const defaultSession = createMockSession();
const defaultAuthResponse = createMockAuthResponse();

// Create the handlers
export const handlers = [
	// Auth endpoints
	http.post('/api/auth/login', async ({ request }) => {
		const body = await request.json() as { email: string; password: string; mfa_code?: string };

		if (body.email === 'invalid@example.com') {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials', detail: 'Invalid email or password' }) },
				{ status: 401 }
			);
		}

		if (body.email === 'mfa@example.com' && !body.mfa_code) {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief: 'TwoFactorRequired', detail: 'Two-factor authentication required' }) },
				{ status: 401 }
			);
		}

		if (body.mfa_code === 'invalid') {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief: 'TwoFactorInvalid', detail: 'Invalid 2FA code' }) },
				{ status: 401 }
			);
		}

		return HttpResponse.json(defaultAuthResponse);
	}),

	http.post('/api/auth/register', async () => {
		return HttpResponse.json(defaultAuthResponse);
	}),

	http.post('/api/auth/session-management/refresh-jwt', () => {
		return HttpResponse.json(defaultSession);
	}),

	http.post('/api/auth/session-management/reauth', async ({ request }) => {
		const body = await request.json() as { password: string; mfa_code?: string };

		if (body.password === 'wrong') {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials', detail: 'Invalid password' }) },
				{ status: 401 }
			);
		}

		return HttpResponse.json(defaultAuthResponse);
	}),

	// User endpoints
	http.get('/api/user/me', ({ request }) => {
		const config = request.headers.get('X-Silent');
		// For testing auth check failures
		if (request.url.includes('fail')) {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief: 'MissingJwtCookie' }) },
				{ status: 401 }
			);
		}
		return HttpResponse.json(defaultAuthResponse);
	}),

	http.post('/api/user/logout', () => {
		return new HttpResponse(null, { status: 204 });
	}),

	http.post('/api/user/2fa/start', async ({ request }) => {
		const body = await request.json() as { password: string };

		if (body.password === 'wrong') {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials' }) },
				{ status: 401 }
			);
		}

		const response: TwoFactorStartResponse = {
			base32_secret: 'JBSWY3DPEHPK3PXP',
			qr_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
			url: 'otpauth://totp/Test:test@example.com?secret=JBSWY3DPEHPK3PXP',
		};
		return HttpResponse.json(response);
	}),

	http.post('/api/user/2fa/confirm', async ({ request }) => {
		const body = await request.json() as { password: string; code: string };

		if (body.code === 'invalid') {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 400, brief: 'TwoFactorInvalid', detail: 'Invalid verification code' }) },
				{ status: 400 }
			);
		}

		const response: TwoFactorConfirmResponse = {
			recovery_codes: ['AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF', 'GGGG-HHHH'],
		};
		return HttpResponse.json(response);
	}),

	http.post('/api/user/2fa/disable', async ({ request }) => {
		const body = await request.json() as { password: string; mfa_code: string };

		if (body.password === 'wrong') {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials' }) },
				{ status: 401 }
			);
		}

		return new HttpResponse(null, { status: 204 });
	}),

	http.post('/api/user/sessions', () => {
		return HttpResponse.json([defaultSession]);
	}),

	// Users endpoints (public)
	http.post('/api/users/nickname-exists', async ({ request }) => {
		const nickname = await request.text();
		const parsed = JSON.parse(nickname);

		if (parsed === 'taken') {
			return HttpResponse.json({ exists: true, valid: true });
		}
		if (parsed === 'invalid!') {
			return HttpResponse.json({ exists: false, valid: false });
		}
		return HttpResponse.json({ exists: false, valid: true });
	}),
];

// Create the server
export const server = setupServer(...handlers);

// Helper to override handlers for specific tests
export function mockAuthenticatedUser(user = defaultUser, session = defaultSession) {
	server.use(
		http.get('/api/user/me', () => {
			return HttpResponse.json({ user, session } as AuthResponse);
		})
	);
}

export function mockUnauthenticatedUser() {
	server.use(
		http.get('/api/user/me', () => {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief: 'MissingJwtCookie' }) },
				{ status: 401 }
			);
		})
	);
}

export function mockLoginFailure(brief: string = 'InvalidCredentials') {
	server.use(
		http.post('/api/auth/login', () => {
			return HttpResponse.json(
				{ error: createMockApiError({ code: 401, brief }) },
				{ status: 401 }
			);
		})
	);
}

export function mockNetworkError() {
	server.use(
		http.get('/api/user/me', () => {
			return HttpResponse.error();
		})
	);
}
