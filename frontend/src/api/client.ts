import axios from 'axios';
import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
// import { refreshJWT } from "../api/auth";

// import axios, { type AxiosRequestConfig, type AxiosResponse, type AxiosError, InternalAxiosRequestConfig } from 'axios';

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

const onRejected = async (error: AxiosError): Promise<AxiosResponse> => {
	const originalRequest = error.config as CustomAxiosRequestConfig | undefined;
	if (!originalRequest) {
		return Promise.reject(error);
	}
	if (error.response?.status === 401 && !originalRequest._retry) {
		originalRequest._retry = true;
		try {
			// refreshJWT();
			await axios.post('api/auth/session-management/refresh-jwt', {}, {
				withCredentials: true,
			});
			return apiClient(originalRequest);
		} catch (refreshjwtError) {
			localStorage.setItem('auth_error', JSON.stringify({
				type: 'session_expired',
				message: 'Your session has expired. Please log in again.',
				timestamp: Date.now(),
			}));
			console.error('JWT refresh failed:', refreshjwtError);
			window.location.href = '/';
			return Promise.reject(refreshjwtError);
		}
	}
	if (error.response?.status === 401) {
		window.location.href = '/';
	}
	return (Promise.reject(error));
};

apiClient.interceptors.response.use(onFullfilled, onRejected);

export default apiClient;
