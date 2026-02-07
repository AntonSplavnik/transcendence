import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../../src/contexts/AuthContext';
import { server, mockUnauthenticatedUser, mockLoginFailure } from '../../helpers/msw-handlers';
import { createMockUser, createMockSession, createMockAuthResponse } from '../../fixtures/users';
import { http, HttpResponse } from 'msw';
import { createMockApiError } from '../../fixtures/errors';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
	<AuthProvider>{children}</AuthProvider>
);

describe('AuthContext', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('initial state', () => {
		it('starts with authChecked=false and user=null', () => {
			mockUnauthenticatedUser();

			const { result } = renderHook(() => useAuth(), { wrapper });

			// Initial state before async check completes
			expect(result.current.user).toBeNull();
			expect(result.current.session).toBeNull();
		});

		it('performs auth check on mount via /user/me', async () => {
			const mockAuth = createMockAuthResponse();
			server.use(
				http.get('/api/user/me', () => {
					return HttpResponse.json(mockAuth);
				})
			);

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.authChecked).toBe(true);
			});

			expect(result.current.user).toEqual(mockAuth.user);
			expect(result.current.session).toEqual(mockAuth.session);
		});

		it('clears auth on failed initial check', async () => {
			mockUnauthenticatedUser();

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.authChecked).toBe(true);
			});

			expect(result.current.user).toBeNull();
			expect(result.current.session).toBeNull();
		});
	});

	describe('login', () => {
		it('sets user and session on successful login', async () => {
			mockUnauthenticatedUser();
			const mockAuth = createMockAuthResponse();

			server.use(
				http.post('/api/auth/login', () => {
					return HttpResponse.json(mockAuth);
				})
			);

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.authChecked).toBe(true);
			});

			await act(async () => {
				await result.current.login('test@example.com', 'password');
			});

			expect(result.current.user).toEqual(mockAuth.user);
			expect(result.current.session).toEqual(mockAuth.session);
		});

		it('throws and leaves state unchanged on failed login', async () => {
			mockUnauthenticatedUser();
			mockLoginFailure('InvalidCredentials');

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.authChecked).toBe(true);
			});

			await expect(
				act(async () => {
					await result.current.login('wrong@example.com', 'wrong');
				})
			).rejects.toThrow();

			expect(result.current.user).toBeNull();
		});

	});

	describe('register', () => {
		it('sets user and session on successful registration', async () => {
			mockUnauthenticatedUser();
			const mockAuth = createMockAuthResponse();

			server.use(
				http.post('/api/auth/register', () => {
					return HttpResponse.json(mockAuth);
				})
			);

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.authChecked).toBe(true);
			});

			await act(async () => {
				await result.current.register('TestUser', 'test@example.com', 'password');
			});

			expect(result.current.user).toEqual(mockAuth.user);
			expect(result.current.session).toEqual(mockAuth.session);
		});
	});

	describe('logout', () => {
		it('clears user and session on successful logout', async () => {
			const mockAuth = createMockAuthResponse();
			server.use(
				http.get('/api/user/me', () => HttpResponse.json(mockAuth)),
				http.post('/api/user/logout', () => new HttpResponse(null, { status: 204 }))
			);

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.user).not.toBeNull();
			});

			await act(async () => {
				await result.current.logout();
			});

			expect(result.current.user).toBeNull();
			expect(result.current.session).toBeNull();
		});

		it('clears state even when API call fails', async () => {
			const mockAuth = createMockAuthResponse();
			server.use(
				http.get('/api/user/me', () => HttpResponse.json(mockAuth)),
				http.post('/api/user/logout', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 500 }) },
						{ status: 500 }
					);
				})
			);

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.user).not.toBeNull();
			});

			await act(async () => {
				await result.current.logout();
			});

			// State should still be cleared
			expect(result.current.user).toBeNull();
			expect(result.current.session).toBeNull();
		});
	});

	describe('reauth', () => {
		it('updates user and session on successful reauth', async () => {
			const initialAuth = createMockAuthResponse();
			const updatedAuth = createMockAuthResponse(
				{ nickname: 'UpdatedUser' },
				{ access_expiry: new Date(Date.now() + 900000).toISOString() }
			);

			server.use(
				http.get('/api/user/me', () => HttpResponse.json(initialAuth)),
				http.post('/api/auth/session-management/reauth', () => HttpResponse.json(updatedAuth))
			);

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.user).not.toBeNull();
			});

			await act(async () => {
				await result.current.reauth('password');
			});

			expect(result.current.session?.access_expiry).toBe(updatedAuth.session.access_expiry);
		});

		it('supports optional MFA code', async () => {
			const mockAuth = createMockAuthResponse();
			let receivedMfaCode: string | undefined;

			server.use(
				http.get('/api/user/me', () => HttpResponse.json(mockAuth)),
				http.post('/api/auth/session-management/reauth', async ({ request }) => {
					const body = await request.json() as any;
					receivedMfaCode = body.mfa_code;
					return HttpResponse.json(mockAuth);
				})
			);

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.user).not.toBeNull();
			});

			await act(async () => {
				await result.current.reauth('password', '123456');
			});

			expect(receivedMfaCode).toBe('123456');
		});
	});

	describe('refreshUser', () => {
		it('updates user data from server', async () => {
			const initialAuth = createMockAuthResponse();
			const updatedUser = createMockUser({ nickname: 'UpdatedNickname', totp_enabled: true });

			let callCount = 0;
			server.use(
				http.get('/api/user/me', () => {
					callCount++;
					if (callCount === 1) {
						return HttpResponse.json(initialAuth);
					}
					return HttpResponse.json({ user: updatedUser, session: initialAuth.session });
				})
			);

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.user?.nickname).toBe('TestUser');
			});

			await act(async () => {
				await result.current.refreshUser();
			});

			expect(result.current.user?.nickname).toBe('UpdatedNickname');
			expect(result.current.user?.totp_enabled).toBe(true);
		});
	});

	describe('clearAuth', () => {
		it('sets user and session to null', async () => {
			const mockAuth = createMockAuthResponse();
			server.use(
				http.get('/api/user/me', () => HttpResponse.json(mockAuth))
			);

			const { result } = renderHook(() => useAuth(), { wrapper });

			await waitFor(() => {
				expect(result.current.user).not.toBeNull();
			});

			act(() => {
				result.current.clearAuth();
			});

			expect(result.current.user).toBeNull();
			expect(result.current.session).toBeNull();
		});
	});

	describe('useAuth hook', () => {
		it('throws when used outside AuthProvider', () => {
			// Suppress console.error for this test
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(() => {
				renderHook(() => useAuth());
			}).toThrow('useAuth must be used within an AuthProvider');

			consoleSpy.mockRestore();
		});
	});
});
