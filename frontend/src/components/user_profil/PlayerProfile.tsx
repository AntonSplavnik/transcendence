import React, { useState } from "react";
import Button from "./../ui/Button";
import Avatar from "./../ui/Avatar";
import ProfileEdit from "./ProfileEdit";

interface User {
	id: number;
	nickname: string;
	email: string;
	avatar_url?: string | null;
}

interface PlayerProfileProps {
	user: User;
	onLogout: () => void;
	onProfileUpdate: () => void;
	isLoggingOut?: boolean;
}

/**
 * Player profile section with avatar, name, and edit/logout buttons
 */
export default function PlayerProfile({ user, onLogout, onProfileUpdate, isLoggingOut = false }: PlayerProfileProps) {
	const [showEditModal, setShowEditModal] = useState(false);

	return (
		<>
			{/* Profile Edit Modal */}
			{showEditModal && (
				<ProfileEdit
					user={user}
					onClose={() => setShowEditModal(false)}
					onSuccess={() => {
						setShowEditModal(false);
						onProfileUpdate();
					}}
				/>
			)}

			{/* Profile header */}
			<header className="flex items-center justify-between mb-8 pb-4 border-b border-wood-700">
				<div className="flex items-center gap-4">
					<Avatar 
						src={user.avatar_url} 
						nickname={user.nickname} 
						size="lg" 
					/>
					<div>
						<h1 className="text-3xl font-bold text-wood-100">Player Dashboard</h1>
						<p className="text-wood-300">Welcome back, {user.nickname}.</p>
						<button
							onClick={() => setShowEditModal(true)}
							className="text-sm text-primary hover:text-primary-light underline mt-1"
						>
							Edit Profile
						</button>
					</div>
				</div>
				
				{/* Logout button */}
				<Button 
					onClick={onLogout} 
					disabled={isLoggingOut} 
					variant="secondary"
				>
					{isLoggingOut ? "Logging out..." : "Log Out"}
				</Button>
			</header>
		</>
	);
}
