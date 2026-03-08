/*
 * ConnectionManager — WebTransport connection lifecycle and stream dispatch.
 *
 * Pure TypeScript (no React dependency).  Manages:
 *   1. WebTransport session establishment
 *   2. Two-step auth handshake  (Ctrl uni stream → REST bind)
 *   3. Automatic reconnection with exponential backoff
 *   4. Incoming stream acceptance and handler dispatch
 *   5. Session displacement detection via Ctrl stream
 *   6. Observable connection state for reactive UI
 *
 * Usage:
 *   const mgr = new ConnectionManager({ codec: new CborZstdCodec() });
 *   mgr.registerUniHandler('Notifications', () => ({
 *     onMessage(n) { … },
 *   }));
 *   await mgr.connect();
 *   // … later …
 *   mgr.disconnect();
 *   mgr.destroy();
 *
 * Architecture notes
 * ──────────────────
 * The server has sole authority over opening streams.  Every incoming stream
 * (uni or bidi) starts with a single CBOR frame containing the `StreamType`
 * header.  The manager reads this header, looks up the handler registry, and
 * dispatches.  The client never opens streams itself.
 *
 * Connection-lifecycle signaling uses a dedicated Ctrl uni stream:
 *   - The first incoming uni stream carries `StreamType::Ctrl(key)` as its
 *     header, providing the `PendingConnectionKey` for the auth handshake.
 *   - After authentication, subsequent CBOR frames on that stream carry
 *     `CtrlMessage` values (e.g. `Displaced`).
 *
 * See: backend/src/stream/stream_manager.rs  (server-side counterpart)
 */

import type { PendingConnectionKey } from '../api/stream';
import { bindStream } from '../api/stream';
import type { Codec, StreamDecoder } from './codec';
import {
	parseStreamType,
	type BidiHandlerFactory,
	type BidiStreamHandler,
	type ConnectionState,
	type CtrlMessage,
	type UniHandlerFactory,
	type UniStreamHandler,
} from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Initial reconnect delay in milliseconds. */
const BASE_RETRY_MS = 1_000;
/** Maximum reconnect delay in milliseconds. */
const MAX_RETRY_MS = 40_000;
/** Maximum random jitter added to each retry delay (ms). */
const JITTER_MS = 500;

// ─── Configuration ───────────────────────────────────────────────────────────

export interface ConnectionManagerOptions {
	/**
	 * Wire-format codec (encode/decode).
	 * Swap this to change the serialization format without touching transport.
	 */
	codec: Codec;

	/**
	 * Returns the WebTransport URL to connect to.
	 *
	 * Called on every connect/reconnect attempt so the URL can change
	 * dynamically.
	 *
	 * Default implementation:
	 *   - Dev (VITE_STREAM_URL set):  uses the env var directly
	 *   - Prod:                        derives from `window.location`
	 */
	getStreamUrl?: () => string;

	/** Maximum number of reconnect attempts.  `Infinity` = unlimited. */
	maxRetries?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultStreamUrl(): string {
	const envUrl = import.meta.env.VITE_STREAM_URL as string | undefined;
	if (envUrl) return envUrl;
	return `https://${window.location.host}/api/stream/connect`;
}

function retryDelay(attempt: number): number {
	const exp = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
	const jitter = Math.random() * JITTER_MS;
	return exp + jitter;
}

// ─── ConnectionManager ──────────────────────────────────────────────────────

type StateListener = (state: ConnectionState) => void;

export class ConnectionManager {
	// -- configuration --
	private readonly codec: Codec;
	private readonly getStreamUrl: () => string;
	private readonly maxRetries: number;

	// -- handler registries (factories, not instances) --
	private readonly uniFactories = new Map<string, UniHandlerFactory>();
	private readonly bidiFactories = new Map<string, BidiHandlerFactory>();

