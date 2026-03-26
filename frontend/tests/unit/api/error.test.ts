import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	isAxiosError,
	getErrorMessage,
	getErrorBrief,
	storeError,
	retrieveStoredError,
} from '../../../src/api/error';
import {
	createMockAxiosError,
	createMockNetworkError,
	createMockStoredError,
} from '../../fixtures/errors';
import type { InternalAxiosRequestConfig } from 'axios';

describe('error utilities', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	describe('isAxiosError', () => {
		it('returns true for AxiosError', () => {
			const error = createMockAxiosError(400);
			expect(isAxiosError(error)).toBe(true);
		});

		it('returns false for regular Error', () => {
			const error = new Error('test');
			expect(isAxiosError(error)).toBe(false);
		});

		it('returns false for null', () => {
			expect(isAxiosError(null)).toBe(false);
		});

		it('returns false for undefined', () => {
			expect(isAxiosError(undefined)).toBe(false);
		});

		it('returns false for non-object', () => {
			expect(isAxiosError('string')).toBe(false);
			expect(isAxiosError(123)).toBe(false);
		});

		it('returns false for object without isAxiosError property', () => {
			expect(isAxiosError({ message: 'test' })).toBe(false);
		});

		it('returns false for object with isAxiosError set to false', () => {
			expect(isAxiosError({ isAxiosError: false })).toBe(false);
		});
	});

	describe('getErrorMessage', () => {
		it('returns detail from ApiError when available', () => {
			const error = createMockAxiosError(400, {
				detail: 'Detailed error message',
				brief: 'InvalidCredentials',
			});
			expect(getErrorMessage(error)).toBe('Detailed error message');
		});

		it('returns mapped message from brief when no detail', () => {
			const error = createMockAxiosError(401, {
				brief: 'InvalidCredentials',
				detail: undefined,
			});
			expect(getErrorMessage(error)).toBe('Invalid email or password.');
		});

		it('returns unknown brief as-is when no mapped message exists', () => {
			const error = createMockAxiosError(400, {
				name: 'ValidationError',
				brief: 'UnknownBrief',
				detail: undefined,
			});
			expect(getErrorMessage(error)).toBe('UnknownBrief');
		});

		it('returns network error message when no response', () => {
			const error = createMockNetworkError();
			expect(getErrorMessage(error)).toBe(
				'Unable to connect to server.  Please check your connection.'
			);
		});

		it('returns axios error message when no response data', () => {
			const error = createMockAxiosError(500);
			error.response = { status: 500, statusText: 'Error', headers: {}, config: {} as InternalAxiosRequestConfig, data: {} };
			expect(getErrorMessage(error)).toBe('Request failed with status code 500');
		});

		it('returns regular error message for Error instances', () => {
			const error = new Error('Test error message');
			expect(getErrorMessage(error)).toBe('Test error message');
		});

		it('returns fallback for unknown error types', () => {
			expect(getErrorMessage('string error')).toBe('An unexpected error occurred');
			expect(getErrorMessage(null)).toBe('An unexpected error occurred');
		});

		it('uses custom fallback when provided', () => {
			expect(getErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
		});

		describe('brief code mapping', () => {
			const briefMappings = [
				['MissingSessionCookie', 'Session expired. Please log in again.'],
				['InvalidSessionToken', 'Invalid session.  Please log in again.'],
				['SessionNotFound', 'Session not found. Please log in again.'],
				['SessionMismatch', 'Session mismatch. Please log in properly.'],
				['NeedReauth', 'Your session has expired. Please reauthenticate.'],
				['MissingJwtCookie', 'Authentication required. Please log in.'],
				['InvalidJwt', 'Your session is invalid. Please log in again.'],
				['InvalidCredentials', 'Invalid email or password.'],
				['TwoFactorRequired', 'Two-factor authentication code is required.'],
				['TwoFactorInvalid', 'Invalid two-factor authentication code.'],
				['DidLogout', 'You have been logged out successfully.'],
			] as const;

			briefMappings.forEach(([brief, expected]) => {
				it(`maps ${brief} correctly`, () => {
					const error = createMockAxiosError(401, { brief, detail: undefined });
					expect(getErrorMessage(error)).toBe(expected);
				});
			});
		});
	});

	describe('getErrorBrief', () => {
		it('returns brief from AxiosError', () => {
			const error = createMockAxiosError(401, { brief: 'InvalidCredentials' });
			expect(getErrorBrief(error)).toBe('InvalidCredentials');
		});

		it('returns undefined for network error', () => {
			const error = createMockNetworkError();
			expect(getErrorBrief(error)).toBeUndefined();
		});

		it('returns undefined for regular Error', () => {
			const error = new Error('test');
			expect(getErrorBrief(error)).toBeUndefined();
		});

		it('returns undefined for null', () => {
			expect(getErrorBrief(null)).toBeUndefined();
		});
	});

	describe('storeError', () => {
		it('stores error with message and type from AxiosError', () => {
			const error = createMockAxiosError(401, {
				brief: 'InvalidCredentials',
				detail: 'Invalid email or password',
			});
			storeError(error);

			const stored = JSON.parse(localStorage.getItem('auth_error') || '{}');
			expect(stored.type).toBe('InvalidCredentials');
			expect(stored.message).toBe('Invalid email or password');
			expect(stored.timestamp).toBeDefined();
		});

		it('uses fallback type when no brief in error', () => {
			const error = new Error('Test error');
			storeError(error, 'custom_type');

			const stored = JSON.parse(localStorage.getItem('auth_error') || '{}');
			expect(stored.type).toBe('custom_type');
		});

		it('uses default fallback type', () => {
			const error = new Error('Test error');
			storeError(error);

			const stored = JSON.parse(localStorage.getItem('auth_error') || '{}');
			expect(stored.type).toBe('error');
		});

		it('includes timestamp', () => {
			const before = Date.now();
			storeError(new Error('test'));
			const after = Date.now();

			const stored = JSON.parse(localStorage.getItem('auth_error') || '{}');
			expect(stored.timestamp).toBeGreaterThanOrEqual(before);
			expect(stored.timestamp).toBeLessThanOrEqual(after);
		});
	});

	describe('retrieveStoredError', () => {
		it('returns null when no error stored', () => {
			expect(retrieveStoredError()).toBeNull();
		});

		it('returns stored error and removes from localStorage', () => {
			const mockError = createMockStoredError({
				type: 'test_error',
				message: 'Test message',
			});
			localStorage.setItem('auth_error', JSON.stringify(mockError));

			const result = retrieveStoredError();

			expect(result).toEqual(mockError);
			expect(localStorage.getItem('auth_error')).toBeNull();
		});

		it('returns null for expired errors (older than 1 minute)', () => {
			const oldError = createMockStoredError({
				timestamp: Date.now() - 2 * 60 * 1000, // 2 minutes ago
			});
			localStorage.setItem('auth_error', JSON.stringify(oldError));

			expect(retrieveStoredError()).toBeNull();
			expect(localStorage.getItem('auth_error')).toBeNull();
		});

		it('returns error within 1 minute window', () => {
			const recentError = createMockStoredError({
				timestamp: Date.now() - 30 * 1000, // 30 seconds ago
			});
			localStorage.setItem('auth_error', JSON.stringify(recentError));

			expect(retrieveStoredError()).not.toBeNull();
		});

		it('returns null and clears invalid JSON', () => {
			localStorage.setItem('auth_error', 'invalid json');

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			expect(retrieveStoredError()).toBeNull();
			expect(localStorage.getItem('auth_error')).toBeNull();
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});
	});
});
