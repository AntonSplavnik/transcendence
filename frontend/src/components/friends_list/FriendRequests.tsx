import React from "react";
import Avatar from "./../ui/Avatar";
import Button from "./../ui/Button";
import type { FriendRequest } from "./FriendsPanel";

interface FriendRequestsProps {
	requests: FriendRequest[];
	onAccept: (requestId: number) => void;
	onDecline: (requestId: number) => void;
}

export default function FriendRequests({ requests, onAccept, onDecline }: FriendRequestsProps) {
	if (requests.length === 0) {
		return (
			<div className="text-center py-8 text-gray-400">
				<p>No pending friend requests</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{requests.map((request) => (
				<div
					key={request.id}
					className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors"
				>
					<div className="flex items-center gap-3">
						<Avatar
							nickname={request.from_nickname}
							src={request.from_avatar_url}
							size="md"
						/>
						<div>
							<p className="font-medium text-white">{request.from_nickname}</p>
							<p className="text-sm text-gray-400">
								Sent {new Date(request.created_at).toLocaleDateString()}
							</p>
						</div>
					</div>
					<div className="flex gap-1.5">
						<Button
							variant="primary"
							onClick={() => onAccept(request.id)}
							className="px-3 py-1.5 text-sm"
						>
							Accept
						</Button>
						<Button
							variant="danger"
							onClick={() => onDecline(request.id)}
							className="px-3 py-1.5 text-sm"
						>
							Decline
						</Button>
					</div>
				</div>
			))}
		</div>
	);
}
