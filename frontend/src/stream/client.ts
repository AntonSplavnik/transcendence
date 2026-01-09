import { FramedReader, FramedWriter } from './codec';
import { STREAM_TYPES, type StreamType } from './types';

export class WebTransportNotSupportedError extends Error {
	constructor() {
		super('WebTransport is not supported in this browser');
		this.name = 'WebTransportNotSupportedError';
	}
}

export class WebTransportNotConnectedError extends Error {
	constructor() {
		super('WebTransport is not connected');
		this.name = 'WebTransportNotConnectedError';
	}
}

export type IncomingStreamHandler = (
	streamType: StreamType,
	stream: TypedBidiStream,
) => void | Promise<void>;

export class TypedBidiStream {
	readonly writer: FramedWriter;
	readonly reader: FramedReader;

	constructor(stream: WebTransportBidirectionalStream) {
		this.writer = new FramedWriter(stream.writable);
		this.reader = new FramedReader(stream.readable);
	}

	send(value: unknown): Promise<void> {
		return this.writer.send(value);
	}

	receive<T = unknown>(): AsyncGenerator<T, void, void> {
		return this.reader.messages<T>();
	}

	async close(): Promise<void> {
		await Promise.allSettled([this.reader.cancel(), this.writer.close()]);
	}
}

export class WebTransportClient {
	private transport: WebTransport | null = null;
	private heartbeatStream: WebTransportBidirectionalStream | null = null;
	private incomingLoop: Promise<void> | null = null;
	private handlers = new Set<IncomingStreamHandler>();
	private readonly url: string;
	private debugListeners = new Set<(snapshot: WebTransportDebugSnapshot) => void>();
	private debugSnapshot: WebTransportDebugSnapshot;
	private streamCounter = 0;

	constructor(url?: string) {
		this.url = url ?? new URL('/api/wt', window.location.href).toString();
		this.debugSnapshot = {
			url: this.url,
			state: 'idle',
			streamsTotal: 0,
			streamsByType: {},
		};
	}

	getDebugSnapshot(): WebTransportDebugSnapshot {
		return this.debugSnapshot;
	}

	onDebugUpdate(handler: (snapshot: WebTransportDebugSnapshot) => void): () => void {
		this.debugListeners.add(handler);
		// Emit immediately so UIs can render current state.
		handler(this.debugSnapshot);
		return () => this.debugListeners.delete(handler);
	}

	get isConnected(): boolean {
		return this.transport !== null;
	}

	onStream(handler: IncomingStreamHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	async connect(): Promise<void> {
		if (this.transport) {
			return;
		}
		this.updateDebug({ state: 'connecting', lastError: undefined });

		const WT = (globalThis as any).WebTransport as
			| (new (url: string) => WebTransport)
			| undefined;
		if (!WT) {
			throw new WebTransportNotSupportedError();
		}

		const transport = new WT(this.url);
		this.transport = transport;

		try {
			await transport.ready;
		} catch (e) {
			this.updateDebug({ state: 'error', lastError: String(e) });
			this.transport = null;
			transport.close();
			throw e;
		}
		this.updateDebug({ state: 'connected' });

		transport.closed
			.then(() => {
				// If close() was called, state may already be closed; keep it idempotent.
				this.updateDebug({ state: 'closed' });
			})
			.catch((e) => {
				this.updateDebug({ state: 'error', lastError: String(e) });
			});

		this.incomingLoop = this.runIncomingLoop(transport);
	}

	async close(): Promise<void> {
		const transport = this.transport;
		this.transport = null;
		this.updateDebug({ state: 'closed' });

		if (transport) {
			try {
				transport.close();
			} catch {
				// ignore
			}
		}

		if (this.heartbeatStream) {
			this.heartbeatStream = null;
		}

		if (this.incomingLoop) {
			await Promise.race([
				this.incomingLoop,
				new Promise<void>((resolve) => setTimeout(resolve, 250)),
			]);
			this.incomingLoop = null;
		}
	}

	private async runIncomingLoop(transport: WebTransport): Promise<void> {
		const reader = transport.incomingBidirectionalStreams.getReader();
		try {
			let isFirst = true;
			while (true) {
				const result = await reader.read();
				if (result.done) {
					return;
				}
				const stream = result.value;

				if (isFirst) {
					isFirst = false;
					this.heartbeatStream = stream;
					this.updateDebug({ heartbeatReceived: true });
					continue;
				}

				void this.handleIncomingStream(stream);
			}
		} catch (e) {
			this.updateDebug({ state: 'error', lastError: String(e) });
		} finally {
			reader.releaseLock();
		}
	}

	private async handleIncomingStream(
		stream: WebTransportBidirectionalStream,
	): Promise<void> {
		const streamId = ++this.streamCounter;
		this.updateDebug({ streamsTotal: this.debugSnapshot.streamsTotal + 1 });
		const framed = new TypedBidiStream(stream);
		let first: unknown | null;
		try {
			first = await framed.reader.readOne();
		} catch {
			this.updateDebug({ lastError: `stream ${streamId}: failed to read stream type` });
			await framed.close();
			return;
		}
		if (first === null || typeof first !== 'string') {
			this.updateDebug({ lastError: `stream ${streamId}: invalid stream type frame` });
			await framed.close();
			return;
		}

		if (!STREAM_TYPES.has(first as StreamType)) {
			this.updateDebug({ lastError: `stream ${streamId}: unknown stream type '${first}'` });
			await framed.close();
			return;
		}

		const streamType = first as StreamType;
		this.updateDebug({
			streamsByType: {
				...this.debugSnapshot.streamsByType,
				[streamType]: (this.debugSnapshot.streamsByType[streamType] ?? 0) + 1,
			},
			lastStreamType: streamType,
			lastStreamId: streamId,
		});
		for (const handler of this.handlers) {
			await handler(streamType, framed);
		}
	}

	private updateDebug(patch: Partial<WebTransportDebugSnapshot>): void {
		this.debugSnapshot = {
			...this.debugSnapshot,
			...patch,
			lastEventAt: Date.now(),
		};
		if (this.debugListeners.size === 0) {
			return;
		}
		for (const listener of this.debugListeners) {
			listener(this.debugSnapshot);
		}
	}
}

export type WebTransportConnectionState =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'closed'
	| 'error';

export type WebTransportDebugSnapshot = {
	url: string;
	state: WebTransportConnectionState;
	heartbeatReceived?: boolean;
	streamsTotal: number;
	streamsByType: Record<string, number>;
	lastStreamType?: string;
	lastStreamId?: number;
	lastError?: string;
	lastEventAt?: number;
};
