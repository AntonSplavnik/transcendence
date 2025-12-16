import axios from 'axios';
import type { AxiosResponse } from 'axios';
import type { AxiosError } from 'axios';

// import axios, { type AxiosRequestConfig, type AxiosResponse, type AxiosError, InternalAxiosRequestConfig } from 'axios';

const apiClient = axios.create({
	baseURL: '/api',
	withCredentials: true,
});

const onFullfilled = (response: AxiosResponse): AxiosResponse => {
	return response;
}

const onRejected = async (error: AxiosError): Promise<AxiosResponse> => {
	const originalRequest = error.config;
	if (error.response?.status === 401 && !originalRequest._retry) {
		originalRequest._retry = true;
		try {
			await axios.post('api/auth/session-management/reresh-jwt', {}, {
				withCredentials: true,
			});
			return apiClient(originalRequest);
		} catch (refreshjwtError) {
			//TODO: this is critical, i am returning the user to home, but I still need to display a message.
			// need to move the sending of the user to homme somewhere else to control showing the message
			window.location.href = '/';
			return Promise.reject(refreshjwtError);
		}
	}
	if (error.response?.status === 401) {
		window.location.href = '/';
	}
	return (Promise.reject(error));
};

apiClient.interceptors.request.use(onFullfilled, onRejected);
