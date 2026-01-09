import type { AxiosError } from 'axios';

/**
 * Standard error response from backend
 */
export interface ApiErrorResponse {
	error?: {
		code?: number;
		name?: string;
		brief?: string;
		detail?: string | null;
	};
}

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
		(error as any).isAxiosError === true
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
		'NeedReauth': 'Your session has expired. Please log in again.',
		'InvalidCredentials': 'Invalid email or password.',
		'MissingJwtCookie': 'Authentication required.',
		'InvalidJwt': 'Your session is invalid.  Please log in again.',
		'SessionNotFound': 'Session not found. Please log in again.',
		'TwoFactorRequired': 'Two-factor authentication is required.',
		'TwoFactorInvalid': 'Invalid two-factor authentication code.',
	};
	return briefMessages[brief] || `Authentication error: ${brief}`;
}

/**
 * Store error in localStorage for display after redirect
 */
export function storeError(error: unknown, fallbackType = 'error'): void {
	const message = getErrorMessage(error);
	const type = isAxiosError(error) && error.response?.data?.error?.brief
		? error.response.data.error.brief
		: fallbackType;

	const errorData: StoredError = {
		type,
		message,
		timestamp: Date.now(),
	};
	localStorage.setItem('auth_error', JSON.stringify(errorData));
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
		// Ignore old errors (older than 1 minute)
		const oneMinuteAgo = Date.now() - 60 * 1000;
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
