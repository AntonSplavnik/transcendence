/*
 * Shared types for the frontend streaming system.
 *
 * These mirror the Rust types defined in:
 *   - backend/src/stream/mod.rs           (StreamType, CtrlMessage enums)
 *   - backend/src/stream/stream_manager.rs (PendingConnectionKey)
 *   - backend/src/notifications/mod.rs     (NotificationPayload, WireNotification)
 *
 * Serde's default (externally-tagged) enum encoding is used on the wire:
 *   - Unit variants  → plain string:  "Notifications"
 *   - Newtype variants → object:      { "Notifications": { … } }
 *
 * Connection-lifecycle signaling uses a Ctrl uni stream:
 *   - StreamType header: { "Ctrl": { connection_id, challenge } }
 *   - Subsequent messages: CtrlMessage ("Displaced")
 */

import type { PendingConnectionKey } from '../api/stream';

// ─── StreamType ──────────────────────────────────────────────────────────────

/**
 * Discriminated union matching the backend `StreamType` enum.
 *
 * Every stream opened by the server sends exactly one `StreamType` value as
 * its first CBOR frame.  The client reads this header to decide which handler
 * to dispatch.  New variants are added here as the backend grows.
 *
 * The `Ctrl` variant carries the {@link PendingConnectionKey} used for
 * the authentication handshake.
 */
export type StreamType =
	| 'Notifications'
	| { Ctrl: PendingConnectionKey };

// ─── Ctrl stream messages ────────────────────────────────────────────────────

/**
 * Messages received on the Ctrl uni stream after the initial
 * {@link PendingConnectionKey} header.
 *
 * Mirrors the backend `CtrlMessage` enum (serde externally-tagged).
 *
 * Variants:
 *   - `"Displaced"` — the session is being replaced by a newer connection
 *     from the same user (another tab / device).
 */
export type CtrlMessage = 'Displaced';

/**
 * Result of parsing a raw CBOR-decoded value into a stream-type discriminant
 * and its associated payload.
 *
 * For unit variants (e.g. `"Notifications"`) `data` is `undefined`.
 * For newtype / struct variants `data` carries the inner value.
 */
export interface ParsedStreamType {
	/** The variant name, e.g. `"Notifications"`. */
	key: string;
	/** The variant payload (`undefined` for unit variants). */
	data: unknown;
}

/**
 * Parse a raw CBOR-decoded value into a stream-type discriminant.
 *
 * Handles serde's externally-tagged enum format:
 *   - `"Foo"`           → { key: "Foo", data: undefined }
 *   - `{ "Bar": … }`   → { key: "Bar", data: … }
 *
 * @throws {Error} if `raw` is neither a string nor a single-key object.
 */
export function parseStreamType(raw: unknown): ParsedStreamType {
	if (typeof raw === 'string') {
		return { key: raw, data: undefined };
	}
	if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
		const keys = Object.keys(raw);
		if (keys.length === 1) {
			const key = keys[0];
			return { key, data: (raw as Record<string, unknown>)[key] };
		}
	}
	let repr: string;
	try {
		repr = JSON.stringify(raw);
	} catch {
		repr = String(raw);
	}
	throw new Error(
		`Invalid StreamType header: expected a string or single-key object, got ${repr}`,
	);
}

// ─── Connection state machine ────────────────────────────────────────────────

/** Observable state of the WebTransport connection. */
export type ConnectionState =
	| { status: 'disconnected' }
	| { status: 'connecting' }
	| { status: 'authenticating' }
	| { status: 'connected' }
	| { status: 'reconnecting'; attempt: number; nextRetryMs: number }
	| { status: 'displaced' };

// ─── Notification types ──────────────────────────────────────────────────────

/**
 * The payload of a notification, mirroring the backend
 * `NotificationPayload` enum (serde externally-tagged).
 *
 * Extend this union as the backend adds more variants.
 */
export type NotificationPayload =
	| 'ServerHello'
	| { FriendRequestReceived: { request_id: number; sender_id: number } }
	| { FriendRequestAccepted: { request_id: number; friend_id: number } }
	| { FriendRequestRejected: { request_id: number } }
	| { FriendRequestCancelled: { request_id: number } }
	| { FriendRemoved: { user_id: number } };

/**
 * A single notification as transmitted on the wire.
 *
 * Mirrors the backend `WireNotification` struct.
 */
export interface WireNotification {
	payload: NotificationPayload;
	/** ISO-8601 datetime string. */
	created_at: string;
}

// ─── Stream handler interfaces ───────────────────────────────────────────────

/**
 * Per-stream handler for a server → client unidirectional stream.
 *
 * One instance is created per stream by the corresponding
 * {@link UniHandlerFactory}.  Each handler manages its own stream lifecycle.
 */
export interface UniStreamHandler<T = unknown> {
	/** Called once when the stream is ready (after the StreamType header). */
	onOpen?(): void;
	onMessage(msg: T): void;
	onClose?(): void;
	onError?(err: unknown): void;
}

/**
 * Per-stream handler for a bidirectional stream.
 *
 * One instance is created per stream by the corresponding
 * {@link BidiHandlerFactory}.  The `send` function is captured via the
 * factory closure.
 */
export interface BidiStreamHandler<TRecv = unknown> {
	/** Called once when the stream is ready (after the StreamType header). */
	onOpen?(): void;
	onMessage(msg: TRecv): void;
	onClose?(): void;
	onError?(err: unknown): void;
}

// ─── Handler factories ───────────────────────────────────────────────────────

/**
 * Factory that creates a new {@link UniStreamHandler} for each incoming
 * unidirectional stream of a given StreamType.
 *
 * @param data - The payload extracted from the StreamType variant.
 *               `undefined` for unit variants (e.g. `"Notifications"`),
 *               the inner value for newtype/struct variants
 *               (e.g. `42` for `{ "ChatRoom": 42 }`).
 *
 * @returns A fresh handler instance scoped to this single stream.
 *
 * @example
 * ```ts
 * // Unit variant — single stream, data is undefined:
 * mgr.registerUniHandler('Notifications', () => ({
 *     onMessage(n) { addNotification(n); },
 * }));
 *
 * // Newtype variant — one handler per room, data = room ID:
 * mgr.registerUniHandler('ChatRoom', (data) => {
 *     const roomId = data as number;
 *     return {
 *         onMessage(msg) { addMessageToRoom(roomId, msg); },
 *         onClose()      { removeRoom(roomId); },
 *     };
 * });
 * ```
 */
export type UniHandlerFactory<T = unknown> = (
	data: unknown,
) => UniStreamHandler<T>;

/**
 * Factory that creates a new {@link BidiStreamHandler} for each incoming
 * bidirectional stream of a given StreamType.
 *
 * @param data - The StreamType variant payload (see {@link UniHandlerFactory}).
 * @param send - Callback to write a frame back to the server on this stream.
 *
 * @returns A fresh handler instance scoped to this single stream.
 *
 * @example
 * ```ts
 * mgr.registerBidiHandler('Game', (data, send) => {
 *     const gameId = data as string;
 *     return {
 *         onOpen()       { send({ type: 'ready' }); },
 *         onMessage(msg) { applyGameState(gameId, msg); },
 *     };
 * });
 * ```
 */
export type BidiHandlerFactory<TRecv = unknown, TSend = unknown> = (
	data: unknown,
	send: (msg: TSend) => void,
) => BidiStreamHandler<TRecv>;
