import { useState, useEffect } from 'react';
import { getMyAchievements } from '../api/user';
import type { AchievementWithProgress } from '../api/types';

export function useAchievements() {
	const [achievements, setAchievements] = useState<AchievementWithProgress[] | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		getMyAchievements()
			.then((data) => {
				if (!cancelled) setAchievements(data);
			})
			.catch(() => {
				// Achievements unavailable — leave null, display nothing
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return { achievements, loading };
}
