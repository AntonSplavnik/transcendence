import axios from 'axios';
import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { refreshJWT } from './auth';
import { storeError, getErrorBrief } from './error';

let authFailureCallback: (() => void) | null = null;
export function setAuthFailureCallback(cb: (() => void) | null) {
	authFailureCallback = cb;
}

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
	_retry?: boolean;
	_silent?: boolean;
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
	// Skip error storage for silent requests (initial auth check)
	if (originalRequest._silent) {
		return Promise.reject(error);
	}

	// Network error (status 0 = server unreachable)
	if (!error.response) {
		console.error('Network error:', error);
		storeError(error, 'network_error');
		return Promise.reject(error);
	}

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
				// Only store error for InvalidJwt — MissingJwtCookie failing just means the
				// user wasn't logged in at all, which is not an error worth reporting.
				if (brief === 'InvalidJwt') {
					storeError(refreshError, 'JWT refresh error');
					console.error('JWT refresh failed:', refreshError);
				}
				authFailureCallback?.();
				return Promise.reject(refreshError);
			}
		}

		// Errors expected when user is not logged in (no cookies present)
		// Don't store - ProtectedRoute handles redirect silently
		const silentAuthErrors = [
			'MissingSessionCookie',
			'SessionNotFound',
		];
		if (silentAuthErrors.includes(brief || '')) {
			return Promise.reject(error);
		}

		// User needs to log in again (session is invalid/corrupted)
		const deadSessionErrors = [
			'InvalidSessionToken',
			'SessionMismatch',
		];
		if (deadSessionErrors.includes(brief || '')) {
			storeError(error, 'dead_session');
			return Promise.reject(error);
		}
		if (brief === 'NeedReauth') {
			// User needs to reauthenticate with password
			storeError(error, 'needReauth');
			return Promise.reject(error);
		}
		// Login/2FA errors (user is trying to authenticate)
		if (['InvalidCredentials', 'TwoFactorRequired', 'TwoFactorInvalid'].includes(brief || '')) {
			// Don't store - let component handle
			return Promise.reject(error);
		}
		if (brief === 'DidLogout') {
			console.log('Logged out');
			return Promise.reject(error);
		}
		console.error('unknown 401 error:', error);
		storeError(error, 'unauthorized');
	}
	return Promise.reject(error);
};

apiClient.interceptors.response.use(onFulfilled, onRejected);

export default apiClient;
