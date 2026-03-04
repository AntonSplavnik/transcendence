/*
 * StreamContext — React integration for the WebTransport ConnectionManager.
 *
 * Provides:
 *   - `StreamProvider`:  owns the `ConnectionManager` instance, connects when
 *     the user is authenticated, disconnects on logout.
 *   - `useStream()`:     returns the manager and the current connection state.
 *
 * Must be nested inside `AuthProvider` (reads user state).
 */

import type { ReactNode } from 'react';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from 'react';

import { CborZstdCodec, initZstd } from '../stream/codec';
import { ConnectionManager } from '../stream/ConnectionManager';
import type { ConnectionState } from '../stream/types';
import { useAuth } from './AuthContext';

// ─── Context ─────────────────────────────────────────────────────────────────

interface StreamContextType {
	/** The underlying connection manager.  Use for handler registration. */
	connectionManager: ConnectionManager;
	/** Observable connection state (reactive). */
	connectionState: ConnectionState;
}

const StreamContext = createContext<StreamContextType | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export function StreamProvider({ children }: { children: ReactNode }) {
	const { user } = useAuth();

	// Create the ConnectionManager once and keep it for the lifetime of the
	// provider.  It is framework-agnostic, so we just hold a stable reference.
	// Note: we use lazy initialisation via state (not ref) so that React
	// StrictMode's dev-only mount→unmount→remount cycle gets a *fresh*
	// instance after the first one is destroyed.
	const [manager] = useState(
		() => new ConnectionManager({ codec: new CborZstdCodec() }),
	);

	const [connectionState, setConnectionState] = useState<ConnectionState>(
		() => manager.getState(),
	);

	// Subscribe to state changes from the manager.
	useEffect(() => {
		const unsubscribe = manager.subscribe(setConnectionState);
		return unsubscribe;
	}, [manager]);

	// Connect when authenticated, disconnect when not.
	const connectIfAuth = useCallback(async () => {
		if (!user) {
			manager.disconnect();
			return;
		}

		try {
			await initZstd();
			await manager.connect();
		} catch (err) {
			console.error('[StreamProvider] initial connect failed:', err);
			// Reconnection is handled internally by the manager.
		}
	}, [user, manager]);

	useEffect(() => {
		connectIfAuth();
	}, [connectIfAuth]);

	// Disconnect on unmount.
	// We intentionally use disconnect() rather than destroy() so that the
	// manager instance remains reusable.  In development, React StrictMode
	// mounts → unmounts → remounts every component; destroy() would
	// permanently invalidate the instance that useState still holds.
	// On true unmount the manager (and its state) is garbage-collected.
	useEffect(() => {
		return () => {
			manager.disconnect();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<StreamContext.Provider
			value={{ connectionManager: manager, connectionState }}
		>
			{children}
		</StreamContext.Provider>
	);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function useStream(): StreamContextType {
	const ctx = useContext(StreamContext);
	if (!ctx) {
		throw new Error('useStream must be used within a StreamProvider');
	}
	return ctx;
}
