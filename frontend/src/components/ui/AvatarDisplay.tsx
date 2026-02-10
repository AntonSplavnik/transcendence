import { useEffect, useState } from 'react';
import { fetchAvatar } from '../../api/avatar';

interface AvatarDisplayProps {
    userId : number;
    size: 'large' | 'small';
    className?: string;
}

export default function AvatarDisplay( {userId, size, className = "" } : AvatarDisplayProps ) {
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        let url: string | null = null;
        async function loadAvatar() {
            try {
                url = await fetchAvatar(userId, size);
                setAvatarUrl(url);
                setLoading(false);
            } catch {
                setLoading(false);
            }
        }
        loadAvatar();
        return () => {
            if (url) URL.revokeObjectURL(url);
        };
    }, [userId, size]);
    return (
        <div className={`rounded-full overflow-hidden ${className}`}>
            {loading ? (
                <div className="bg-wood-700 animate-pulse w-full h-full" />
            ) : (
                <img src={avatarUrl!} alt="avatar" className="w-full h-full object-cover" />
            )}
        </div>
    );
}