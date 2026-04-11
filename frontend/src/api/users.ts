import apiClient from './client';

export async function nicknameExists(nickname: string): Promise<string> {
	try {
		const response = await apiClient.post<{ exists: boolean; valid: boolean }>(
			'users/nickname-exists',
			nickname,
			{
				headers: {
					'Content-Type': 'application/json',
				},
			},
		);
		const data = response.data;
		if (typeof data.exists !== 'boolean' || typeof data.valid !== 'boolean') {
			return 'Unexpected server response';
		}
		if (data.exists) {
			return '❌ nickname already taken';
		} else if (!data.valid) {
			return '❌ nickname format invalid';
		}
		return '✅';
	} catch (error) {
		console.warn('Nickname validation error:', error);
		return 'Error checking nickname';
	}
}
