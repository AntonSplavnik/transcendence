import apiClient from './client';

/**
 * The key the server sends inside the `StreamType::Ctrl` header on the
 * Ctrl uni stream so the client can bind (authenticate) its WebTransport
 * session via an authenticated REST call.
 *
 * Mirrors the backend's `PendingConnectionKey` struct.
 * `challenge` is a base64url-encoded 32-byte random nonce (matches
 * `FixedBlob<32, Bytes>` serialization).
 */
export interface PendingConnectionKey {
	connection_id: number;
	challenge: string;
}

/**
 * Authenticate a WebTransport session by posting the pending connection key.
 *
 * The backend handler (`bind_pending_stream`) is behind `requires_user_login()`,
 * so cookies are sent automatically by the axios client.
 */
export async function bindStream(key: PendingConnectionKey): Promise<void> {
	await apiClient.post('/stream/bind', key);
}
