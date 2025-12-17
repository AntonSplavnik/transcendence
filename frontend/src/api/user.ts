import apiClient from './client';

export async function userMe() {
	await apiClient.post('api/user/me', {}, {
		withCredentials: true,
	});
}
