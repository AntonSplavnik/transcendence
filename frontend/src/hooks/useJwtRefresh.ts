import { useEffect, useRef } from 'react';
import { refreshJWT } from '../api/auth';
import { getErrorBrief } from '../api/error';
import type { Session } from '../api/types';

const REFRESH_BUFFER_MS = 60_000; // refresh 1 min before expiry
const MAX_INTERVAL_MS = 14 * 60 * 1000; // 14 min safety cap
const MIN_DELAY_MS = 5_000; // prevent tight loops

const TERMINAL_AUTH_ERRORS = [
	'NeedReauth',
	'InvalidSessionToken',
	'SessionNotFound',
	'MissingSessionCookie',
];

function computeDelay(accessExpiry: string): number {
	const untilExpiry = new Date(accessExpiry).getTime() - Date.now();
	return Math.max(MIN_DELAY_MS, Math.min(untilExpiry - REFRESH_BUFFER_MS, MAX_INTERVAL_MS));
}

interface UseJwtRefreshOptions {
	session: Session | null;
	onSessionUpdate: (session: Session) => void;
	onAuthLost: () => void;
}

export function useJwtRefresh({ session, onSessionUpdate, onAuthLost }: UseJwtRefreshOptions): void {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const retryCountRef = useRef(0);
	const doRefreshRef = useRef<(() => Promise<void>) | null>(null);
	// Keep callbacks in refs to avoid re-scheduling on callback identity changes
	const onSessionUpdateRef = useRef(onSessionUpdate);
	const onAuthLostRef = useRef(onAuthLost);
	useEffect(() => {
		onSessionUpdateRef.current = onSessionUpdate;
		onAuthLostRef.current = onAuthLost;
	});

	// Schedule refresh whenever session changes
	useEffect(() => {
		if (!session) {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			return;
		}

		retryCountRef.current = 0;

		async function doRefresh() {
			try {
				const newSession = await refreshJWT();
				retryCountRef.current = 0;
				onSessionUpdateRef.current(newSession);
				// Effect re-runs on session state change, rescheduling automatically.
				// No self-reschedule needed for the success path.
			} catch (error) {
				const brief = getErrorBrief(error);

				if (TERMINAL_AUTH_ERRORS.includes(brief || '')) {
					onAuthLostRef.current();
					return;
				}

				// Network error or unknown — retry with exponential backoff
				retryCountRef.current += 1;
				const backoff = Math.min(MIN_DELAY_MS * Math.pow(2, retryCountRef.current - 1), 60_000);
				timerRef.current = setTimeout(doRefresh, backoff);
			}
		}

		doRefreshRef.current = doRefresh;

		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(doRefresh, computeDelay(session.access_expiry));

		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [session]);

	// Catch up after tab was backgrounded
	useEffect(() => {
		function onVisible() {
			if (document.visibilityState !== 'visible' || !session) return;
			const remaining = new Date(session.access_expiry).getTime() - Date.now();
			if (remaining < REFRESH_BUFFER_MS) {
				if (timerRef.current) {
					clearTimeout(timerRef.current);
					timerRef.current = null;
				}
				doRefreshRef.current?.();
			}
		}
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	}, [session]);
}
