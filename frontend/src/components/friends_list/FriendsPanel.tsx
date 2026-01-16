import React, { useState, useEffect } from "react";
import FriendsList from "./FriendsList";
import FriendRequests from "./FriendRequests";
import UserSearch from "../friends_list/UserSearch";
import Card from "../ui/Card";

export interface Friend {
	id: number;
	nickname: string;
	avatar_url: string | null;
	is_online: boolean;
	last_seen: string | null;
}

export interface FriendRequest {
	id: number;
	from_user_id: number;
	from_nickname: string;
	from_avatar_url: string | null;
	created_at: string;
}

export default function FriendsPanel() {
	const [friends, setFriends] = useState<Friend[]>([]);
	const [requests, setRequests] = useState<FriendRequest[]>([]);
	const [loading, setLoading] = useState(true);
	const [activeTab, setActiveTab] = useState<'friends' | 'requests' | 'search'>('friends');

	useEffect(() => {
		fetchFriends();
		fetchRequests();
	}, []);

	const fetchFriends = async () => {
		try {
			const response = await fetch('/api/friends/list', {
				credentials: 'include',
			});
			if (response.ok) {
				const data = await response.json();
				setFriends(data);
			}
		} catch (error) {
			console.error('Failed to fetch friends:', error);
		} finally {
			setLoading(false);
		}
	};

	const fetchRequests = async () => {
		try {
			const response = await fetch('/api/friends/requests', {
				credentials: 'include',
			});
			if (response.ok) {
				const data = await response.json();
				setRequests(data);
			}
		} catch (error) {
			console.error('Failed to fetch friend requests:', error);
		}
	};

	const handleAcceptRequest = async (requestId: number) => {
		try {
			const response = await fetch(`/api/friends/accept/${requestId}`, {
				method: 'POST',
				credentials: 'include',
			});
			if (response.ok) {
				// Refresh both lists
				fetchFriends();
				fetchRequests();
			}
		} catch (error) {
			console.error('Failed to accept friend request:', error);
		}
	};

	const handleDeclineRequest = async (requestId: number) => {
		try {
			const response = await fetch(`/api/friends/decline/${requestId}`, {
				method: 'POST',
				credentials: 'include',
			});
			if (response.ok) {
				fetchRequests();
			}
		} catch (error) {
			console.error('Failed to decline friend request:', error);
		}
	};

	const handleRemoveFriend = async (friendId: number) => {
		try {
			const response = await fetch(`/api/friends/remove/${friendId}`, {
				method: 'DELETE',
				credentials: 'include',
			});
			if (response.ok) {
				fetchFriends();
			}
		} catch (error) {
			console.error('Failed to remove friend:', error);
		}
	};

	const handleSendRequest = async (userId: number) => {
		try {
			const response = await fetch('/api/friends/request', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				credentials: 'include',
				body: JSON.stringify({ to_user_id: userId }),
			});
			if (response.ok) {
				// Could show a success message
				return true;
			}
			return false;
		} catch (error) {
			console.error('Failed to send friend request:', error);
			return false;
		}
	};

	return (
		<Card>
			<div className="p-6">
				<h2 className="text-2xl font-bold text-primary mb-4">Friends</h2>

				{/* Tabs */}
				<div className="flex gap-2 mb-6 border-b border-gray-700">
					<button
						onClick={() => setActiveTab('friends')}
						className={`px-4 py-2 font-medium transition-colors ${
							activeTab === 'friends'
								? 'text-primary border-b-2 border-primary'
								: 'text-gray-400 hover:text-gray-200'
						}`}
					>
						Friends ({friends.length})
					</button>
					<button
						onClick={() => setActiveTab('requests')}
						className={`px-4 py-2 font-medium transition-colors relative ${
							activeTab === 'requests'
								? 'text-primary border-b-2 border-primary'
								: 'text-gray-400 hover:text-gray-200'
						}`}
					>
						Requests
						{requests.length > 0 && (
							<span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
								{requests.length}
							</span>
						)}
					</button>
					<button
						onClick={() => setActiveTab('search')}
						className={`px-4 py-2 font-medium transition-colors ${
							activeTab === 'search'
								? 'text-primary border-b-2 border-primary'
								: 'text-gray-400 hover:text-gray-200'
						}`}
					>
						Add Friend
					</button>
				</div>

				{/* Content */}
				{loading ? (
					<div className="text-center py-8 text-gray-400">Loading...</div>
				) : (
					<>
						{activeTab === 'friends' && (
							<FriendsList 
								friends={friends} 
								onRemove={handleRemoveFriend}
							/>
						)}
						{activeTab === 'requests' && (
							<FriendRequests 
								requests={requests}
								onAccept={handleAcceptRequest}
								onDecline={handleDeclineRequest}
							/>
						)}
						{activeTab === 'search' && (
							<UserSearch onSendRequest={handleSendRequest} />
						)}
					</>
				)}
			</div>
		</Card>
	);
}
