import type { MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useNotifications, type ToastNotification } from '../../contexts/NotificationContext';

// ─── Layout constants ────────────────────────────────────────────────────────

/** Card height including padding (matches h-[4.5rem] = 72px). */
const CARD_H = 72;
/** Gap between individually displayed cards. */
const GAP = 12;
/** Total vertical stride per individual card slot. */
const STRIDE = CARD_H + GAP;
/** Peek distance between stacked (non-readable) cards. */
const STACK_PEEK = 8;
/** Max individually rendered cards before switching to stack mode. */
const MAX_INDIVIDUAL = 2;
/** Max visual cards inside the stack (readable top + slivers). */
const MAX_STACK_VISUAL = 3;
/** Max visible items overall (1 newest + stack). */
const MAX_VISIBLE = 1 + MAX_STACK_VISUAL;
/** Slide-out animation duration — must match CSS. */
const SLIDE_OUT_MS = 200;

// ─── Single notification card ────────────────────────────────────────────────

interface NotificationCardProps {
	toast: ToastNotification;
	/**
	 * Whether the toast has an onClick action (and the card is interactive).
	 * When true the card renders two explicit buttons: dismiss (left) + action (right).
	 * When false the whole card is inert — the parent wrapper is the button.
	 */
	actionable: boolean;
	/** Fires the toast's click action. Only used when actionable=true. */
	onAction?: (e: MouseEvent) => void;
	/** Dismisses the toast. Only used when actionable=true (inner dismiss button). */
	onDismiss?: () => void;
}

function NotificationCard({ toast, actionable, onAction, onDismiss }: NotificationCardProps) {
	const { notification } = toast;

	const bellIcon = (
		<svg
			className="w-5 h-5 mt-0.5 text-gold shrink-0"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2}
			aria-hidden="true"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
			/>
		</svg>
	);

	const textContent = (
		<div className="flex-1 min-w-0">
			<p className="text-sm font-medium text-stone-100 truncate">{toast.displayText}</p>
			<p className="text-xs text-stone-300 mt-0.5">
				{new Date(notification.created_at).toLocaleTimeString()}
			</p>
		</div>
	);

	return (
		<div
			className={`bg-stone-800 border rounded-lg shadow-xl select-none
				h-[4.5rem] flex items-center transition-colors ${
					actionable ? 'border-gold/40 hover:border-gold/70' : 'border-stone-600'
				}`}
		>
			<div className="flex items-center gap-3 w-full h-full">
				{/*
				 * Left section: bell + text.
				 * For actionable cards this becomes an explicit dismiss button so there
				 * are no nested interactive controls inside the parent role="group".
				 */}
				{actionable ? (
					<button
						className="flex items-center gap-3 flex-1 min-w-0 pl-5 h-full text-left"
						onClick={onDismiss}
						aria-label={`Dismiss: ${toast.displayText}`}
					>
						{bellIcon}
						{textContent}
					</button>
				) : (
					<div className="flex items-start gap-3 flex-1 min-w-0 pl-5">
						{bellIcon}
						{textContent}
					</div>
				)}

				{/* Right action zone: navigate to the related resource. */}
				{actionable && (
					<button
						onClick={onAction}
						className="shrink-0 h-full px-3 flex items-center
							border-l border-gold/20 hover:bg-gold/10
							text-gold/60 hover:text-gold transition-colors
							rounded-r-lg"
						aria-label={`Go to: ${toast.displayText}`}
					>
						<svg
							className="w-4 h-4"
							viewBox="0 0 20 20"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								fillRule="evenodd"
								d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
								clipRule="evenodd"
							/>
						</svg>
					</button>
				)}
			</div>
		</div>
	);
}

// ─── Position helpers ────────────────────────────────────────────────────────

interface CardLayout {
	bottom: number;
	scale: number;
	interactive: boolean;
}

/**
 * Compute position and scale for each visible card.
 * Extracted so the render function stays clean and the logic is independently
 * testable.
 */
function getCardLayout(index: number, visibleCount: number, isStackMode: boolean): CardLayout {
	if (!isStackMode) {
		return {
			bottom: (visibleCount - 1 - index) * STRIDE,
			scale: 1,
			interactive: true,
		};
	}
	if (index === 0) {
		return { bottom: STRIDE, scale: 1, interactive: true };
	}
	const stackIdx = index - 1;
	if (stackIdx === 0) {
		return { bottom: 0, scale: 1, interactive: true };
	}
	return {
		bottom: -(stackIdx * STACK_PEEK),
		scale: 1 - stackIdx * 0.03,
		interactive: false,
	};
}

// ─── Toast container ─────────────────────────────────────────────────────────

