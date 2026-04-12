import { useState, useEffect } from 'react';
import { getMyStats } from '../api/user';
import type { UserStats } from '../api/types';

export function useStats() {
	const [stats, setStats] = useState<UserStats | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		getMyStats()
			.then((data) => {
				if (!cancelled) setStats(data);
			})
			.catch(() => {
				// Stats unavailable — leave null, display nothing
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return { stats, loading };
}
