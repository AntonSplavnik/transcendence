import { useEffect, useState } from 'react';
import { fetchAvatar } from '../../api/avatar';
import { UserIcon } from 'lucide-react';

interface AvatarDisplayProps {
	userId: number;
	size: 'large' | 'small';
	src?: string | null;
	className?: string;
	alt?: string;
}

export default function AvatarDisplay({
	userId,
	size,
	src,
	className = '',
	alt = 'User avatar',
}: AvatarDisplayProps) {
	const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
	const [loading, setLoading] = useState<boolean>(src === undefined);
	const [error, setError] = useState<boolean>(false);

	useEffect(() => {
		if (src !== undefined) return;
		let cancelled = false;
		let url: string | null = null;
		async function loadAvatar() {
			try {
				url = await fetchAvatar(userId, size);
				if (!cancelled) {
					setAvatarUrl(url);
					setLoading(false);
				}
			} catch {
				if (!cancelled) {
					setError(true);
					setLoading(false);
				}
			}
		}
		loadAvatar();
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [userId, size, src]);

	const displayUrl = src !== undefined ? src : avatarUrl;

	return (
		<div className={`rounded-full overflow-hidden ${className}`}>
			{loading ? (
				<div aria-hidden="true" className="bg-stone-700 animate-pulse w-full h-full" />
			) : !displayUrl || error ? (
				<div
					role="img"
					aria-label={alt}
					className="bg-stone-700 w-full h-full flex items-center justify-center"
				>
					<UserIcon className="w-1/2 h-1/2 text-stone-400" aria-hidden="true" />
				</div>
			) : (
				<img src={displayUrl} alt={alt} className="w-full h-full object-cover" />
			)}
		</div>
	);
}