/**
 * Multi-toast notification stack anchored to the bottom-left corner.
 *
 * - Up to {@link MAX_INDIVIDUAL} notifications are shown spaced vertically.
 * - When more are active the newest stays at the top and extra cards collapse
 *   into a visual stack.  The stack's topmost card is readable; deeper cards
 *   are decorative slivers.
 * - A "+N more" badge appears when the stack overflows.
 * - Clicking a toast dismisses it.
 * - If a toast defines an `onClick` action, that action is triggered via its
 *   dedicated control (the chevron button), not by clicking the toast card
 *   itself.
 */
export default function NotificationToast() {
	const { activeToasts, dismissToast } = useNotifications();

	// IDs of toasts currently animating out.
	const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
	const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	// Clean up timers on unmount.
	useEffect(() => {
		const timers = exitTimers.current;
		return () => {
			for (const t of timers.values()) clearTimeout(t);
		};
	}, []);

	/** Animate out, then dismiss. Uses a ref-based guard to prevent duplicate
	 *  timers when two rapid clicks land in the same React batch. */
	const animateDismiss = useCallback(
		(toast: ToastNotification) => {
			if (exitTimers.current.has(toast.id)) return;

			setExitingIds((prev) => new Set(prev).add(toast.id));
			const timer = setTimeout(() => {
				dismissToast(toast.id);
				setExitingIds((prev) => {
					const next = new Set(prev);
					next.delete(toast.id);
					return next;
				});
				exitTimers.current.delete(toast.id);
			}, SLIDE_OUT_MS);
			exitTimers.current.set(toast.id, timer);
		},
		[dismissToast],
	);

	/** Fire the toast's click action, then dismiss. */
	const handleAction = useCallback(
		(e: MouseEvent, toast: ToastNotification) => {
			e.stopPropagation();
			toast.onClick?.();
			animateDismiss(toast);
		},
		[animateDismiss],
	);

	if (activeToasts.length === 0) return null;

	const isStackMode = activeToasts.length > MAX_INDIVIDUAL;
	const visible = activeToasts.slice(0, MAX_VISIBLE);
	const overflowCount = Math.max(0, activeToasts.length - MAX_VISIBLE);

	return (
		<div className="fixed bottom-6 left-6 z-50 pointer-events-none" style={{ width: '22rem' }}>
			{visible.map((toast, index) => {
				const isExiting = exitingIds.has(toast.id);
				const { bottom, scale, interactive } = getCardLayout(
					index,
					visible.length,
					isStackMode,
				);

				// Actionable: toast has an onClick and this card slot is interactive.
				// These cards render two explicit buttons inside a group wrapper so there
				// are no nested interactive controls (WCAG 4.1.2).
				const hasAction = interactive && toast.onClick != null;

				return (
					<div
						key={toast.id}
						className={`absolute left-0 w-full ${
							interactive ? 'pointer-events-auto cursor-pointer' : ''
						} ${interactive && !hasAction ? 'focus-visible:ring-1 focus-visible:ring-gold-400/50 outline-none rounded-lg' : ''} ${isExiting ? 'animate-toast-out' : 'animate-toast-in'}`}
						style={{
							bottom: `${bottom}px`,
							zIndex: 50 - index,
							transform: `scale(${scale})`,
							transformOrigin: 'bottom left',
							transition: 'bottom 200ms ease, transform 200ms ease',
						}}
						// Non-actionable interactive cards: the whole wrapper is the dismiss button.
						// Actionable cards: buttons are inside NotificationCard; wrapper is a group.
						onClick={
							interactive && !hasAction ? () => animateDismiss(toast) : undefined
						}
						onKeyDown={
							interactive && !hasAction
								? (e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											animateDismiss(toast);
										}
									}
								: undefined
						}
						role={!interactive ? undefined : hasAction ? 'group' : 'button'}
						tabIndex={interactive && !hasAction ? 0 : undefined}
						aria-label={
							!interactive
								? undefined
								: hasAction
									? toast.displayText
									: `Dismiss: ${toast.displayText}`
						}
					>
						<div role="status" aria-live="polite">
							<NotificationCard
								toast={toast}
								actionable={hasAction}
								onAction={hasAction ? (e) => handleAction(e, toast) : undefined}
								onDismiss={hasAction ? () => animateDismiss(toast) : undefined}
							/>
						</div>
					</div>
				);
			})}

			{/* Overflow badge */}
			{overflowCount > 0 && (
				<div
					className="absolute pointer-events-none"
					style={{ bottom: `${CARD_H - 8}px`, left: -4, zIndex: 60 }}
				>
					<span className="text-[0.65rem] font-medium text-stone-100 bg-gold/80 px-1.5 py-0.5 rounded-full leading-none">
						+{overflowCount}
					</span>
				</div>
			)}
		</div>
	);
}
