import { useState } from 'react';
import { useGameConnection } from '../hooks/useGameConnection';
import { useAuth } from '../contexts/AuthContext';
import Button from './ui/Button';
import Card from './ui/Card';
import SimpleGameClient from './GameBoard/SimpleGameClient';

export default function GameTestUI() {
  const { state, error, snapshot, connect, joinGame, sendInput, disconnect, onGameEvents } = useGameConnection();
  const { user } = useAuth();
  const [playerName, setPlayerName] = useState('TestPlayer');


  // Render 3D game client when in-game
  if (state === 'in-game') {
    return (
      <SimpleGameClient
        snapshot={snapshot}
        onSendInput={sendInput}
        localPlayerId={user?.id}
        onGameEvents={onGameEvents}
      />
    );
  }

  // Otherwise show connection UI
  return (
    <div className="p-4 space-y-4">
      <Card>
        <h2 className="text-xl font-bold mb-4">WebTransport Game Test</h2>

        {/* Connection Status */}
        <div className="mb-4">
          <span className="font-semibold">Status: </span>
          <span className={`px-2 py-1 rounded ${
            state === 'error' ? 'bg-red-200' : 'bg-gray-200'
          }`}>
            {state}
          </span>
        </div>

        {error && (
          <div className="bg-red-100 p-2 rounded mb-4 text-red-700">
            Error: {error}
          </div>
        )}

        {/* Controls */}
        {state === 'idle' && (
          <Button onClick={connect}>Connect</Button>
        )}

        {state === 'initializing' && (
          <div className="text-gray-600">Initializing Zstd...</div>
        )}

        {state === 'connecting' && (
          <div className="text-gray-600">Connecting to server...</div>
        )}

        {state === 'connected' && (
          <div className="space-y-2">
            <input
              type="text"
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Player name"
              className="border p-2 rounded w-full"
            />
            <Button onClick={() => joinGame(playerName)}>Join Game</Button>
          </div>
        )}

        {state === 'joining' && (
          <div className="text-gray-600">Joining game...</div>
        )}

        {state === 'connected' && (
          <Button variant="secondary" onClick={disconnect} className="mt-2">
            Disconnect
          </Button>
        )}
      </Card>
    </div>
  );
}
