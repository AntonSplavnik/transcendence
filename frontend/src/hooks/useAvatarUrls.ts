import { useState, useEffect } from 'react';

interface AvatarUrls {
	small: string | undefined;
	large: string | undefined;
	refreshKey: number;
}

export function useAvatarUrls() {
	const [urls, setUrls] = useState<AvatarUrls>({ small: undefined, large: undefined, refreshKey: 0 });

	useEffect(() => {
		const { small, large } = urls;
		return () => {
			if (small?.startsWith('blob:')) URL.revokeObjectURL(small);
			if (large?.startsWith('blob:')) URL.revokeObjectURL(large);
		};
	}, [urls]);

	const setAvatarUrls = (small: string | null, large: string | null) => {
		setUrls((current) => ({
			small: small ?? undefined,
			large: large ?? undefined,
			refreshKey: current.refreshKey,
		}));
	};

	const refreshAvatarUrls = () => {
		setUrls((current) => ({
			small: undefined,
			large: undefined,
			refreshKey: current.refreshKey + 1,
		}));
	};

	return {
		avatarSmallUrl: urls.small,
		avatarLargeUrl: urls.large,
		avatarRefreshKey: urls.refreshKey,
		setAvatarUrls,
		refreshAvatarUrls,
	};
}
