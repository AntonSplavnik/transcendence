import React, { useState } from "react";
import Avatar from "./../ui/Avatar";
import Button from "./../ui/Button";

interface SearchResult {
	id: number;
	nickname: string;
	avatar_url: string | null;
	friendship_status: string | null;
}

interface UserSearchProps {
	onSendRequest: (userId: number) => Promise<boolean>;
}

export default function UserSearch({ onSendRequest }: UserSearchProps) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [sentRequests, setSentRequests] = useState<Set<number>>(new Set());

	const handleSearch = async (e: React.FormEvent) => {
		e.preventDefault();
		if (query.trim().length < 2) {
			return;
		}

		setLoading(true);
		try {
			const response = await fetch(`/api/friends/search?q=${encodeURIComponent(query)}`, {
				credentials: 'include',
			});
			if (response.ok) {
				const data = await response.json();
				setResults(data);
			}
		} catch (error) {
			console.error('Failed to search users:', error);
		} finally {
			setLoading(false);
		}
	};

	const handleSendRequest = async (userId: number) => {
		const success = await onSendRequest(userId);
		if (success) {
			setSentRequests(new Set(sentRequests).add(userId));
		}
	};

	const getButtonContent = (user: SearchResult) => {
		if (sentRequests.has(user.id)) {
			return { text: 'Request Sent', variant: 'secondary' as const, disabled: true };
		}

		switch (user.friendship_status) {
			case 'pending':
				return { text: 'Pending', variant: 'secondary' as const, disabled: true };
			case 'accepted':
				return { text: 'Already Friends', variant: 'secondary' as const, disabled: true };
			case 'declined':
				return { text: 'Add Friend', variant: 'primary' as const, disabled: false };
			case 'blocked':
				return { text: 'Blocked', variant: 'danger' as const, disabled: true };
			default:
				return { text: 'Add Friend', variant: 'primary' as const, disabled: false };
		}
	};

	return (
		<div>
			<form onSubmit={handleSearch} className="mb-6">
				<div className="flex gap-2">
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search by nickname..."
						className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary"
						minLength={2}
					/>
					<Button
						type="submit"
						variant="primary"
						disabled={loading || query.trim().length < 2}
					>
						{loading ? 'Searching...' : 'Search'}
					</Button>
				</div>
				<p className="text-sm text-gray-400 mt-2">
					Enter at least 2 characters to search
				</p>
			</form>

			<div className="space-y-3">
				{results.length === 0 && query.length >= 2 && !loading && (
					<div className="text-center py-8 text-gray-400">
						<p>No users found matching "{query}"</p>
					</div>
				)}

				{results.map((user) => {
					const buttonConfig = getButtonContent(user);
					return (
						<div
							key={user.id}
							className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors"
						>
							<div className="flex items-center gap-3">
								<Avatar
									nickname={user.nickname}
									src={user.avatar_url}
									size="md"
								/>
								<div>
									<p className="font-medium text-white">{user.nickname}</p>
									{user.friendship_status && (
										<p className="text-sm text-gray-400 capitalize">
											{user.friendship_status}
										</p>
									)}
								</div>
							</div>
							<Button
								variant={buttonConfig.variant}
								onClick={() => handleSendRequest(user.id)}
								disabled={buttonConfig.disabled}
								className="px-3 py-1.5 text-sm whitespace-nowrap"
							>
								{buttonConfig.text}
							</Button>
						</div>
					);
				})}
			</div>
		</div>
	);
}
