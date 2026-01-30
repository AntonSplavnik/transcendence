import apiClient from './client';
import type {
	AuthResponse
} from './types';


/**
 * Get current user info (requires authentication)
 * @returns User session info including user data, session details, and stats
 */
export async function getMe(): Promise<AuthResponse> {
	const response = await apiClient.get<AuthResponse>('/user/me');
	return response.data;
}
