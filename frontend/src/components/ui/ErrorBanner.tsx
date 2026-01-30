import { useEffect } from 'react';
import type { StoredError } from '../../api/error';

const AUTO_DISMISS_DURATION = 5000;

interface ErrorBannerProps {
	error: StoredError | null;
	onDismiss: () => void;
}

export default function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {

	useEffect(() => {
		if (error) {
			const timeoutId = window.setTimeout(() => {
				onDismiss();
			}, AUTO_DISMISS_DURATION);
			return () => {
				clearTimeout(timeoutId);
			};
		}
	}, [error, onDismiss]);

	const handleDismiss = () => {
		onDismiss();
	};

	if (!error) return null;

	return (
		<div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 
                    bg-red-900/90 border border-red-500 text-red-100 
                    px-6 py-3 rounded-lg shadow-lg max-w-md">
			<div className="flex items-center gap-2">
				<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
				</svg>
				<span>{error.message}</span>
				<button
					onClick={handleDismiss}
					className="ml-2 text-red-200 hover:text-white"
				>
					✕
				</button>
			</div>
		</div>
	);
}
