import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/msw-handlers';
import { createMockApiError } from '../../fixtures/errors';
import type { AxiosRequestConfig } from 'axios';

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

	it('attempts JWT refresh on InvalidJwt error', async () => {
		let refreshCalled = false;
		let retryCalled = false;

		server.use(
			http.get('/api/protected', () => {
				if (!retryCalled) {
					retryCalled = true;
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief: 'InvalidJwt' }) },
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

	it('does not store errors for silent requests', async () => {
		server.use(
			http.get('/api/silent-test', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 401, brief: 'InvalidSessionToken' }) },
					{ status: 401 }
				);
			})
		);

		const { default: apiClient } = await import('../../../src/api/client');

		await expect(
			apiClient.get('/silent-test', { _silent: true } as AxiosRequestConfig & { _silent?: boolean })
		).rejects.toThrow();

		expect(localStorage.getItem('auth_error')).toBeNull();
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

	it('does not store error for silent auth errors', async () => {
		const silentBriefs = ['MissingSessionCookie', 'SessionNotFound'];

		for (const brief of silentBriefs) {
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
