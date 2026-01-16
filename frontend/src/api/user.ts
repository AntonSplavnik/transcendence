import apiClient from './client';
import type {
	UserSessionInfo
} from './types';


/**
 * Get current user info (requires authentication)
 * @returns User session info including user data, session details, and stats
 */
export async function getMe(): Promise<UserSessionInfo> {
	const response = await apiClient.get<UserSessionInfo>('/user/me');
	return response.data;
}
