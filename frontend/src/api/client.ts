import axios from 'axios';
import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { refreshJWT } from './auth';
import { storeError, getErrorBrief } from './error';

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
		return Promise.reject(error);
	}

	// Handle 401 Unauthorized errors
	if (error.response.status === 401) {
		const brief = getErrorBrief(error);
		// User needs to log in again
		if (brief === 'MissingSessionCookie'
			|| brief === 'InvalidSessionToken'
			|| brief === 'SessionNotFound'
			|| brief === 'SessionMismatch')
			return Promise.reject(error);
		if (brief === 'NeedReauth') {
			// User needs to reauthenticate with password
			storeError(error, 'needReauth');
			return Promise.reject(error);
		}
		if ((brief === 'InvalidJWT' || brief == 'MissingJWTCookie') && !originalRequest._retry) {
			originalRequest._retry = true;
			try {
				await refreshJWT();
				return apiClient(originalRequest);
			} catch (refreshError) {
				storeError(refreshError, 'JWT refresh error');
				console.error('JWT refresh failed:', refreshError);
				window.location.reload();
				return Promise.reject(refreshError);
			}
		}
		// Other 401 errors (or retry already failed)
		storeError(error, 'unauthorized');
	}
	return Promise.reject(error);
};

apiClient.interceptors.response.use(onFulfilled, onRejected);

export default apiClient;
