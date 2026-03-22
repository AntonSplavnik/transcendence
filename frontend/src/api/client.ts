import axios from 'axios';
import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { refreshJWT } from './auth';
import { getErrorBrief, getErrorMessage, storeError } from './error';

let authFailureCallback: (() => void) | null = null;
export function setAuthFailureCallback(cb: (() => void) | null) {
	authFailureCallback = cb;
}

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
	_retry?: boolean;
}

const apiClient = axios.create({
	baseURL: '/api',
	withCredentials: true,
});

/**
 * Success handler - pass response through
 */
const onFulfilled = (response: AxiosResponse): AxiosResponse => {
	return response;
};

/**
 * Error handler - handles 401 errors and JWT refresh
 */
const onRejected = async (error: AxiosError): Promise<AxiosResponse> => {
	const originalRequest = error.config as CustomAxiosRequestConfig | undefined;

	if (!originalRequest) {
		return Promise.reject(error);
	}
	// Network error (status 0 = server unreachable)
	if (!error.response) {
		console.error('Network error:', error);
		storeError(error, 'network_error');
		return Promise.reject(error);
	}

	// Replace Axios's generic "Request failed with status code XXX" with the backend brief
	error.message = getErrorMessage(error);

	// Handle 401 Unauthorized errors
	if (error.response.status === 401) {
		const brief = getErrorBrief(error);

		// Try automatic JWT refresh when JWT is expired or missing (but session cookie may still be valid)
		// MissingJwtCookie: browser dropped the expired JWT cookie (normal 15-min expiry)
		// InvalidJwt: JWT cookie is present but rejected (e.g. corrupted or clock skew)
		const canRefresh = ['InvalidJwt', 'MissingJwtCookie'].includes(brief || '');
		if (canRefresh && !originalRequest._retry) {
			originalRequest._retry = true;
			try {
				await refreshJWT();
				return apiClient(originalRequest);
			} catch (refreshError) {
				// Non-401 refresh failures (429, 500, network): session is still valid,
				// the refresh just failed transiently. Show a banner but keep auth state.
				if (
					!axios.isAxiosError(refreshError) ||
					!refreshError.response ||
					refreshError.response.status !== 401
				) {
					if (axios.isAxiosError(refreshError) && refreshError.response) {
						storeError(refreshError, 'refresh_failed');
						console.log('JWT refresh failed:', refreshError);
					}
					return Promise.reject(refreshError);
				}
				// 401: session is gone. The interceptor already classified the refresh
				// response (SessionNotFound → stored, NeedReauth → stored, etc.) and
				// called authFailureCallback. Call it here as a safety net.
				authFailureCallback?.();
				return Promise.reject(refreshError);
			}
		}

		// No session cookie — ambiguous: could be fresh user or 30-day expiry.
		// Initial auth check (getMe on mount) hits this for users who were never
		// logged in, so we must stay silent to avoid a spurious error banner.
		if (brief === 'MissingSessionCookie') {
			return Promise.reject(error);
		}

		// Login/2FA errors — component shows inline feedback, not a banner
		if (['InvalidCredentials', 'TwoFactorRequired', 'TwoFactorInvalid'].includes(brief || '')) {
			return Promise.reject(error);
		}
		if (brief === 'DidLogout') {
			console.log('Logged out');
			return Promise.reject(error);
		}

		// --- Terminal 401s: store error, clear auth, redirect to login ---

		const deadSessionErrors = [
			'SessionNotFound', // session deleted (by user, or oldest-session eviction)
			'InvalidSessionToken', // session cookie corrupted
			'SessionMismatch', // JWT references wrong session
		];
		if (deadSessionErrors.includes(brief || '')) {
			storeError(error, 'dead_session');
			authFailureCallback?.();
			return Promise.reject(error);
		}
		if (brief === 'NeedReauth') {
			storeError(error, 'needReauth');
			authFailureCallback?.();
			return Promise.reject(error);
		}
		// Unknown 401 — shouldn't happen, but don't leave user stranded
		console.log('unknown 401 error:', error);
		storeError(error, 'unauthorized');
		authFailureCallback?.();
	}
	return Promise.reject(error);
};

apiClient.interceptors.response.use(onFulfilled, onRejected);

export default apiClient;
