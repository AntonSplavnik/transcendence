import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useUIAudio } from './AudioProvider';

/**
 * Route → music/ambient policy.
 * Pure data — adding a new route track means appending one entry. No new code.
 *
 * For each route the controller computes the desired music/ambient IDs and
 * delegates to AudioProvider, which handles switching/no-op semantics.
 */
const DASHBOARD_ROUTES = new Set<string>(['/home', '/lobby', '/sessions']);

function resolveMusic(pathname: string): string | null {
	if (pathname === '/landing' || pathname === '/') return 'music_main_theme';
	if (DASHBOARD_ROUTES.has(pathname)) return 'music_dashboard';
	return null; // /auth, /game, /privacy, /terms → silence
}

function resolveAmbient(pathname: string): string | null {
	if (pathname === '/landing' || pathname === '/') return 'amb_montagne';
	return null;
}

/**
 * Drives background music + ambient based on the current route.
 * Must be mounted inside <AudioProvider> and <HashRouter>.
 */
export default function MusicController() {
	const { pathname } = useLocation();
	const audio = useUIAudio();

	useEffect(() => {
		if (!audio.isReady) return;

		const desiredMusic = resolveMusic(pathname);
		const desiredAmbient = resolveAmbient(pathname);

		if (desiredMusic) audio.playMusic(desiredMusic);
		else audio.stopMusic();

		if (desiredAmbient) audio.playAmbient(desiredAmbient);
		else audio.stopAmbient();
	}, [pathname, audio.isReady]);

	return null;
}
