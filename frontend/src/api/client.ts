import axios from 'axios';
import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { refreshJWT } from "../api/auth";

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
	_retry?: boolean;
}

const apiClient = axios.create({
	baseURL: '/api',
	withCredentials: true,
});

const onFullfilled = (response: AxiosResponse): AxiosResponse => {
	return response;
}

const onRejected = async (error: AxiosError<{ brief?: string }>): Promise<AxiosResponse> => {
	const originalRequest = error.config as CustomAxiosRequestConfig | undefined;

	if (!originalRequest) {
		return Promise.reject(error);
	}

	// a status of 0 indicates a network error, often due to the server being unreachable
	if (error.response?.status === 0) {
		localStorage.setItem('auth_error', JSON.stringify({
			type: 'network_error',
			message: 'The server is unreachable. Please try again later.',
			timestamp: Date.now(),
		}));
		console.error('Network error:', error);
		// We don't redirect here, as the user might be offline and we don't want to
		// lose the current state. The App will show the error message.
		return Promise.reject(error);
	}

	if (error.response?.status === 401 && error.response?.data?.brief === 'NeedReauth' && !originalRequest._retry) {
		originalRequest._retry = true;
		try {
			await refreshJWT();
			return apiClient(originalRequest);
		} catch (refreshjwtError) {
			localStorage.setItem('auth_error', JSON.stringify({
				type: 'session_expired',
				message: 'Your session has expired. Please log in again.',
				timestamp: Date.now(),
			}));
			console.error('JWT refresh failed:', refreshjwtError);
			window.location.href = '/'; // Force reload to show landing page
			return Promise.reject(refreshjwtError);
		}
	}

	// For other 401 errors or if retry fails, redirect to login
	if (error.response?.status === 401) {
		localStorage.setItem('auth_error', JSON.stringify({
			type: 'unauthorized',
			message: 'You are not authorized. Please log in.',
			timestamp: Date.now(),
		}));
		window.location.href = '/'; // Force reload to show landing page
	}

	return Promise.reject(error);
};

apiClient.interceptors.response.use(onFullfilled, onRejected);

export default apiClient;
