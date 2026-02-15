// Example usage of the ArenaGame engine (EnTT version)
// This demonstrates how to integrate the game loop with a server

#include "../include/ArenaGame.hpp"
#include <iostream>
#include <thread>
#include <chrono>

// Use the namespace to avoid repetition
using namespace ArenaGame;
using Game = ::ArenaGame::ArenaGame;

// =============================================================================
// Example: Running the game loop on the server
// =============================================================================

void runGameServer() {
    // Create the game instance
    Game game;

    // Start the game
    game.start();
    std::cout << "Game server started!" << std::endl;

    // Add some test players
    game.addPlayer(1, "Player1");
    game.addPlayer(2, "Player2");
    std::cout << "Added " << game.getPlayerCount() << " players" << std::endl;

    // Simulate some input for player 1 (move forward)
    InputState input1;
    input1.movementDirection = Vector3D(0.0f, 0.0f, 1.0f);  // Move forward (Z+)
    game.setPlayerInput(1, input1);

    // Simulate some input for player 2 (move backward)
    InputState input2;
    input2.movementDirection = Vector3D(0.0f, 0.0f, -1.0f);  // Move backward (Z-)
    game.setPlayerInput(2, input2);

    // Main game loop (run for 5 seconds as example)
    auto startTime = std::chrono::steady_clock::now();
    auto lastSnapshotTime = startTime;

    while (game.isRunning()) {
        // Update game physics
        game.update();

        // Send snapshot to clients every ~50ms (20Hz)
        auto now = std::chrono::steady_clock::now();
        auto snapshotElapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            now - lastSnapshotTime
        ).count();

        if (snapshotElapsed >= 50) {
            GameStateSnapshot snapshot = game.createSnapshot();

            // Example: Print snapshot data (in production, this would be sent over network)
            std::cout << "\n=== Frame " << snapshot.frameNumber << " at " << snapshot.timestamp << "s ===" << std::endl;
            for (const auto& charSnapshot : snapshot.characters) {
                std::cout << "Player " << charSnapshot.playerID
                         << " at (" << charSnapshot.position.x << ", "
                         << charSnapshot.position.y << ", "
                         << charSnapshot.position.z << ")"
                         << " HP: " << charSnapshot.health << "/" << charSnapshot.maxHealth
                         << std::endl;
            }

            lastSnapshotTime = now;
        }

        // Sleep briefly to avoid burning CPU (in production, you might use a more sophisticated approach)
        std::this_thread::sleep_for(std::chrono::milliseconds(1));

        // Stop after 5 seconds for this example
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - startTime).count();
        if (elapsed >= 5) {
            game.stop();
        }
    }

    std::cout << "\nGame server stopped after " << game.getFrameNumber() << " frames" << std::endl;
}

// =============================================================================
// Example: Handling player input from network
// =============================================================================

void handlePlayerInputFromNetwork(Game& game, PlayerID playerID, const std::vector<uint8_t>& inputData) {
    // In production, you would deserialize the input from the network data
    // For this example, we'll just create a mock input

    InputState input;

    // Example: Parse input data
    // Byte 0-11: movement direction (3 floats)
    // Byte 12: action flags (attacking, jumping, etc.)

    if (inputData.size() >= 13) {
        // Parse movement direction
        float* movementPtr = (float*)&inputData[0];
        input.movementDirection.x = movementPtr[0];
        input.movementDirection.y = movementPtr[1];
        input.movementDirection.z = movementPtr[2];

        // Parse action flags
        uint8_t actionFlags = inputData[12];
        input.isAttacking = (actionFlags & 0x01) != 0;
        input.isJumping = (actionFlags & 0x02) != 0;
        input.isUsingAbility1 = (actionFlags & 0x04) != 0;
        input.isUsingAbility2 = (actionFlags & 0x08) != 0;
        input.isDodging = (actionFlags & 0x10) != 0;
    }

    // Apply input to the character
    game.setPlayerInput(playerID, input);
}

// =============================================================================
// Example: Converting keyboard input to game input (client-side example)
// =============================================================================

InputState keyboardToInput(bool keyW, bool keyA, bool keyS, bool keyD, bool keySpace, bool mouseLeft) {
    InputState input;

    // Convert WASD to movement direction
    Vector3D direction(0.0f, 0.0f, 0.0f);

    if (keyW) direction.z += 1.0f;  // Forward
    if (keyS) direction.z -= 1.0f;  // Backward
    if (keyA) direction.x -= 1.0f;  // Left
    if (keyD) direction.x += 1.0f;  // Right

    // Normalize the direction if moving diagonally
    if (direction.lengthSquared() > 0.0f) {
        input.movementDirection = direction.normalized();
    }

    input.isJumping = keySpace;
    input.isAttacking = mouseLeft;

    return input;
}

// =============================================================================
// Example: Integration with Rust backend
// =============================================================================

// In production, you would expose a C API that the Rust backend can call
extern "C" {
    // Create a new game instance
    Game* game_create() {
        return new Game();
    }

    // Destroy game instance
    void game_destroy(Game* game) {
        delete game;
    }

    // Start the game
    void game_start(Game* game) {
        game->start();
    }

    // Update the game (call this in your server loop)
    void game_update(Game* game) {
        game->update();
    }

    // Add a player
    bool game_add_player(Game* game, uint32_t playerID, const char* name) {
        return game->addPlayer(playerID, std::string(name));
    }

    // Set player input
    void game_set_player_input(
        Game* game,
        uint32_t playerID,
        float movX, float movY, float movZ,
        bool isAttacking,
        bool isJumping
    ) {
        InputState input;
        input.movementDirection = Vector3D(movX, movY, movZ);
        input.isAttacking = isAttacking;
        input.isJumping = isJumping;
        game->setPlayerInput(playerID, input);
    }

    // Get snapshot data (for sending to clients)
    // Returns the number of characters in the snapshot
    size_t game_get_snapshot(
        Game* game,
        uint64_t* outFrameNumber,
        double* outTimestamp,
        CharacterSnapshot* outCharacters,
        size_t maxCharacters
    ) {
        GameStateSnapshot snapshot = game->createSnapshot();
        *outFrameNumber = snapshot.frameNumber;
        *outTimestamp = snapshot.timestamp;

        size_t count = std::min(snapshot.characters.size(), maxCharacters);
        for (size_t i = 0; i < count; ++i) {
            outCharacters[i] = snapshot.characters[i];
        }

        return snapshot.characters.size();
    }
}

// =============================================================================
// Main function (for standalone testing)
// =============================================================================

int main() {
    std::cout << "=== ArenaGame Engine Example ===" << std::endl;
    std::cout << "Arena dimensions: " << GameConfig::ARENA_WIDTH << "x" << GameConfig::ARENA_LENGTH << std::endl;
    std::cout << "Target FPS: " << GameConfig::TARGET_FPS << std::endl;
    std::cout << "Fixed timestep: " << GameConfig::FIXED_TIMESTEP << "s" << std::endl;
    std::cout << std::endl;

    runGameServer();

    return 0;
}
