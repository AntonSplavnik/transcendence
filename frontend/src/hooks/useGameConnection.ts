import { useState, useEffect, useRef } from 'react';
import { GameClient, GameStream } from '../game/gameClient';
import { initZstd } from '../stream/CompressedCborCodec';
import apiClient from '../api/client';
import type { GameStateSnapshot, Vector3D } from '../game/types';

type ConnectionState = 'idle' | 'initializing' | 'connecting' | 'connected' | 'joining' | 'in-game' | 'error';

export function useGameConnection() {
  const [state, setState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GameStateSnapshot | null>(null);
  const clientRef = useRef<GameClient | null>(null);
  const streamRef = useRef<GameStream | null>(null);

  // Initialize Zstd on mount
  useEffect(() => {
    setState('initializing');
    initZstd()
      .then(() => setState('idle'))
      .catch(err => {
        setError('Failed to initialize Zstd: ' + err.message);
        setState('error');
      });
  }, []);

  const connect = async () => {
    try {
      setState('connecting');
      setError(null);
      const client = new GameClient();
      await client.connect();
      clientRef.current = client;
      setState('connected');
    } catch (err: any) {
      setError(err.message);
      setState('error');
    }
  };

  const joinGame = async (playerName: string) => {
    try {
      if (!clientRef.current) throw new Error('Not connected');

      setState('joining');
      setError(null);

      // Call REST endpoint to join game
      await apiClient.post('/game/join_stream', { name: playerName });

      // Wait for incoming game stream
      const stream = await clientRef.current.waitForGameStream();
      streamRef.current = stream;

      // Start receiving messages
      setState('in-game');
      console.log('📥 Starting to receive messages from server...');
      for await (const msg of stream.receive()) {
        console.log('📨 Received message:', msg.type);
        if (msg.type === 'Snapshot') {
          setSnapshot(msg);
        } else if (msg.type === 'PlayerJoined') {
          console.log('Player joined:', msg.player_id, msg.name);
        } else if (msg.type === 'PlayerLeft') {
          console.log('Player left:', msg.player_id);
        } else if (msg.type === 'Error') {
          console.error('Game error:', msg.message);
          setError(msg.message);
        }
      }
      console.log('📥 Receive loop ended');

      // Stream closed
      setState('connected');
    } catch (err: any) {
      setError(err.message);
      setState('error');
    }
  };

  const sendInput = async (movement: Vector3D, lookDirection: Vector3D) => {
    if (!streamRef.current) {
      console.warn('Cannot send input - no stream');
      return;
    }
    const msg = {
      type: 'Input' as const,
      movement,
      look_direction: lookDirection,
      attacking: false,
      jumping: false,
    };
    console.log('Sending to server:', msg);
    try {
      await streamRef.current.send(msg);
      console.log('✅ Message sent successfully');
    } catch (err) {
      console.error('❌ Failed to send message:', err);
      setError('Failed to send input: ' + (err as Error).message);
    }
  };

  const leaveGame = async () => {
    if (streamRef.current) {
      await streamRef.current.close();
      streamRef.current = null;
      setState('connected');
    }
  };

  const disconnect = async () => {
    if (streamRef.current) {
      await streamRef.current.close();
      streamRef.current = null;
    }
    if (clientRef.current) {
      await clientRef.current.close();
      clientRef.current = null;
    }
    setState('idle');
  };

  return {
    state,
    error,
    snapshot,
    connect,
    joinGame,
    sendInput,
    leaveGame,
    disconnect,
  };
}
