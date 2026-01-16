/**
 * Get JWT refresh interval from env or use default
 * Default: 14 minutes (1 minute before 15-minute JWT expiry)
 */
const getJwtRefreshInterval = (): number => {
	const envMinutes = import.meta.env.VITE_JWT_REFRESH_INTERVAL_MINUTES;
	const minutes = envMinutes ? parseInt(envMinutes, 10) : 14;

	if (minutes < 1 || minutes > 14) {
		console.warn(
			`Invalid JWT_REFRESH_INTERVAL:  ${minutes}min. Must be between 1-14. Using default:  14min`
		);
		return 14 * 60 * 1000;
	}

	return minutes * 60 * 1000;
};

export const AUTH_CONFIG = {
	JWT_REFRESH_INTERVAL: getJwtRefreshInterval(),
	JWT_EXPIRY_MINUTES: 15,
} as const;

export const VIEW_CONFIG = {
	PROTECTED_VIEWS: ['home', 'game'] as const,
} as const;

export const ERROR_CONFIG = {
	AUTO_DISMISS_DURATION: 5000,
} as const;
