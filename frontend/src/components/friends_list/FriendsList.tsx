import React from "react";
import Avatar from "../ui/Avatar";
import Button from "../ui/Button";
import type { Friend } from "./FriendsPanel";

interface FriendsListProps {
	friends: Friend[];
	onRemove: (friendId: number) => void;
}

export default function FriendsList({ friends, onRemove }: FriendsListProps) {
	if (friends.length === 0) {
		return (
			<div className="text-center py-8 text-gray-400">
				<p>No friends yet. Add some friends to get started!</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{friends.map((friend) => (
				<div
					key={friend.id}
					className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors"
				>
					<div className="flex items-center gap-3">
						<div className="relative">
							<Avatar
								nickname={friend.nickname}
								src={friend.avatar_url}
								size="md"
							/>
							{/* Online status indicator */}
							<span
								className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-800 ${
									friend.is_online ? 'bg-green-500' : 'bg-gray-500'
								}`}
								title={friend.is_online ? 'Online' : 'Offline'}
							/>
						</div>
						<div>
							<p className="font-medium text-white">{friend.nickname}</p>
							<p className="text-sm text-gray-400">
								{friend.is_online ? (
									<span className="text-green-400">Online</span>
								) : friend.last_seen ? (
									`Last seen: ${friend.last_seen}`
								) : (
									'Offline'
								)}
							</p>
						</div>
					</div>
					<Button
						variant="secondary"
						onClick={() => {
							if (confirm(`Remove ${friend.nickname} from friends?`)) {
								onRemove(friend.id);
							}
						}}
						className="px-3 py-1.5 text-sm"
					>
						Remove
					</Button>
				</div>
			))}
		</div>
	);
}
