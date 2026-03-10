import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/msw-handlers';
import { createMockApiError } from '../../fixtures/errors';

describe('API client interceptors', () => {
	beforeEach(() => {
		vi.resetModules();
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it('passes successful responses through unchanged', async () => {
		const { default: apiClient } = await import('../../../src/api/client');

		server.use(
			http.get('/api/test', () => {
				return HttpResponse.json({ data: 'success' });
			})
		);

		const response = await apiClient.get('/test');
		expect(response.data).toEqual({ data: 'success' });
	});

	it.each(['InvalidJwt', 'MissingJwtCookie'])('attempts JWT refresh on %s', async (brief) => {
		let refreshCalled = false;
		let retryCalled = false;

		server.use(
			http.get('/api/protected', () => {
				if (!retryCalled) {
					retryCalled = true;
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief }) },
						{ status: 401 }
					);
				}
				return HttpResponse.json({ data: 'success' });
			}),
			http.post('/api/auth/session-management/refresh-jwt', () => {
				refreshCalled = true;
				return HttpResponse.json({
					session_id: 1,
					access_expiry: new Date(Date.now() + 900000).toISOString(),
				});
			})
		);

		const { default: apiClient } = await import('../../../src/api/client');
		const response = await apiClient.get('/protected');

		expect(refreshCalled).toBe(true);
		expect(response.data).toEqual({ data: 'success' });
	});

	function setupFailedRefreshMocks(originalBrief: string, refreshStatus = 401, refreshBrief = 'MissingSessionCookie') {
		server.use(
			http.get('/api/test', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 401, brief: originalBrief }) },
					{ status: 401 }
				);
			}),
			http.post('/api/auth/session-management/refresh-jwt', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: refreshStatus, brief: refreshBrief }) },
					{ status: refreshStatus }
				);
			})
		);
	}

	it('stores error but does NOT clear auth when refresh fails with 429 (session still valid)', async () => {
		const onAuthFailure = vi.fn();
		setupFailedRefreshMocks('MissingJwtCookie', 429, 'RateLimited');

		const { default: apiClient, setAuthFailureCallback } = await import('../../../src/api/client');
		setAuthFailureCallback(onAuthFailure);

		await expect(apiClient.get('/test')).rejects.toThrow();

		expect(localStorage.getItem('auth_error')).not.toBeNull();
		expect(onAuthFailure).not.toHaveBeenCalled();
	});

	it('does not store error when refresh fails with 401 (session gone)', async () => {
		setupFailedRefreshMocks('MissingJwtCookie');

		const { default: apiClient } = await import('../../../src/api/client');
		await expect(apiClient.get('/test')).rejects.toThrow();

		expect(localStorage.getItem('auth_error')).toBeNull();
	});

	it('calls authFailureCallback when JWT refresh fails with 401 (session gone)', async () => {
		const onAuthFailure = vi.fn();
		setupFailedRefreshMocks('MissingJwtCookie');

		const { default: apiClient, setAuthFailureCallback } = await import('../../../src/api/client');
		setAuthFailureCallback(onAuthFailure);

		await expect(apiClient.get('/test')).rejects.toThrow();
		expect(onAuthFailure).toHaveBeenCalledTimes(1);
	});

	it('does not store error for login errors (handled by component)', async () => {
		const loginBriefs = ['InvalidCredentials', 'TwoFactorRequired', 'TwoFactorInvalid'];

		for (const brief of loginBriefs) {
			localStorage.clear();
			vi.resetModules();

			server.use(
				http.get('/api/test', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief }) },
						{ status: 401 }
					);
				})
			);

			const { default: apiClient } = await import('../../../src/api/client');

			await expect(apiClient.get('/test')).rejects.toThrow();
			expect(localStorage.getItem('auth_error')).toBeNull();
		}
	});

	it('does not store error for MissingSessionCookie (user may have never logged in)', async () => {
		server.use(
			http.get('/api/test', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 401, brief: 'MissingSessionCookie' }) },
					{ status: 401 }
				);
			})
		);

		const { default: apiClient } = await import('../../../src/api/client');

		await expect(apiClient.get('/test')).rejects.toThrow();
		expect(localStorage.getItem('auth_error')).toBeNull();
	});

	it.each([
		'SessionNotFound',
		'InvalidSessionToken',
		'SessionMismatch',
	])('stores error and calls authFailureCallback for terminal 401: %s', async (brief) => {
		const onAuthFailure = vi.fn();

		server.use(
			http.get('/api/test', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 401, brief }) },
					{ status: 401 }
				);
			})
		);

		const { default: apiClient, setAuthFailureCallback } = await import('../../../src/api/client');
		setAuthFailureCallback(onAuthFailure);

		await expect(apiClient.get('/test')).rejects.toThrow();
		expect(localStorage.getItem('auth_error')).not.toBeNull();
		expect(onAuthFailure).toHaveBeenCalledTimes(1);
	});

	it('stores error and calls authFailureCallback for NeedReauth', async () => {
		const onAuthFailure = vi.fn();

		server.use(
			http.get('/api/test', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 401, brief: 'NeedReauth' }) },
					{ status: 401 }
				);
			})
		);

		const { default: apiClient, setAuthFailureCallback } = await import('../../../src/api/client');
		setAuthFailureCallback(onAuthFailure);

		await expect(apiClient.get('/test')).rejects.toThrow();
		expect(localStorage.getItem('auth_error')).not.toBeNull();
		expect(onAuthFailure).toHaveBeenCalledTimes(1);
	});

	it('stores error and calls authFailureCallback for unknown 401', async () => {
		const onAuthFailure = vi.fn();

		server.use(
			http.get('/api/test', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 401, brief: 'SomethingUnexpected' }) },
					{ status: 401 }
				);
			})
		);

		const { default: apiClient, setAuthFailureCallback } = await import('../../../src/api/client');
		setAuthFailureCallback(onAuthFailure);

		await expect(apiClient.get('/test')).rejects.toThrow();
		expect(localStorage.getItem('auth_error')).not.toBeNull();
		expect(onAuthFailure).toHaveBeenCalledTimes(1);
	});

	it('passes through non-401 errors', async () => {
		server.use(
			http.get('/api/test', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 500, brief: 'InternalError' }) },
					{ status: 500 }
				);
			})
		);

		const { default: apiClient } = await import('../../../src/api/client');

		await expect(apiClient.get('/test')).rejects.toThrow();
		// Non-401 errors should not be stored by the interceptor
		expect(localStorage.getItem('auth_error')).toBeNull();
	});
});
