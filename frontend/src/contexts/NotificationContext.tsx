/*
 * NotificationContext — reactive notification state on top of streaming.
 *
 * Registers a uni-stream handler for the "Notifications" StreamType.  Incoming
 * `WireNotification` messages are prepared asynchronously (display text is
 * resolved — e.g. fetching nicknames for user IDs) and then shown as toasts.
 *
 * Preparation starts immediately for every incoming notification (concurrent),
 * but toasts are displayed strictly in arrival order via a FIFO queue: the
 * queue awaits each preparation promise in sequence, so a slow resolve never
 * re-orders the toasts.
 *
 * Each toast carries an optional `onClick` callback so that specific
 * notification types can trigger custom behaviour (open a modal, navigate,
 * etc.) when the user clicks the toast.  The mapping from payload → action
 * lives in `getClickAction`, keeping the Toast component generic.
 *
 * Must be nested inside `StreamProvider`.
 */

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { NotificationPayload, UniHandlerFactory, WireNotification } from '../stream/types';
import { useStream } from './StreamContext';

// ─── Toast type ──────────────────────────────────────────────────────────────

/**
 * A notification enriched with pre-resolved display text and an optional
 * click action for the toast UI.
 *
 * Display text is resolved **before** the toast enters `activeToasts`,
 * so the render path is fully synchronous — no loading states, no flicker.
 *
 * The `onClick` callback, when present, is invoked by `NotificationToast`
 * on click — and a subtle visual indicator is shown to hint that the toast
 * is actionable.  When absent the toast simply dismisses on click.
 */
