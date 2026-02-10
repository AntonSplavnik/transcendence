// Simple WebSocket server that mocks the game server for client testing
// Run: node mock_server.js

import { WebSocketServer } from 'ws';

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

// Mock game state
const players = new Map();
let frameNumber = 0;

// Simulate player movement
function updatePlayers(deltaTime) {
    for (const [id, player] of players.entries()) {
        // Apply movement
        player.position.x += player.velocity.x * deltaTime;
        player.position.y += player.velocity.y * deltaTime;
        player.position.z += player.velocity.z * deltaTime;

        // Apply gravity (ground at y=1.0 to match client)
        if (player.position.y > 1.0) {
            player.velocity.y -= 20.0 * deltaTime;
        } else {
            player.position.y = 1.0;
            player.velocity.y = 0;
        }

        // Clamp to arena bounds ([-49, 49] to match client)
        player.position.x = Math.max(-49, Math.min(49, player.position.x));
        player.position.z = Math.max(-49, Math.min(49, player.position.z));
    }
}

// Create snapshot
function createSnapshot() {
    const characters = [];
    for (const [id, player] of players.entries()) {
        characters.push({
            player_id: id,
            position: { ...player.position },
            velocity: { ...player.velocity },
            yaw: player.yaw,
            state: player.state,
            health: player.health,
            maxHealth: 100.0
        });
    }

    return {
        frame_number: frameNumber++,  // Use snake_case to match C++ server format
        timestamp: Date.now() / 1000,
        characters
    };
}

// WebSocket server
wss.on('connection', (ws, req) => {
    const playerId = Math.floor(Math.random() * 10000);

    console.log(`Player ${playerId} connected`);

    // Create new player (spawn near origin to match client coordinate system)
    const player = {
        position: { x: (Math.random() - 0.5) * 20, y: 1.0, z: (Math.random() - 0.5) * 20 },
        velocity: { x: 0.0, y: 0.0, z: 0.0 },
        yaw: 0.0,
        state: 0, // Idle
        health: 100.0
    };
    players.set(playerId, player);

    // Send player their ID
    ws.send(JSON.stringify({
        type: 'welcome',
        playerId: playerId
    }));

    // Handle messages from client
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'input') {
                const input = msg.input;
                const player = players.get(playerId);

                if (player) {
                    // Update velocity based on input
                    const speed = 5.0;
                    player.velocity.x = input.movementDirection.x * speed;
                    player.velocity.z = input.movementDirection.z * speed;

                    // Jump (ground at y=1.0 to match client)
                    if (input.isJumping && player.position.y <= 1.1) {
                        player.velocity.y = 8.0;
                    }

                    // Update state
                    if (input.isAttacking) {
                        player.state = 2; // Attacking
                    } else if (player.velocity.x !== 0 || player.velocity.z !== 0) {
                        player.state = 1; // Moving
                    } else {
                        player.state = 0; // Idle
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected`);
        players.delete(playerId);
    });
});

// Game loop - update physics and broadcast snapshots
let lastTime = Date.now();
setInterval(() => {
    const now = Date.now();
    const deltaTime = (now - lastTime) / 1000.0;
    lastTime = now;

    // Update game state
    updatePlayers(deltaTime);

    // Create and broadcast snapshot
    const snapshot = createSnapshot();
    const message = JSON.stringify(snapshot);

    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
        }
    });
}, 50); // 20 Hz (every 50ms)

console.log(`Mock game server running on ws://localhost:${PORT}`);
console.log('Connect your Babylon.js client to test!');
