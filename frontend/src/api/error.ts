import type { AxiosError } from 'axios';
import type { ApiErrorResponse } from './types';

const MAX_STORED_ERROR_AGE_MS = 60_000; // Don't show stored errors older than 1 minute

/**
 * Stored error info for displaying after redirect
 */
export interface StoredError {
	type: string;
	message: string;
	timestamp: number;
}

/**
 * Check if error is an AxiosError
 */
export function isAxiosError(error: unknown): error is AxiosError<ApiErrorResponse> {
	return (
		typeof error === 'object' &&
		error !== null &&
		'isAxiosError' in error &&
		(error as { isAxiosError: boolean }).isAxiosError === true
	);
}

/**
 * Extract user-friendly error message from any error
 */
export function getErrorMessage(error: unknown, fallback = 'An unexpected error occurred'): string {
	if (isAxiosError(error)) {
		// No response = network error
		if (error.request && !error.response) {
			return 'Unable to connect to server.  Please check your connection.';
		}
		if (error.response?.data?.error) {
			const errorData = error.response.data.error;
			if (errorData.detail) {
				return errorData.detail;
			}
			if (errorData.brief) {
				return getMessageFromBrief(errorData.brief);
			}
			if (errorData.name) {
				return errorData.name;
			}
		}
		if (error.message) {
			return error.message;
		}
	}
	if (error instanceof Error) {
		return error.message;
	}
	return fallback;
}

/**
 * Convert backend brief codes to user-friendly messages
 */
function getMessageFromBrief(brief: string): string {
	const briefMessages: Record<string, string> = {
		// Session/Auth errors
		MissingSessionCookie: 'Session expired. Please log in again.',
		InvalidSessionToken: 'Invalid session.  Please log in again.',
		SessionNotFound: 'Session not found. Please log in again.',
		SessionMismatch: 'Session mismatch. Please log in properly.',
		NeedReauth: 'Your session has expired. Please reauthenticate.',

		// JWT errors (shouldn't normally see these - interceptor handles them)
		MissingJwtCookie: 'Authentication required. Please log in.',
		InvalidJwt: 'Your session is invalid. Please log in again.',

		// Login errors
		InvalidCredentials: 'Invalid email or password.',

		// 2FA errors
		TwoFactorRequired: 'Two-factor authentication code is required.',
		TwoFactorInvalid: 'Invalid two-factor authentication code.',

		// Success messages
		DidLogout: 'You have been logged out successfully.',

		// Friend errors
		'SelfRequest': 'You cannot add yourself as a friend.',
		'DuplicateRequest': 'A friend request already exists with this user.',
		'AlreadyFriends': 'You are already friends with this user.',
		'UserNotFound': 'User not found.',
		'NotFriends': 'You are not friends with this user.',
		'RequestNotFound': 'Friend request not found.',
		'TooManyPending': 'Too many pending requests. Try again later.',
		'RequestNotPending': 'This friend request is no longer pending.',
		'NotAuthorized': 'You are not authorized to perform this action.',
		'InvalidParam': 'Invalid request parameter.',
	};
	return briefMessages[brief] || `Authentication error: ${brief}`;
}

/**
 * Store error in localStorage for display after redirect
 */
export function storeError(error: unknown, fallbackType = 'error'): void {
	const message = getErrorMessage(error);
	const type =
		isAxiosError(error) && error.response?.data?.error?.brief
			? error.response.data.error.brief
			: fallbackType;

	const errorData: StoredError = {
		type,
		message,
		timestamp: Date.now(),
	};
	localStorage.setItem('auth_error', JSON.stringify(errorData));
	window.dispatchEvent(new Event('auth-error-stored'));
}

/**
 * Retrieve and clear stored error from localStorage
 */
export function retrieveStoredError(): StoredError | null {
	const stored = localStorage.getItem('auth_error');
	if (!stored) {
		return null;
	}
	try {
		const error = JSON.parse(stored) as StoredError;
		localStorage.removeItem('auth_error');
		const oneMinuteAgo = Date.now() - MAX_STORED_ERROR_AGE_MS;
		if (error.timestamp < oneMinuteAgo) {
			return null;
		}
		return error;
	} catch (e) {
		console.error('Failed to parse stored error:', e);
		localStorage.removeItem('auth_error');
		return null;
	}
}

/**
 * Get error brief code from backend response
 */
export function getErrorBrief(error: unknown): string | undefined {
	if (isAxiosError(error)) {
		return error.response?.data?.error?.brief;
	}
	return undefined;
}
