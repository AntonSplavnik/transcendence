import { AlertTriangle, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ConnectionState } from '../../stream/types';

interface ConnectionStatusBannerProps {
	state: ConnectionState;
}

/** Content resolved from a {@link ConnectionState} for the banner UI. */
interface BannerContent {
	icon: ReactNode;
	text: string;
	bgClass: string;
}

/**
 * Thin, always-visible banner at the top of the viewport when the
 * WebTransport connection is not healthy.
 *
 * Shows contextual information for each non-connected state so the
 * user (and developers) can immediately see what's going on.
 */
export default function ConnectionStatusBanner({ state }: ConnectionStatusBannerProps) {
	// Don't render when connected (caller should already guard this).
	if (state.status === 'connected') return null;

	const { icon, text, bgClass } = bannerContent(state);

	return (
		<div
			className={`
				sticky top-0 z-40 flex items-center justify-center gap-2
				px-3 py-1.5 text-xs font-medium select-none
				${bgClass}
			`}
			role="status"
			aria-live="polite"
		>
			{icon}
			<span>{text}</span>
		</div>
	);
}

function bannerContent(state: ConnectionState): BannerContent {
	switch (state.status) {
		case 'disconnected':
			return {
				icon: <WifiOff size={14} />,
				text: 'Realtime connection inactive',
				bgClass: 'bg-stone-800 text-stone-400',
			};
		case 'connecting':
			return {
				icon: <Loader2 size={14} className="animate-spin" />,
				text: 'Connecting\u2026',
				bgClass: 'bg-info-bg text-info-light border-b border-info/30',
			};
		case 'authenticating':
			return {
				icon: <Loader2 size={14} className="animate-spin" />,
				text: 'Authenticating\u2026',
				bgClass: 'bg-info-bg text-info-light border-b border-info/30',
			};
		case 'reconnecting':
			return {
				icon: <RefreshCw size={14} className="animate-spin" />,
				text: `Reconnecting (attempt ${state.attempt + 1})\u2026`,
				bgClass: 'bg-warning-bg text-warning-light border-b border-warning/30',
			};
		case 'displaced':
			return {
				icon: <AlertTriangle size={14} />,
				text: 'Connected from another location \u2014 realtime features unavailable',
				bgClass: 'bg-warning-bg text-warning-light border-b border-warning/30',
			};
		default:
			return {
				icon: <WifiOff size={14} />,
				text: 'Connection status unavailable',
				bgClass: 'bg-stone-800 text-stone-400',
			};
	}
}
