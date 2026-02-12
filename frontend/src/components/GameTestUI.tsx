import { useState, useEffect } from 'react';
import { useGameConnection } from '../hooks/useGameConnection';
import Button from './ui/Button';
import Card from './ui/Card';

export default function GameTestUI() {
  const { state, error, snapshot, connect, joinGame, sendInput, leaveGame, disconnect } = useGameConnection();
  const [playerName, setPlayerName] = useState('TestPlayer');

  // Simple keyboard input (arrow keys)
  useEffect(() => {
    if (state !== 'in-game') return;

    // Track which keys are currently pressed
    const keysPressed = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        keysPressed.add(e.key);
        updateMovement();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        keysPressed.delete(e.key);
        updateMovement();
      }
    };

    const updateMovement = () => {
      const movement = { x: 0, y: 0, z: 0 };
      const lookDirection = { x: 0, y: 1, z: 0 };

      if (keysPressed.has('ArrowUp')) movement.z = 1;
      if (keysPressed.has('ArrowDown')) movement.z = -1;
      if (keysPressed.has('ArrowLeft')) movement.x = -1;
      if (keysPressed.has('ArrowRight')) movement.x = 1;

      console.log('Sending input:', movement);
      sendInput(movement, lookDirection);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [state, sendInput]);

  return (
    <div className="p-4 space-y-4">
      <Card>
        <h2 className="text-xl font-bold mb-4">WebTransport Game Test</h2>

        {/* Connection Status */}
        <div className="mb-4">
          <span className="font-semibold">Status: </span>
          <span className={`px-2 py-1 rounded ${
            state === 'in-game' ? 'bg-green-200' :
            state === 'error' ? 'bg-red-200' :
            'bg-gray-200'
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

        {state === 'in-game' && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              Use arrow keys to move
            </p>
            <Button variant="danger" onClick={leaveGame}>Leave Game</Button>
          </div>
        )}

        {state === 'connected' && (
          <Button variant="secondary" onClick={disconnect} className="mt-2">
            Disconnect
          </Button>
        )}
      </Card>

      {/* Game State Display */}
      {snapshot && (
        <Card>
          <h3 className="font-bold mb-2">Game State</h3>
          <div className="space-y-1 text-sm">
            <div>Frame: {snapshot.frame_number}</div>
            <div>Timestamp: {snapshot.timestamp.toFixed(2)}s</div>
            <div>Players: {snapshot.characters.length}</div>
          </div>

          {snapshot.characters.length > 0 && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2">Characters:</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-1">ID</th>
                      <th className="text-left p-1">Position</th>
                      <th className="text-left p-1">Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.characters.map(char => (
                      <tr key={char.player_id} className="border-b">
                        <td className="p-1">{char.player_id}</td>
                        <td className="p-1">
                          ({char.position.x.toFixed(1)},
                           {char.position.y.toFixed(1)},
                           {char.position.z.toFixed(1)})
                        </td>
                        <td className="p-1">
                          {char.health.toFixed(0)}/{char.max_health.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
