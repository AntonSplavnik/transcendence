import apiClient from './client';
import type { PublicUser, FriendRequestResponse } from './types';

export async function getFriends(): Promise<PublicUser[]> {
	const response = await apiClient.get<PublicUser[]>('/friends');
	return response.data;
}

export async function removeFriend(userId: number): Promise<void> {
	await apiClient.delete(`/friends/remove/${userId}`);
}

export async function sendFriendRequest(nickname: string): Promise<FriendRequestResponse> {
	const response = await apiClient.post<FriendRequestResponse>('/friends/request', { nickname });
	return response.data;
}

export async function cancelFriendRequest(requestId: number): Promise<void> {
	await apiClient.delete(`/friends/request/${requestId}`);
}

export async function acceptFriendRequest(requestId: number): Promise<FriendRequestResponse> {
	const response = await apiClient.post<FriendRequestResponse>(`/friends/accept/${requestId}`);
	return response.data;
}

export async function rejectFriendRequest(requestId: number): Promise<void> {
	await apiClient.post(`/friends/reject/${requestId}`);
}

export async function getIncomingRequests(): Promise<FriendRequestResponse[]> {
	const response = await apiClient.get<FriendRequestResponse[]>('/friends/requests/incoming');
	return response.data;
}

export async function getOutgoingRequests(): Promise<FriendRequestResponse[]> {
	const response = await apiClient.get<FriendRequestResponse[]>('/friends/requests/outgoing');
	return response.data;
}
