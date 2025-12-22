import axios from 'axios';
import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { refreshJWT } from './auth';
import { storeError, getErrorMessage, getErrorBrief, isAxiosError } from './error';

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
		if (brief === 'NeedReauth' && !originalRequest._retry) {
			originalRequest._retry = true;
			try {
				await refreshJWT();
				return apiClient(originalRequest);
			} catch (refreshError) {
				storeError(refreshError, 'session_expired');
				console.error('JWT refresh failed:', refreshError);
				window.location.reload();
				return Promise.reject(refreshError);
			}
		}
		// Other 401 errors (or retry already failed)
		storeError(error, 'unauthorized');
		// window.location.href = '/';
	}
	return Promise.reject(error);
};

apiClient.interceptors.response.use(onFulfilled, onRejected);

export default apiClient;
