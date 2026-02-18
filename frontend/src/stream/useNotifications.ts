import { useEffect, useRef, useCallback, useState } from 'react';
import { CompressedCborDecoder, initZstd } from './CompressedCborCodec';
import apiClient from '../api/client';
import type { StreamType, NotificationPayload, WireNotification } from './types';

export type NotificationListener = (payload: NotificationPayload) => void;

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

// SPKI hash of the self-signed certificate (base64 of SHA-256 of the public key)
const CERT_HASH = 'SWRyW9xdpvhsIiNhOSFLMjKVQM6R6p91espcwnMRdHs=';

function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function useNotifications(userLoggedIn: boolean) {
	const listenersRef = useRef<Set<NotificationListener>>(new Set());
	const cleanupRef = useRef<(() => void) | null>(null);
	const [connected, setConnected] = useState(false);

	const subscribe = useCallback((listener: NotificationListener) => {
		listenersRef.current.add(listener);
		return () => {
			listenersRef.current.delete(listener);
		};
	}, []);

	const dispatch = useCallback((payload: NotificationPayload) => {
		for (const listener of listenersRef.current) {
			try {
				listener(payload);
			} catch (e) {
				console.error('Notification listener error:', e);
			}
		}
	}, []);

	useEffect(() => {
		if (!userLoggedIn) {
			cleanupRef.current?.();
			cleanupRef.current = null;
			setConnected(false);
			return;
		}

		const abortController = new AbortController();
		const { signal } = abortController;
		let reconnectDelay = INITIAL_RECONNECT_DELAY;
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

		async function connect() {
			if (signal.aborted) return;

			try {
				await initZstd();

				const url = `https://127.0.0.1:8443/api/stream/connect`;
				const wt = new WebTransport(url, {
					serverCertificateHashes: [
						{
							algorithm: 'sha-256',
							value: base64ToUint8Array(CERT_HASH),
						},
					],
				});
				await wt.ready;

				if (signal.aborted) {
					wt.close();
					return;
				}

				console.log('WebTransport connected');
				setConnected(true);
				reconnectDelay = INITIAL_RECONNECT_DELAY;

				// Read the bidi stream (Ctrl) opened by the server
				const bidiReader = wt.incomingBidirectionalStreams.getReader();
				const { value: ctrlStream, done: bidiDone } = await bidiReader.read();
				bidiReader.releaseLock();

				if (bidiDone || !ctrlStream || signal.aborted) {
					wt.close();
					return;
				}

				// Decode the Ctrl message to get the PendingConnectionKey
				const ctrlDecoder = new CompressedCborDecoder<StreamType>();
				const ctrlReader = ctrlStream.readable.getReader();
				let pendingKey: { connection_id: number; challenge: string } | null = null;

				while (!pendingKey) {
					const { value, done } = await ctrlReader.read();
					if (done || signal.aborted) break;
					const msgs = ctrlDecoder.push(value);
					for (const msg of msgs) {
						if (typeof msg === 'object' && msg !== null && 'Ctrl' in msg) {
							pendingKey = msg.Ctrl;
							break;
						}
					}
				}
				ctrlReader.releaseLock();

				if (!pendingKey || signal.aborted) {
					wt.close();
					return;
				}

				// POST /api/stream/bind to authenticate the connection
				await apiClient.post('/stream/bind', {
					connection_id: pendingKey.connection_id,
					challenge: pendingKey.challenge,
				});

				if (signal.aborted) {
					wt.close();
					return;
				}

				// Listen for incoming uni streams (Notifications)
				const uniReader = wt.incomingUnidirectionalStreams.getReader();

				// Handle connection close for reconnection
				wt.closed.then(() => {
					if (!signal.aborted) {
						console.log('WebTransport closed, reconnecting...');
						setConnected(false);
						scheduleReconnect();
					}
				}).catch(() => {
					if (!signal.aborted) {
						console.log('WebTransport closed with error, reconnecting...');
						setConnected(false);
						scheduleReconnect();
					}
				});

				// Process uni streams
				(async () => {
					try {
						while (!signal.aborted) {
							const { value: uniStream, done: uniDone } = await uniReader.read();
							if (uniDone || signal.aborted) break;

							// Each uni stream starts with a StreamType header, then messages
							const decoder = new CompressedCborDecoder<StreamType | WireNotification>();
							const streamReader = uniStream.getReader();
							let isNotificationStream = false;
							let headerProcessed = false;

							try {
								while (!signal.aborted) {
									const { value: chunk, done: streamDone } = await streamReader.read();
									if (streamDone || signal.aborted) break;
									const msgs = decoder.push(chunk);

									for (const msg of msgs) {
										if (!headerProcessed) {
											// First message is the StreamType header
											headerProcessed = true;
											if (typeof msg === 'object' && msg !== null && 'Notifications' in msg) {
												isNotificationStream = true;
											}
											continue;
										}
										if (isNotificationStream) {
											const wire = msg as WireNotification;
											dispatch(wire.payload);
										}
									}
								}
							} finally {
								streamReader.releaseLock();
							}
						}
					} catch (e) {
						if (!signal.aborted) {
							console.error('Uni stream reader error:', e);
						}
					} finally {
						uniReader.releaseLock();
					}
				})();

				// Store cleanup for this specific connection
				const closeThisConnection = () => {
					try { wt.close(); } catch { /* already closed */ }
				};

				// Update cleanupRef to also close this connection
				const prevCleanup = cleanupRef.current;
				cleanupRef.current = () => {
					abortController.abort();
					if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
					closeThisConnection();
					prevCleanup?.();
				};

			} catch (e) {
				if (!signal.aborted) {
					console.error('WebTransport connection error:', e);
					setConnected(false);
					scheduleReconnect();
				}
			}
		}

		function scheduleReconnect() {
			if (signal.aborted) return;
			reconnectTimer = setTimeout(() => {
				reconnectTimer = undefined;
				connect();
			}, reconnectDelay);
			reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
		}

		connect();

		cleanupRef.current = () => {
			abortController.abort();
			if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
		};

		return () => {
			cleanupRef.current?.();
			cleanupRef.current = null;
			setConnected(false);
		};
	}, [userLoggedIn, dispatch]);

	return { subscribe, connected };
}
