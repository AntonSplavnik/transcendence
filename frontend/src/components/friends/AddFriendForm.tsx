import { useState, useEffect } from 'react';
import { UserPlus } from 'lucide-react';
import { sendFriendRequest } from '../../api/friends';
import { getErrorMessage } from '../../api/error';
import { validateNickname } from '../../utils/validation';

interface AddFriendFormProps {
	isOpen: boolean;
	onRequestSent: () => void;
}

export default function AddFriendForm({ isOpen, onRequestSent }: AddFriendFormProps) {
	const [nickname, setNickname] = useState('');
	const [isSending, setIsSending] = useState(false);
	const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(
		null,
	);

	useEffect(() => {
		if (!isOpen) {
			setMessage(null);
			setNickname('');
		}
	}, [isOpen]);

	const nicknameError = nickname.trim().length > 0 ? validateNickname(nickname.trim()) : null;
	const canSend = nickname.trim().length > 0 && !nicknameError && !isSending;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSend) return;

		setIsSending(true);
		setMessage(null);
		try {
			await sendFriendRequest(nickname.trim());
			setMessage({ text: `Request sent to ${nickname}!`, type: 'success' });
			setNickname('');
			onRequestSent();
		} catch (error) {
			setMessage({ text: getErrorMessage(error, 'Failed to send request'), type: 'error' });
		} finally {
			setIsSending(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="mb-3">
			<div className="flex gap-2">
				<div className="flex-1 relative">
					<input
						type="text"
						value={nickname}
						onChange={(e) => {
							setNickname(e.target.value);
							setMessage(null);
						}}
						placeholder="Add by nickname..."
						aria-label="Friend's nickname"
						className="w-full bg-stone-900 border border-stone-700 rounded px-3 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-primary"
					/>
				</div>
				<button
					type="submit"
					disabled={!canSend}
					className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-primary-text rounded text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					aria-label="Send friend request"
				>
					<UserPlus className="w-4 h-4" />
				</button>
			</div>
			{message && (
				<p
					role={message.type === 'error' ? 'alert' : 'status'}
					className={`text-xs mt-1 ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}
				>
					{message.text}
				</p>
			)}
		</form>
	);
}
