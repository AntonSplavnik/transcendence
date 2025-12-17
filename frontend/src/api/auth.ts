import apiClient from './client';

export async function login(email: string, password: string) {
	await apiClient.post('/auth/login', { email, password });
}

export async function register(nickname: string, email: string, password: string) {
	await apiClient.post('/auth/register', { nickname, email, password });
}

export async function logout() {
	await apiClient.post('/auth/logout');
	window.location.href = '/';
}

export async function refreshJWT() {
	await apiClient.post('/auth/session-management/refresh-jwt');
}
