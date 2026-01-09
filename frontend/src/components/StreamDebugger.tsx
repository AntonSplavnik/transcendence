import { useEffect, useMemo, useRef, useState } from 'react';
import {
	WebTransportClient,
	type WebTransportDebugSnapshot,
	WebTransportNotSupportedError,
} from '../stream/client';
import Button from './ui/Button';
import Card from './ui/Card';

function isDebuggerEnabled(): boolean {
	const params = new URLSearchParams(window.location.search);
	if (params.get('debug') === 'streams') {
		return true;
	}
	return localStorage.getItem('debug.streams') === '1';
}

function formatTime(ts?: number): string {
	if (!ts) {
		return '-';
	}
	return new Date(ts).toLocaleTimeString();
}

export default function StreamDebugger() {
	const enabled = useMemo(() => isDebuggerEnabled(), []);
	const clientRef = useRef<WebTransportClient | null>(null);
	const [snapshot, setSnapshot] = useState<WebTransportDebugSnapshot | null>(null);
	const [log, setLog] = useState<string[]>([]);
	const [panelOpen, setPanelOpen] = useState(true);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const client = new WebTransportClient();
		clientRef.current = client;

		const unsub = client.onDebugUpdate((next) => {
			setSnapshot(next);
			setLog((prev) => {
				const line = `[${formatTime(next.lastEventAt)}] state=${next.state}`;
				const out = prev.length >= 200 ? prev.slice(prev.length - 199) : prev;
				// Avoid spamming identical consecutive state lines.
				if (out[out.length - 1] === line) {
					return out;
				}
				return [...out, line];
			});
		});

		const unsubStream = client.onStream(async (type) => {
			setLog((prev) => {
				const out = prev.length >= 200 ? prev.slice(prev.length - 199) : prev;
				return [...out, `[${formatTime(Date.now())}] incoming stream: ${type}`];
			});
		});

		return () => {
			unsub();
			unsubStream();
			void client.close();
			clientRef.current = null;
		};
	}, [enabled]);

	if (!enabled) {
		return null;
	}

	const current = snapshot;
	const state = current?.state ?? 'idle';
	const canConnect = state === 'idle' || state === 'closed' || state === 'error';
	const canClose = state === 'connected' || state === 'connecting';

	const connect = async () => {
		const client = clientRef.current;
		if (!client) {
			return;
		}
		try {
			await client.connect();
		} catch (e) {
			const msg =
				e instanceof WebTransportNotSupportedError
					? e.message
					: `connect failed: ${String(e)}`;
			setLog((prev) => [...prev.slice(-199), `[${formatTime(Date.now())}] ${msg}`]);
		}
	};

	const close = async () => {
		const client = clientRef.current;
		if (!client) {
			return;
		}
		await client.close();
	};

	return (
		<div className="fixed bottom-4 right-4 z-50">
			<Card className="p-4 w-[360px]">
				<div className="flex items-center justify-between mb-3">
					<div>
						<div className="text-sm font-semibold text-wood-100">
							Stream Debugger
						</div>
						<div className="text-xs text-wood-300">
							enabled via <span className="text-wood-100">?debug=streams</span> or{' '}
							<span className="text-wood-100">localStorage debug.streams=1</span>
						</div>
					</div>
					<Button
						variant="secondary"
						className="px-3 py-1"
						onClick={() => setPanelOpen((v) => !v)}
					>
						{panelOpen ? 'Hide' : 'Show'}
					</Button>
				</div>

				{panelOpen && (
					<div className="space-y-3">
						<div className="text-xs text-wood-300 space-y-1">
							<div>
								<span className="text-wood-100">State:</span> {state}
							</div>
							<div>
								<span className="text-wood-100">URL:</span>{' '}
								{current?.url ?? new URL('/api/wt', window.location.href).toString()}
							</div>
							<div>
								<span className="text-wood-100">Heartbeat:</span>{' '}
								{current?.heartbeatReceived ? 'received' : 'not yet'}
							</div>
							<div>
								<span className="text-wood-100">Streams:</span>{' '}
								{current?.streamsTotal ?? 0}
							</div>
							{current?.lastStreamType && (
								<div>
									<span className="text-wood-100">Last stream:</span>{' '}
									#{current.lastStreamId} {current.lastStreamType}
								</div>
							)}
							{current?.lastError && (
								<div className="text-red-200">
									<span className="text-wood-100">Last error:</span>{' '}
									{current.lastError}
								</div>
							)}
						</div>

						<div className="flex gap-2">
							<Button
								variant="primary"
								className="flex-1"
								onClick={connect}
								disabled={!canConnect}
							>
								Connect
							</Button>
							<Button
								variant="secondary"
								className="flex-1"
								onClick={close}
								disabled={!canClose}
							>
								Close
							</Button>
							<Button
								variant="secondary"
								className="px-3"
								onClick={() => setLog([])}
							>
								Clear
							</Button>
						</div>

						<div className="bg-wood-900 border border-wood-700 rounded p-2 h-40 overflow-auto text-xs text-wood-200">
							{log.length === 0 ? (
								<div className="text-wood-400 italic">No events yet.</div>
							) : (
								log.map((line, idx) => <div key={idx}>{line}</div>)
							)}
						</div>
					</div>
				)}
			</Card>
		</div>
	);
}