	// -- connection state --
	private state: ConnectionState = { status: 'disconnected' };
	private listeners = new Set<StateListener>();
	private session: WebTransport | null = null;
	private abortController: AbortController | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempt = 0;
	private intentionalDisconnect = false;
	private destroyed = false;

	constructor(options: ConnectionManagerOptions) {
		this.codec = options.codec;
		this.getStreamUrl = options.getStreamUrl ?? defaultStreamUrl;
		this.maxRetries = options.maxRetries ?? Infinity;
	}

	// ── State observation ────────────────────────────────────────────────────

	/** Current connection state (readonly snapshot). */
	getState(): ConnectionState {
		return this.state;
	}

	/**
	 * Subscribe to state changes.
	 * @returns An unsubscribe function.
	 */
	subscribe(listener: StateListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setState(next: ConnectionState): void {
		this.state = next;
		for (const fn of this.listeners) {
			try {
				fn(next);
			} catch (e) {
				console.error('[ConnectionManager] listener threw:', e);
			}
		}
	}

	// ── Handler registration ─────────────────────────────────────────────────

	/**
	 * Register a factory for unidirectional (server → client) streams.
	 *
	 * The factory is called once per incoming stream of this type, receiving
	 * the StreamType variant payload.  It must return a handler instance
	 * scoped to that single stream.
	 */
	registerUniHandler(streamType: string, factory: UniHandlerFactory): void {
		if (this.uniFactories.has(streamType) || this.bidiFactories.has(streamType)) {
			console.warn(`[ConnectionManager] replacing existing handler for "${streamType}"`);
		}
		this.bidiFactories.delete(streamType);
		this.uniFactories.set(streamType, factory);
	}

	/**
	 * Register a factory for bidirectional streams.
	 *
	 * The factory receives the StreamType variant payload and a `send`
	 * callback for writing frames back to the server.  It must return a
	 * handler instance scoped to that single stream.
	 */
	registerBidiHandler(streamType: string, factory: BidiHandlerFactory): void {
		if (this.bidiFactories.has(streamType) || this.uniFactories.has(streamType)) {
			console.warn(`[ConnectionManager] replacing existing handler for "${streamType}"`);
		}
		this.uniFactories.delete(streamType);
		this.bidiFactories.set(streamType, factory);
	}

	unregisterHandler(streamType: string): void {
		this.uniFactories.delete(streamType);
		this.bidiFactories.delete(streamType);
	}

	// ── Connect / disconnect ─────────────────────────────────────────────────

	/**
	 * Initiate a WebTransport connection.
	 *
	 * Resolves once the initial connection attempt has completed (successfully
	 * or not).  Connection failures are handled internally by scheduling
	 * automatic reconnection.  Observe progress via
	 * {@link subscribe} / {@link getState}.
	 *
	 * @throws {Error} If the manager has been {@link destroy}ed.
	 */
	async connect(): Promise<void> {
		if (this.destroyed) throw new Error('ConnectionManager is destroyed');
		if (
			this.state.status === 'connecting' ||
			this.state.status === 'authenticating' ||
			this.state.status === 'connected'
		) {
			return; // already connecting or connected
		}

		this.intentionalDisconnect = false;
		this.clearReconnectTimer();
		await this.doConnect();
	}

	/**
	 * Gracefully disconnect.  No reconnection will be attempted.
	 */
	disconnect(): void {
		this.intentionalDisconnect = true;
		this.teardown();
		this.setState({ status: 'disconnected' });
	}

	/**
	 * Permanently destroy this manager.
	 *
	 * Disconnects, clears all handlers and listeners.  The instance must not
	 * be reused after this call.
	 */
	destroy(): void {
		this.destroyed = true;
		this.disconnect();
		this.uniFactories.clear();
		this.bidiFactories.clear();
		this.listeners.clear();
	}

	// ── Internal: connection lifecycle ────────────────────────────────────────

	private async doConnect(): Promise<void> {
		this.setState({ status: 'connecting' });
		const ac = new AbortController();
		this.abortController = ac;
		// Capture the signal locally — `teardown()` nulls `this.abortController`
		// but the signal's `aborted` flag persists on the original object.
		const signal = ac.signal;

		let wt: WebTransport;
		try {
			const url = this.getStreamUrl();
			wt = new WebTransport(url);
			await wt.ready;
		} catch (err) {
			console.warn('[ConnectionManager] WebTransport connect failed:', err);
			this.scheduleReconnect();
			return;
		}

		if (signal.aborted) {
			wt.close();
			return;
		}

		this.session = wt;

		// ── Step 1: Read PendingConnectionKey from Ctrl uni stream ─────
		this.setState({ status: 'authenticating' });

		let pendingKey: PendingConnectionKey;
		let ctrlReader: ReadableStreamDefaultReader<Uint8Array>;
		let ctrlDecoder: StreamDecoder<CtrlMessage>;
		try {
			const result = await this.readCtrlHeader(wt);
			pendingKey = result.key;
			ctrlReader = result.reader;
			ctrlDecoder = result.decoder;
		} catch (err) {
			if (signal.aborted) return; // disconnect() was called — not an error
			console.warn('[ConnectionManager] ctrl stream handshake failed:', err);
			this.teardown();
			this.scheduleReconnect();
			return;
		}

		if (signal.aborted) {
			this.teardown();
			return;
		}

		// ── Step 2: Authenticated REST bind ──────────────────────────────
		try {
			await bindStream(pendingKey);
		} catch (err) {
			if (signal.aborted) return;
			console.warn('[ConnectionManager] bind failed:', err);
			this.teardown();
			this.scheduleReconnect();
			return;
		}

		if (signal.aborted) {
			this.teardown();
			return;
		}

		// ── Connected ────────────────────────────────────────────────────
		this.reconnectAttempt = 0;
		this.setState({ status: 'connected' });

		// Start accept loops (fire-and-forget; they exit on session close).
		this.acceptUniStreams(wt);
		this.acceptBidiStreams(wt);
		this.listenCtrlStream(ctrlReader, ctrlDecoder);

		// Monitor session closure for reconnection.
		wt.closed
			.then(() => {
				console.debug('[ConnectionManager] session closed');
				this.onSessionClosed();
			})
			.catch((err: unknown) => {
				console.debug('[ConnectionManager] session lost:', err);
				this.onSessionClosed();
			});
	}

	/**
	 * Accept the first incoming uni stream (the Ctrl stream), decode its
	 * `StreamType::Ctrl(key)` header, and return the extracted
	 * {@link PendingConnectionKey} together with the still-open reader and
	 * decoder so the caller can continue reading {@link CtrlMessage}s.
	 */
	private async readCtrlHeader(
		wt: WebTransport,
	): Promise<{
		key: PendingConnectionKey;
		reader: ReadableStreamDefaultReader<Uint8Array>;
		decoder: StreamDecoder<CtrlMessage>;
	}> {
		const uniReader = wt.incomingUnidirectionalStreams.getReader();
		let ctrlStream: ReadableStream<Uint8Array>;
		try {
			const { value, done } = await uniReader.read();
			if (done || !value) {
				throw new Error('Uni stream closed before Ctrl stream arrived');
			}
			ctrlStream = value;
		} finally {
			uniReader.releaseLock();
		}

		const decoder = this.codec.createDecoder<CtrlMessage>();
		const reader = ctrlStream.getReader();

		// Read chunks until the first CBOR message (the StreamType header)
		// is fully decoded.
		while (true) {
			const { value: chunk, done } = await reader.read();
			if (done || !chunk) {
				reader.releaseLock();
				throw new Error('Ctrl stream ended before StreamType header');
			}
			const msgs = decoder.push(chunk);
			if (msgs.length > 0) {
				const { key, data } = parseStreamType(msgs[0]);
				if (key !== 'Ctrl' || data === undefined) {
					reader.releaseLock();
					throw new Error(
						`Expected StreamType::Ctrl header, got: ${JSON.stringify(msgs[0])}`,
					);
				}
				// Any remaining decoded messages in `msgs` would be CtrlMessages
				// that arrived in the same chunk — handle them immediately.
				for (let i = 1; i < msgs.length; i++) {
					this.handleCtrlMessage(msgs[i] as CtrlMessage);
				}
				return { key: data as PendingConnectionKey, reader, decoder };
			}
		}
	}

	/**
	 * Continue reading {@link CtrlMessage}s from the already-open Ctrl
	 * stream.  Currently handles only `Displaced`.
	 */
	private async listenCtrlStream(
		reader: ReadableStreamDefaultReader<Uint8Array>,
		decoder: StreamDecoder<CtrlMessage>,
	): Promise<void> {
		try {
			while (true) {
				const { value: chunk, done } = await reader.read();
				if (done || !chunk) break;

				const msgs = decoder.push(chunk);
				for (const msg of msgs) {
					this.handleCtrlMessage(msg);
				}
			}
		} catch {
			// Reader throws when the session closes — expected.
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * Process a single {@link CtrlMessage}.
	 */
	private handleCtrlMessage(msg: CtrlMessage): void {
		if (msg === 'Displaced') {
			console.info('[ConnectionManager] displaced by another session');
			this.intentionalDisconnect = true;
			this.setState({ status: 'displaced' });
			return;
		}
		console.warn('[ConnectionManager] unknown ctrl message:', msg);
	}

	// ── Internal: stream acceptance loops ────────────────────────────────────

	/**
	 * Accept incoming unidirectional (server → client) streams.
	 *
	 * Each stream's first frame is the `StreamType` header.  The handler is
	 * looked up in the uni-handler registry and subsequent frames are
	 * dispatched to `handler.onMessage`.
	 */
	private async acceptUniStreams(wt: WebTransport): Promise<void> {
		const reader = wt.incomingUnidirectionalStreams.getReader();
		try {
			while (true) {
				const { value: stream, done } = await reader.read();
				if (done || !stream) break;
				// Handle each stream concurrently.
				this.handleUniStream(stream).catch((err) => {
					console.warn('[ConnectionManager] uni stream error:', err);
				});
			}
		} catch (err) {
			// Reader throws when the session closes — expected.
			if (this.state.status === 'connected') {
				console.warn('[ConnectionManager] uni accept loop error:', err);
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * Accept incoming bidirectional streams.
	 */
	private async acceptBidiStreams(wt: WebTransport): Promise<void> {
		const reader = wt.incomingBidirectionalStreams.getReader();
		try {
			while (true) {
				const { value: stream, done } = await reader.read();
				if (done || !stream) break;
				this.handleBidiStream(stream).catch((err) => {
					console.warn('[ConnectionManager] bidi stream error:', err);
				});
			}
		} catch (err) {
			if (this.state.status === 'connected') {
				console.warn('[ConnectionManager] bidi accept loop error:', err);
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * Process a single unidirectional stream:
	 *   1. Decode the StreamType header.
	 *   2. Look up the handler.
	 *   3. Feed subsequent frames to `handler.onMessage`.
	 */
	private async handleUniStream(
		stream: ReadableStream<Uint8Array>,
	): Promise<void> {
		const decoder: StreamDecoder = this.codec.createDecoder();
		const reader = stream.getReader();
		let handler: UniStreamHandler | undefined;
		let headerParsed = false;

		try {
			while (true) {
				const { value: chunk, done } = await reader.read();
				if (done) break;
				if (!chunk) continue;

				const msgs = decoder.push(chunk);
				for (const msg of msgs) {
					if (!headerParsed) {
						// First decoded message is the StreamType header.
						headerParsed = true;
						const { key, data } = parseStreamType(msg);
						const factory = this.uniFactories.get(key);
						if (!factory) {
							console.warn(`[ConnectionManager] no uni handler for "${key}", ignoring stream`);
							await reader.cancel(`No uni handler registered for "${key}"`);
							return;
						}
						handler = factory(data);
						handler.onOpen?.();
						continue;
					}
					handler!.onMessage(msg);
				}
			}
			handler?.onClose?.();
		} catch (err) {
			if (handler) {
				handler.onError?.(err);
				handler.onClose?.();
			} else {
				console.warn('[ConnectionManager] uni stream failed before header:', err);
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * Process a single bidirectional stream:
	 *   1. Decode the StreamType header from the readable side.
	 *   2. Look up the handler.
	 *   3. Provide a `send` function wrapping the writable side.
	 *   4. Feed subsequent frames to `handler.onMessage`.
	 */
	private async handleBidiStream(
		stream: WebTransportBidirectionalStream,
	): Promise<void> {
		const decoder: StreamDecoder = this.codec.createDecoder();
		const reader = stream.readable.getReader();
		const writer = stream.writable.getWriter();
		let handler: BidiStreamHandler | undefined;
		let headerParsed = false;

		const send = (msg: unknown): void => {
			const frame = this.codec.encode(msg);
			writer.write(frame).catch((err) => {
				console.warn('[ConnectionManager] bidi send error:', err);
			});
		};

		try {
			while (true) {
				const { value: chunk, done } = await reader.read();
				if (done) break;
				if (!chunk) continue;

				const msgs = decoder.push(chunk);
				for (const msg of msgs) {
					if (!headerParsed) {
						headerParsed = true;
						const { key, data } = parseStreamType(msg);
						const factory = this.bidiFactories.get(key);
						if (!factory) {
							console.warn(`[ConnectionManager] no bidi handler for "${key}", ignoring stream`);
							try {
								await reader.cancel(`No bidi handler registered for "${key}"`);
							} catch {
								// Ignore cancellation errors.
							}
							try {
								await writer.close();
							} catch {
								// Ignore close errors; writer may already be closed.
							}
							return;
						}
						handler = factory(data, send);
						handler.onOpen?.();
						continue;
					}
					handler!.onMessage(msg);
				}
			}
			handler?.onClose?.();
		} catch (err) {
			if (handler) {
				handler.onError?.(err);
				handler.onClose?.();
			} else {
				console.warn('[ConnectionManager] bidi stream failed before header:', err);
			}
		} finally {
			reader.releaseLock();
			try {
				writer.releaseLock();
			} catch {
				// Writer may already be released if the session is closed.
			}
		}
	}

	// ── Internal: reconnection ───────────────────────────────────────────────

	/**
	 * Handle session closure.
	 *
	 * If the session was displaced (detected via Ctrl stream), the state is
	 * already set and reconnection is suppressed.  Otherwise, schedule
	 * automatic reconnection.
	 */
	private onSessionClosed(): void {
		this.session = null;
		if (this.intentionalDisconnect || this.destroyed) {
			if (this.state.status !== 'displaced') {
				this.setState({ status: 'disconnected' });
			}
			return;
		}
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (this.intentionalDisconnect || this.destroyed) return;

		const attempt = this.reconnectAttempt;
		if (attempt >= this.maxRetries) {
			console.warn(`[ConnectionManager] max retries (${this.maxRetries}) reached`);
			this.setState({ status: 'disconnected' });
			return;
		}

		const delay = retryDelay(attempt);
		this.reconnectAttempt = attempt + 1;
		this.setState({ status: 'reconnecting', attempt, nextRetryMs: delay });

		this.clearReconnectTimer();
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.doConnect().catch(() => {
				this.scheduleReconnect();
			});
		}, delay);
	}

	// ── Internal: cleanup helpers ────────────────────────────────────────────

	private teardown(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.clearReconnectTimer();

		if (this.session) {
			try {
				this.session.close();
			} catch {
				// Already closed.
			}
			this.session = null;
		}
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}
}
