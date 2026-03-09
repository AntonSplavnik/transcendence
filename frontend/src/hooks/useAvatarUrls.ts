import { useState, useEffect } from 'react';

interface AvatarUrls {
	small: string | undefined;
	large: string | undefined;
}

export function useAvatarUrls() {
	const [urls, setUrls] = useState<AvatarUrls>({ small: undefined, large: undefined });

	useEffect(() => {
		const { small, large } = urls;
		return () => {
			if (small?.startsWith('blob:')) URL.revokeObjectURL(small);
			if (large?.startsWith('blob:')) URL.revokeObjectURL(large);
		};
	}, [urls]);

	const setAvatarUrls = (small: string | null, large: string | null) => {
		setUrls({ small: small ?? undefined, large: large ?? undefined });
	};

	return { avatarSmallUrl: urls.small, avatarLargeUrl: urls.large, setAvatarUrls };
}
