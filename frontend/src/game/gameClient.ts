import { CompressedCborEncoder, CompressedCborDecoder } from '../stream/CompressedCborCodec';
import type { GameClientMessage, GameServerMessage } from './types';

/**
 * WebTransport client for game server communication
 *
 * Connection flow:
 * 1. Establish WebTransport connection at /api/stream/connect
 * 2. Receive control stream with pending key
 * 3. Authenticate via POST /api/stream/bind (with session cookies)
 * 4. Wait for incoming game stream after joining
 */
export class GameClient {
  private transport: WebTransport | null = null;
  private state: 'idle' | 'connecting' | 'connected' = 'idle';

  async connect(): Promise<void> {
    // 1. Establish WebTransport connection
    // WebTransport must connect directly to backend (not through Vite proxy)
    // Use 127.0.0.1 to match backend binding (avoid IPv6 issues with localhost)
    const url = 'https://127.0.0.1:8443/api/stream/connect';

    console.log('Attempting WebTransport connection to:', url);
    this.transport = new WebTransport(url);

    // Log connection state
    this.transport.closed.then(() => console.log('WebTransport closed'))
      .catch(err => console.error('WebTransport closed with error:', err));

    await this.transport.ready;
    this.state = 'connecting';

    // 2. Receive control stream with pending key
    const controlStreamReader = this.transport.incomingBidirectionalStreams.getReader();
    const { value: controlStream } = await controlStreamReader.read();
    controlStreamReader.releaseLock();

    if (!controlStream) {
      throw new Error('No control stream received');
    }

    const decoder = new CompressedCborDecoder<{ Ctrl: { connection_id: number; challenge: number[] } }>();
    const reader = controlStream.readable.getReader();
    const { value: chunk } = await reader.read();
    reader.releaseLock();

    if (!chunk) {
      throw new Error('No pending key received');
    }

    const [ctrlMessage] = decoder.push(chunk);
    console.log('Received control message:', ctrlMessage);

    // Extract the pending key from the Ctrl wrapper
    const pendingKey = ctrlMessage.Ctrl;
    console.log('Pending key:', pendingKey);

    // 3. Authenticate via REST (session cookies included automatically)
    const response = await fetch('/api/stream/bind', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingKey),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to bind stream: ${response.status} ${text}`);
    }

    this.state = 'connected';
  }

  async waitForGameStream(): Promise<GameStream> {
    if (!this.transport) {
      throw new Error('Not connected');
    }

    const reader = this.transport.incomingBidirectionalStreams.getReader();
    const { value: stream } = await reader.read();
    reader.releaseLock();

    if (!stream) {
      throw new Error('No game stream received');
    }

    // First message is stream type (e.g., "Game")
    const decoder = new CompressedCborDecoder<string>();
    const streamReader = stream.readable.getReader();
    const { value: firstChunk } = await streamReader.read();
    streamReader.releaseLock(); // Release lock before creating GameStream

    if (!firstChunk) {
      throw new Error('No stream type received');
    }

    const [streamType] = decoder.push(firstChunk);
    console.log('Received stream type:', streamType);

    return new GameStream(stream);
  }

  async close(): Promise<void> {
    await this.transport?.close();
    this.transport = null;
    this.state = 'idle';
  }

  get isConnected(): boolean {
    return this.state === 'connected';
  }
}

/**
 * Bidirectional stream for game communication
 *
 * Client sends: Input, RegisterHit, Leave
 * Server sends: Snapshot (20Hz), PlayerJoined, PlayerLeft, Error
 */
export class GameStream {
  private encoder = new CompressedCborEncoder();
  private decoder = new CompressedCborDecoder<GameServerMessage>();
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(stream: WebTransportBidirectionalStream) {
    this.writer = stream.writable.getWriter();
    this.reader = stream.readable.getReader();
  }

  async send(msg: GameClientMessage): Promise<void> {
    const frame = this.encoder.encode(msg);
    await this.writer.write(frame);
    // Ensure the message is sent immediately, not buffered
    if ('flush' in this.writer && typeof this.writer.flush === 'function') {
      await (this.writer as any).flush();
    }
  }

  async *receive(): AsyncGenerator<GameServerMessage> {
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;

        const messages = this.decoder.push(value);
        for (const msg of messages) {
          yield msg;
        }
      }
    } finally {
      this.reader.releaseLock();
    }
  }

  async close(): Promise<void> {
    await this.send({ type: 'Leave' });
    await this.writer.close();
    this.reader.releaseLock();
  }
}
