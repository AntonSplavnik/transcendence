import { useEffect, useRef } from 'react';
import Card from './Card';

export interface ModalProps {
	onClose: () => void;
	title: string;
	icon?: React.ReactNode;
	maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
	children: React.ReactNode;
	footer?: React.ReactNode;
	closable?: boolean;
}

const widthMap: Record<string, string> = {
	sm: 'max-w-sm',
	md: 'max-w-md',
	lg: 'max-w-lg',
	xl: 'max-w-xl',
};

const FOCUSABLE_SELECTORS =
	'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement | null): HTMLElement[] {
	if (!container) return [];
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
}

export default function Modal({
	onClose,
	title,
	icon,
	maxWidth = 'md',
	children,
	footer,
	closable = true,
}: ModalProps) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);
	// Keep a stable ref to onClose so the keydown effect doesn't re-register
	// its listener every time the parent passes a new function identity.
	const onCloseRef = useRef(onClose);
	useEffect(() => {
		onCloseRef.current = onClose;
	});

	// Store previous focus and restore it on unmount
	useEffect(() => {
		const active = document.activeElement;
		if (active instanceof HTMLElement) previousFocusRef.current = active;

		// Only move focus if nothing inside the modal already has focus
		// (autoFocus on an input will have already run before this effect)
		const alreadyFocusedInside = dialogRef.current?.contains(document.activeElement);
		if (!alreadyFocusedInside) {
			const focusable = getFocusable(dialogRef.current);
			focusable[0]?.focus();
		}

		return () => {
			previousFocusRef.current?.focus();
		};
	}, []);

	// Handle Escape (when closable) and Tab trap (always).
	// Depends only on closable — onClose is read from the ref above.
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && closable) {
				onCloseRef.current();
				return;
			}

			if (e.key === 'Tab') {
				const focusable = getFocusable(dialogRef.current);
				if (focusable.length === 0) {
					e.preventDefault();
					return;
				}
				const first = focusable[0];
				const last = focusable[focusable.length - 1];

				if (e.shiftKey) {
					if (document.activeElement === first) {
						e.preventDefault();
						last.focus();
					}
				} else {
					if (document.activeElement === last) {
						e.preventDefault();
						first.focus();
					}
				}
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [closable]);

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
			onClick={
				closable
					? (e) => {
							if (e.target === e.currentTarget) onClose();
						}
					: undefined
			}
		>
			<Card
				variant="elevated"
				className={`${widthMap[maxWidth]} w-full max-h-[90vh] overflow-y-auto`}
			>
				<div className="flex items-center justify-between mb-4">
					<h2
						id="modal-title"
						className="text-2xl font-bold text-stone-50 flex items-center gap-2"
					>
						{icon && <span aria-hidden="true">{icon}</span>}
						{title}
					</h2>
					{closable && (
						<button
							onClick={onClose}
							className="text-stone-300 hover:text-stone-100 text-xl leading-none p-1 rounded hover:bg-stone-700/50 transition-colors"
							aria-label="Close dialog"
						>
							×
						</button>
					)}
				</div>
				<div>{children}</div>
				{footer && (
					<div className="flex gap-3 mt-6 pt-4 border-t border-stone-700">{footer}</div>
				)}
			</Card>
		</div>
	);
}