export interface ToastNotification {
	/** Stable unique identifier for this toast (client-generated). */
	id: string;
	notification: WireNotification;
	/** Pre-resolved human-readable text for this notification. */
	displayText: string;
	/** Custom click action. When non-null the toast is treated as "actionable". */
	onClick: (() => void) | null;
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface NotificationContextType {
	/** All notifications received during this session (newest first). */
	notifications: WireNotification[];
	/** Undismissed toasts, newest first. */
	activeToasts: ToastNotification[];
	/** Dismiss a specific toast by its unique `id`. */
	dismissToast: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// ─── Async display-text resolution ───────────────────────────────────────────

/**
 * Resolve the human-readable display text for a notification payload.
 *
 * This is the async replacement for the old synchronous `formatNotification`.
 * Payloads that reference user IDs can resolve nicknames via the
 * `userResolver` API here — the result is stored in `ToastNotification.displayText`
 * so the render path stays synchronous.
 *
 * @example
 * ```ts
 * // When a FriendRequest variant is added:
 * if (typeof payload === 'object' && 'FriendRequest' in payload) {
 *     const name = await getNickname(payload.FriendRequest.sender_id);
 *     return `Friend request from ${name}`;
 * }
 * ```
 */
async function resolveDisplayText(payload: NotificationPayload): Promise<string> {
	if (payload === 'ServerHello') return 'Connected to server';

	if (typeof payload === 'object' && 'AchievementUnlocked' in payload) {
		const { achievement_name, tier, xp_reward } = payload.AchievementUnlocked;
		const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
		return `${tierLabel} achievement unlocked: ${achievement_name} (+${xp_reward} XP)`;
	}

	return String(payload);
}

// ─── Click-action mapping ────────────────────────────────────────────────────

/**
 * Determine the click action for a notification payload.
 *
 * Return `null` when the notification has no special behaviour (default).
 *
 * @example
 * ```ts
 * if (typeof payload === 'object' && 'FriendRequest' in payload) {
 *     return () => window.location.hash = '#/friends/requests';
 * }
 * ```
 */
function getClickAction(_payload: NotificationPayload): (() => void) | null {
	// Extend here per payload type.
	return null;
}

// ─── Async toast preparation ─────────────────────────────────────────────────

/**
 * Build a fully-prepared toast with pre-resolved display text.
 *
 * This function kicks off async work (e.g. nickname lookups) immediately.
 * The returned promise is placed in the preparation queue so that toasts
 * appear in arrival order regardless of resolution speed.
 */
async function prepareToast(notification: WireNotification): Promise<ToastNotification> {
	const displayText = await resolveDisplayText(notification.payload);
	return {
		id: crypto.randomUUID(),
		notification,
		displayText,
		onClick: getClickAction(notification.payload),
	};
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: ReactNode }) {
	const { connectionManager } = useStream();

	const [notifications, setNotifications] = useState<WireNotification[]>([]);
	const [activeToasts, setActiveToasts] = useState<ToastNotification[]>([]);

	const dismissToast = useCallback((id: string) => {
		setActiveToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	// ─── Preparation queue ───────────────────────────────────────────────
	//
	// Promises are pushed as soon as a notification arrives (starting async
	// work immediately).  The drain loop awaits them in FIFO order so that
	// toasts appear in the same order the notifications were received, even
	// when later notifications resolve faster than earlier ones.
	const queueRef = useRef<Promise<ToastNotification>[]>([]);
	const drainingRef = useRef(false);

	const drainQueue = useCallback(async () => {
		for (;;) {
			if (drainingRef.current) return;
			drainingRef.current = true;

			try {
				while (queueRef.current.length > 0) {
					const promise = queueRef.current.shift()!;
					try {
						const toast = await promise;
						setNotifications((prev) => [toast.notification, ...prev]);
						setActiveToasts((prev) => [toast, ...prev]);
					} catch (err) {
						console.warn('[Notifications] failed to prepare toast:', err);
					}
				}
			} finally {
				drainingRef.current = false;
			}

			// Items may have been enqueued while awaiting a promise inside the
			// loop.  Re-check after clearing the guard to avoid stuck items.
			if (queueRef.current.length === 0) return;
		}
	}, []);

	/** Enqueue a notification for async preparation + ordered display. */
	const enqueueNotification = useCallback(
		(notification: WireNotification) => {
			queueRef.current.push(prepareToast(notification));
			drainQueue();
		},
		[drainQueue],
	);

	// Register the notification stream handler factory.
	useEffect(() => {
		const factory: UniHandlerFactory<WireNotification> = () => ({
			onMessage(notification: WireNotification) {
				enqueueNotification(notification);
			},

			onOpen() {
				console.info('[Notifications] stream opened');
			},

			onClose() {
				console.info('[Notifications] stream closed');
			},

			onError(err) {
				console.warn('[Notifications] stream error:', err);
			},
		});

		connectionManager.registerUniHandler('Notifications', factory);

		return () => {
			connectionManager.unregisterHandler('Notifications');
		};
	}, [connectionManager, enqueueNotification]);

	// Expose a debug helper on `window` for the browser console (dev only).
	// Usage:  debugNotify()              — plain ServerHello toast
	//         debugNotify("hello")       — toast that alerts "hello" on click
	useEffect(() => {
		if (!import.meta.env.DEV) return;

		const w = window as unknown as Record<string, unknown>;
		w.debugNotify = (message?: string) => {
			const notification: WireNotification = {
				payload: 'ServerHello',
				created_at: new Date().toISOString(),
			};
			const prepared = prepareToast(notification).then((toast) => {
				if (message) toast.onClick = () => alert(message);
				return toast;
			});
			queueRef.current.push(prepared);
			drainQueue();
		};
		return () => {
			delete w.debugNotify;
		};
	}, [drainQueue]);

	return (
		<NotificationContext.Provider value={{ notifications, activeToasts, dismissToast }}>
			{children}
		</NotificationContext.Provider>
	);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useNotifications(): NotificationContextType {
	const ctx = useContext(NotificationContext);
	if (!ctx) {
		throw new Error('useNotifications must be used within a NotificationProvider');
	}
	return ctx;
}
