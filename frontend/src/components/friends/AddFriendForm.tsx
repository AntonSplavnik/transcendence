import { useState, useRef, useEffect } from 'react';
import { UserPlus } from 'lucide-react';
import { nicknameExists } from '../../api/users';
import { sendFriendRequest } from '../../api/friends';
import { getErrorMessage } from '../../api/error';

interface AddFriendFormProps {
	onRequestSent: () => void;
}

export default function AddFriendForm({ onRequestSent }: AddFriendFormProps) {
	const [nickname, setNickname] = useState('');
	const [validation, setValidation] = useState('');
	const [isChecking, setIsChecking] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (nickname.trim().length > 0) {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			setIsChecking(true);
			setValidation('');
			timeoutRef.current = setTimeout(async () => {
				const result = await nicknameExists(nickname);
				// Inverted logic: "taken" means user exists = valid target
				if (result.includes('already taken')) {
					setValidation('valid');
				} else if (result.includes('invalid')) {
					setValidation('invalid');
				} else if (result.includes('\u2705')) {
					// Checkmark means nickname is available = user doesn't exist
					setValidation('not_found');
				} else {
					setValidation('error');
				}
				setIsChecking(false);
			}, 500);
		} else {
			setValidation('');
			setIsChecking(false);
		}
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
		};
	}, [nickname]);

	const canSend = validation === 'valid' && !isSending && !isChecking;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSend) return;

		setIsSending(true);
		setMessage(null);
		try {
			await sendFriendRequest(nickname.trim());
			setMessage({ text: `Request sent to ${nickname}!`, type: 'success' });
			setNickname('');
			setValidation('');
			onRequestSent();
		} catch (error) {
			setMessage({ text: getErrorMessage(error, 'Failed to send request'), type: 'error' });
		} finally {
			setIsSending(false);
		}
	};

	const getHint = () => {
		if (isChecking) return { text: 'Checking...', color: 'text-wood-400' };
		if (validation === 'valid') return { text: 'User found', color: 'text-green-400' };
		if (validation === 'not_found') return { text: 'User not found', color: 'text-red-400' };
		if (validation === 'invalid') return { text: 'Invalid nickname', color: 'text-red-400' };
		if (validation === 'error') return { text: 'Error checking', color: 'text-red-400' };
		return null;
	};

	const hint = getHint();

	return (
		<form onSubmit={handleSubmit} className="mb-3">
			<div className="flex gap-2">
				<div className="flex-1 relative">
					<input
						type="text"
						value={nickname}
						onChange={(e) => { setNickname(e.target.value); setMessage(null); }}
						placeholder="Add by nickname..."
						className="w-full bg-wood-900 border border-wood-700 rounded px-3 py-1.5 text-sm text-wood-100 focus:outline-none focus:border-primary"
					/>
				</div>
				<button
					type="submit"
					disabled={!canSend}
					className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-primary-text rounded text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<UserPlus className="w-4 h-4" />
				</button>
			</div>
			{hint && nickname.trim().length > 0 && (
				<p className={`text-xs mt-1 ${hint.color}`}>{hint.text}</p>
			)}
			{message && (
				<p className={`text-xs mt-1 ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
					{message.text}
				</p>
			)}
		</form>
	);
}
