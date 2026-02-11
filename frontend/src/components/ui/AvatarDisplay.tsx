import { useEffect, useState } from 'react';
import { fetchAvatar } from '../../api/avatar';
import { UserIcon } from 'lucide-react';

interface AvatarDisplayProps {
    userId : number;
    size: 'large' | 'small';
    className?: string;
}

export default function AvatarDisplay( {userId, size, className = "" } : AvatarDisplayProps ) {
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<boolean>(false);

    useEffect(() => {
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
                if(!cancelled) {
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
    }, [userId, size]);
    return (
        <div className={`rounded-full overflow-hidden ${className}`}>
            {loading ? (
                <div className="bg-wood-700 animate-pulse w-full h-full" />
            ) : error ? (
                    <div className="bg-wood-700 w-full h-full flex items-center justify-center">
                        <UserIcon className="w-1/2 h-1/2 text-wood-400" />
                    </div>
            ) : (
                <img src={avatarUrl!} alt="avatar" className="w-full h-full object-cover" />
            )}
        </div>
    );
}