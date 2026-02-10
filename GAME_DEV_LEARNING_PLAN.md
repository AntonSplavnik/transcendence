# 🎮 Complete Game Development Learning Plan
## From Concepts to Production-Ready Multiplayer Game

**Duration:** 6 weeks
**Your Background:** C++ experience, HTTP/networking knowledge
**Learning Goals:** Game loop, physics, networking, client prediction, Rust, JavaScript
**End Result:** Deep understanding of multiplayer game architecture

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Week 1: Master Game Loop & Physics (C++)](#week-1)
3. [Week 2: Networking & Client Prediction](#week-2)
4. [Week 3: JavaScript & Browser Client](#week-3)
5. [Week 4: Study Production Code](#week-4)
6. [Week 5-6: Learn Rust by Porting](#week-5-6)
7. [Resources & Tools](#resources)
8. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

### Learning Philosophy

**Build → Break → Study → Rebuild**

1. **Build simple versions** from scratch (understand concepts)
2. **Break them** intentionally (understand edge cases)
3. **Study production code** (understand best practices)
4. **Rebuild better** (apply learning)

### Your Advantages

✅ **C++ knowledge** - Start with game loop in familiar territory
✅ **Networking experience** - Understand client-server architecture
✅ **HTTP knowledge** - Grasp state synchronization quickly

### What You'll Learn

| Week | Concept | Language | Milestone |
|------|---------|----------|-----------|
| 1 | Game loop, Physics | C++ | Local multiplayer game |
| 2 | Networking, Prediction | C++ | Online multiplayer |
| 3 | Client rendering | JavaScript | Browser game |
| 4 | Production patterns | All | Understand my code |
| 5-6 | Rust ecosystem | Rust | Professional server |

---

## 📅 Week 1: Master Game Loop & Physics (C++)
### **Goal: Build a working local arena game from scratch**

### Day 1: Fixed Timestep Game Loop

**Morning: Theory (2 hours)**

Read and understand:
```
Why fixed timestep?
- Variable timestep: Physics differs based on FPS (BAD)
- Fixed timestep: Physics same on all machines (GOOD)

Real example:
- 30 FPS machine: jump reaches 100 units
- 60 FPS machine: jump reaches 95 units (more physics steps = more drag)
- Solution: Both run physics at exactly 60 FPS
```

**Afternoon: Code (4 hours)**

Create `game_dev_learning/day1/` directory:

```cpp
// game_loop_basic.cpp
#include <iostream>
#include <chrono>
#include <thread>

const float TARGET_FPS = 60.0f;
const float FIXED_TIMESTEP = 1.0f / TARGET_FPS;  // 0.0166... seconds

struct Player {
    float x, y;
    float vx, vy;

    void update(float dt) {
        x += vx * dt;
        y += vy * dt;
    }

    void print() const {
        std::cout << "Player at (" << x << ", " << y << ")\n";
    }
};

int main() {
    Player player = {0.0f, 0.0f, 50.0f, 100.0f}; // x, y, vx, vy

    auto lastTime = std::chrono::high_resolution_clock::now();
    float accumulator = 0.0f;
    int frame = 0;

    std::cout << "Starting game loop (5 seconds)\n";
    std::cout << "Target FPS: " << TARGET_FPS << "\n\n";

    // Game loop
    while (frame < 300) { // 5 seconds at 60 FPS
        // 1. Calculate delta time
        auto currentTime = std::chrono::high_resolution_clock::now();
        float deltaTime = std::chrono::duration<float>(currentTime - lastTime).count();
        lastTime = currentTime;

        // 2. Accumulate time
        accumulator += deltaTime;

        // 3. Fixed timestep updates
        while (accumulator >= FIXED_TIMESTEP) {
            player.update(FIXED_TIMESTEP);
            accumulator -= FIXED_TIMESTEP;
            frame++;

            // Print every second
            if (frame % 60 == 0) {
                std::cout << "Frame " << frame << ": ";
                player.print();
            }
        }

        // 4. Sleep to avoid burning CPU
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    std::cout << "\nFinal position: ";
    player.print();

    return 0;
}
```

**Compile and run:**
```bash
cd game_dev_learning/day1
g++ -std=c++17 game_loop_basic.cpp -o game_loop
./game_loop
```

**Expected output:**
```
Starting game loop (5 seconds)
Target FPS: 60

Frame 60: Player at (50, 100)
Frame 120: Player at (100, 200)
Frame 180: Player at (150, 300)
Frame 240: Player at (200, 400)
Frame 300: Player at (250, 500)

Final position: Player at (250, 500)
```

**Evening: Experiments (2 hours)**

Modify the code to understand:

1. **Change FPS:**
```cpp
const float TARGET_FPS = 30.0f;
// Question: Does player reach different position? (Should be same!)
```

2. **Remove accumulator (WRONG way):**
```cpp
// Replace fixed timestep loop with:
player.update(deltaTime); // Variable timestep
// Question: Why does position change each run?
```

3. **Add FPS counter:**
```cpp
int framesThisSecond = 0;
float fpsTimer = 0.0f;

// In loop:
framesThisSecond++;
fpsTimer += deltaTime;
if (fpsTimer >= 1.0f) {
    std::cout << "FPS: " << framesThisSecond << "\n";
    framesThisSecond = 0;
    fpsTimer -= 1.0f;
}
```

**Homework:**
- Run on different machines (if possible)
- Verify player reaches same position
- Write notes: "Why accumulator matters"

---

### Day 2: Add Physics

**Morning: Theory (2 hours)**

Physics concepts:
```
1. Gravity: constant downward acceleration
   - acceleration: change in velocity per second
   - velocity: change in position per second

2. Collision: detecting and responding
   - AABB: simple box collision
   - Circle: distance-based collision
   - Response: separate objects, apply forces

3. Friction: gradual slowing
   - Multiply velocity by < 1.0 each frame
   - e.g., vx *= 0.9 means lose 10% speed per frame
```

**Afternoon: Code (4 hours)**

```cpp
// game_physics.cpp
#include <iostream>
#include <chrono>
#include <thread>
#include <cmath>

const float TARGET_FPS = 60.0f;
const float FIXED_TIMESTEP = 1.0f / TARGET_FPS;

// Game configuration
namespace Config {
    const float GRAVITY = 500.0f;      // pixels per second squared
    const float MOVE_SPEED = 200.0f;   // pixels per second
    const float JUMP_VELOCITY = 300.0f; // pixels per second
    const float FRICTION = 0.85f;      // velocity multiplier
    const float GROUND_Y = 0.0f;
    const float ARENA_WIDTH = 800.0f;
}

struct Player {
    float x, y;
    float vx, vy;
    bool isGrounded;

    Player(float startX, float startY)
        : x(startX), y(startY), vx(0), vy(0), isGrounded(false) {}

    void applyGravity(float dt) {
        if (!isGrounded) {
            vy -= Config::GRAVITY * dt;
        }
    }

    void applyFriction(float dt) {
        vx *= Config::FRICTION;
        // Stop completely if very slow
        if (std::abs(vx) < 1.0f) vx = 0.0f;
    }

    void handleInput(bool moveLeft, bool moveRight, bool jump) {
        // Horizontal movement
        if (moveLeft) {
            vx = -Config::MOVE_SPEED;
        } else if (moveRight) {
            vx = Config::MOVE_SPEED;
        } else {
            applyFriction(FIXED_TIMESTEP);
        }

        // Jump
        if (jump && isGrounded) {
            vy = Config::JUMP_VELOCITY;
            isGrounded = false;
        }
    }

    void update(float dt) {
        // Apply physics
        applyGravity(dt);

        // Update position
        x += vx * dt;
        y += vy * dt;

        // Ground collision
        if (y <= Config::GROUND_Y) {
            y = Config::GROUND_Y;
            vy = 0.0f;
            isGrounded = true;
        }

        // Arena boundaries
        if (x < 0) {
            x = 0;
            vx = 0;
        }
        if (x > Config::ARENA_WIDTH) {
            x = Config::ARENA_WIDTH;
            vx = 0;
        }
    }

    void print() const {
        std::cout << "Player at (" << x << ", " << y << ") "
                  << "velocity (" << vx << ", " << vy << ") "
                  << (isGrounded ? "GROUNDED" : "AIRBORNE") << "\n";
    }
};

int main() {
    Player player(400.0f, 100.0f); // Start in middle, slightly elevated

    auto lastTime = std::chrono::high_resolution_clock::now();
    float accumulator = 0.0f;
    int frame = 0;

    std::cout << "Physics simulation (5 seconds)\n";
    std::cout << "Player starts at (400, 100) and falls\n\n";

    // Simulate falling and bouncing
    bool jump = false;

    while (frame < 300) {
        auto currentTime = std::chrono::high_resolution_clock::now();
        float deltaTime = std::chrono::duration<float>(currentTime - lastTime).count();
        lastTime = currentTime;

        accumulator += deltaTime;

        while (accumulator >= FIXED_TIMESTEP) {
            // Simulate input: jump every 2 seconds
            if (frame == 60 || frame == 180) {
                jump = true;
            } else {
                jump = false;
            }

            player.handleInput(false, false, jump);
            player.update(FIXED_TIMESTEP);

            accumulator -= FIXED_TIMESTEP;
            frame++;

            // Print every 30 frames (0.5 seconds)
            if (frame % 30 == 0) {
                std::cout << "Frame " << frame << ": ";
                player.print();
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    return 0;
}
```

**Compile and run:**
```bash
g++ -std=c++17 game_physics.cpp -o game_physics
./game_physics
```

**Evening: Experiments (2 hours)**

1. **Change gravity:**
```cpp
const float GRAVITY = 50.0f;  // Moon gravity
const float GRAVITY = 1000.0f; // Jupiter gravity
// Observe jump behavior
```

2. **Add horizontal movement:**
```cpp
// In main loop, simulate moving right for 2 seconds:
bool moveRight = (frame < 120);
player.handleInput(false, moveRight, false);
```

3. **Add friction to vertical movement:**
```cpp
void applyFriction(float dt) {
    vx *= Config::FRICTION;
    vy *= 0.99f; // Air resistance
}
```

**Homework:**
- Add bounds checking for top of arena
- Make player bounce off walls (reverse vx)
- Experiment with different friction values

---

### Day 3: Multiple Players & Collision

**Morning: Theory (2 hours)**

Collision detection:
```
Circle-circle collision (simple):
  distance = sqrt((x1-x2)² + (y1-y2)²)
  if distance < (radius1 + radius2):
      collision!

Collision response:
  1. Calculate overlap
  2. Push objects apart
  3. (Optional) Apply bounce forces
```

**Afternoon: Code (6 hours)**

```cpp
// multi_player.cpp
#include <iostream>
#include <vector>
#include <chrono>
#include <thread>
#include <cmath>

const float TARGET_FPS = 60.0f;
const float FIXED_TIMESTEP = 1.0f / TARGET_FPS;

namespace Config {
    const float GRAVITY = 500.0f;
    const float MOVE_SPEED = 200.0f;
    const float JUMP_VELOCITY = 300.0f;
    const float FRICTION = 0.85f;
    const float GROUND_Y = 0.0f;
    const float ARENA_WIDTH = 800.0f;
    const float PLAYER_RADIUS = 25.0f;
}

struct Player {
    int id;
    std::string name;
    float x, y;
    float vx, vy;
    bool isGrounded;
    float radius;

    Player(int id, const std::string& name, float x, float y)
        : id(id), name(name), x(x), y(y), vx(0), vy(0),
          isGrounded(false), radius(Config::PLAYER_RADIUS) {}

    void applyGravity(float dt) {
        if (!isGrounded) {
            vy -= Config::GRAVITY * dt;
        }
    }

    void handleInput(bool moveLeft, bool moveRight, bool jump) {
        if (moveLeft) {
            vx = -Config::MOVE_SPEED;
        } else if (moveRight) {
            vx = Config::MOVE_SPEED;
        } else {
            vx *= Config::FRICTION;
            if (std::abs(vx) < 1.0f) vx = 0.0f;
        }

        if (jump && isGrounded) {
            vy = Config::JUMP_VELOCITY;
            isGrounded = false;
        }
    }

    void update(float dt) {
        applyGravity(dt);

        x += vx * dt;
        y += vy * dt;

        // Ground collision
        if (y - radius <= Config::GROUND_Y) {
            y = Config::GROUND_Y + radius;
            vy = 0.0f;
            isGrounded = true;
        }

        // Wall collision
        if (x - radius < 0) {
            x = radius;
            vx = 0;
        }
        if (x + radius > Config::ARENA_WIDTH) {
            x = Config::ARENA_WIDTH - radius;
            vx = 0;
        }
    }

    void print() const {
        std::cout << name << " (" << id << ") at ("
                  << (int)x << ", " << (int)y << ")\n";
    }
};

class Arena {
private:
    std::vector<Player> players;

public:
    void addPlayer(int id, const std::string& name, float x, float y) {
        players.emplace_back(id, name, x, y);
    }

    void setPlayerInput(int id, bool left, bool right, bool jump) {
        for (auto& player : players) {
            if (player.id == id) {
                player.handleInput(left, right, jump);
                break;
            }
        }
    }

    void update(float dt) {
        // Update all players
        for (auto& player : players) {
            player.update(dt);
        }

        // Check collisions
        resolveCollisions();
    }

    void resolveCollisions() {
        for (size_t i = 0; i < players.size(); i++) {
            for (size_t j = i + 1; j < players.size(); j++) {
                resolvePlayerCollision(players[i], players[j]);
            }
        }
    }

    void resolvePlayerCollision(Player& a, Player& b) {
        float dx = b.x - a.x;
        float dy = b.y - a.y;
        float distance = std::sqrt(dx * dx + dy * dy);
        float minDist = a.radius + b.radius;

        if (distance < minDist && distance > 0.01f) {
            // Calculate overlap
            float overlap = minDist - distance;

            // Normalize direction
            float nx = dx / distance;
            float ny = dy / distance;

            // Push apart (50/50)
            float push = overlap * 0.5f;
            a.x -= nx * push;
            a.y -= ny * push;
            b.x += nx * push;
            b.y += ny * push;
        }
    }

    void print() const {
        for (const auto& player : players) {
            player.print();
        }
    }
};

int main() {
    Arena arena;

    // Add 3 players at different positions
    arena.addPlayer(1, "Alice", 200, 100);
    arena.addPlayer(2, "Bob", 400, 50);
    arena.addPlayer(3, "Charlie", 600, 75);

    auto lastTime = std::chrono::high_resolution_clock::now();
    float accumulator = 0.0f;
    int frame = 0;

    std::cout << "Arena with 3 players (5 seconds)\n\n";

    while (frame < 300) {
        auto currentTime = std::chrono::high_resolution_clock::now();
        float deltaTime = std::chrono::duration<float>(currentTime - lastTime).count();
        lastTime = currentTime;

        accumulator += deltaTime;

        while (accumulator >= FIXED_TIMESTEP) {
            // Simulate AI movement
            // Alice moves right
            arena.setPlayerInput(1, false, true, frame == 60);
            // Bob stays still but jumps
            arena.setPlayerInput(2, false, false, frame == 90);
            // Charlie moves left
            arena.setPlayerInput(3, true, false, frame == 120);

            arena.update(FIXED_TIMESTEP);

            accumulator -= FIXED_TIMESTEP;
            frame++;

            if (frame % 60 == 0) {
                std::cout << "\n--- Frame " << frame << " ---\n";
                arena.print();
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    return 0;
}
```

**Compile and run:**
```bash
g++ -std=c++17 multi_player.cpp -o multi_player
./multi_player
```

**Watch:** Players collide and push each other!

**Evening: Experiments (2 hours)**

1. Add 4th and 5th players
2. Make them all move toward center (collision chaos!)
3. Add bounce on collision (reverse velocities)
4. Add health system (collision = damage)

---

### Day 4-5: Build Mini Arena Game

**Goal:** Complete game with combat

```cpp
// mini_arena_game.cpp
// Full game with health, attacks, multiple players

struct Player {
    // ... previous code ...

    float health;
    float maxHealth;
    float attackCooldown;
    float attackRange;
    float attackDamage;

    bool canAttack() const {
        return attackCooldown <= 0.0f;
    }

    void attack() {
        if (canAttack()) {
            attackCooldown = 1.0f; // 1 second cooldown
        }
    }

    void takeDamage(float damage) {
        health -= damage;
        if (health < 0) health = 0;
    }

    bool isAlive() const {
        return health > 0;
    }

    void updateCooldowns(float dt) {
        if (attackCooldown > 0) {
            attackCooldown -= dt;
        }
    }
};

class Arena {
    // ... previous code ...

    void processCombat() {
        for (size_t i = 0; i < players.size(); i++) {
            if (!players[i].isAlive()) continue;

            // Check if player is attacking
            if (players[i].attackCooldown > 0.99f) { // Just attacked
                // Check all other players in range
                for (size_t j = 0; j < players.size(); j++) {
                    if (i == j || !players[j].isAlive()) continue;

                    float dist = distance(players[i], players[j]);
                    if (dist <= players[i].attackRange) {
                        players[j].takeDamage(players[i].attackDamage);
                        std::cout << players[i].name << " hit "
                                  << players[j].name << " for "
                                  << players[i].attackDamage << " damage!\n";
                    }
                }
            }
        }
    }

    float distance(const Player& a, const Player& b) {
        float dx = a.x - b.x;
        float dy = a.y - b.y;
        return std::sqrt(dx * dx + dy * dy);
    }

    void update(float dt) {
        // Update players
        for (auto& player : players) {
            if (player.isAlive()) {
                player.update(dt);
                player.updateCooldowns(dt);
            }
        }

        // Resolve collisions
        resolveCollisions();

        // Process combat
        processCombat();
    }

    void printStatus() {
        for (const auto& player : players) {
            if (player.isAlive()) {
                std::cout << player.name << ": "
                          << player.health << "/" << player.maxHealth
                          << " HP at (" << (int)player.x << ", " << (int)player.y << ")\n";
            } else {
                std::cout << player.name << ": DEAD\n";
            }
        }
    }
};
```

**Add AI behavior:**
```cpp
void simulateAI(Arena& arena, int frame) {
    // Simple AI: move toward nearest enemy and attack
    // You implement this!
}
```

**Weekend Challenge:**
Build a complete 1v1 fighting game with:
- 2 players with health bars
- Movement and jumping
- Attack with cooldown
- Winner declared when opponent reaches 0 HP

---

### Day 6-7: Review and Document

**Saturday:**
- Clean up your code
- Add comments explaining each concept
- Write a document: "What I learned about game loops"

**Sunday:**
- Compare your code with mine (`ArenaGame.hpp`)
- Note differences
- Understand why mine is more complex

**Key comparisons:**
```
Your version:
  while (running) {
      update(dt);
  }

My version:
  while (accumulator >= FIXED_TIMESTEP) {
      physicsUpdate(FIXED_TIMESTEP);
      accumulator -= FIXED_TIMESTEP;
  }

Why? Prevents spiral of death when game slows down
```

---

## 📅 Week 2: Networking & Client Prediction
### **Goal: Build networked multiplayer with prediction**

### Day 8: Basic TCP Server

**Morning: Theory (2 hours)**

Network game architecture:
```
Client 1 ──┐
           ├──→ Server (authoritative)
Client 2 ──┘       ↓
                Physics
                   ↓
             ┌─────┴─────┐
             ↓           ↓
         Client 1    Client 2
```

**Afternoon: Code (6 hours)**

```cpp
// game_server.cpp
#include <iostream>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <vector>
#include <cstring>

// Your Arena class from Week 1
// #include "arena.h"

struct GameState {
    float player1_x, player1_y;
    float player2_x, player2_y;
    float player1_health, player2_health;
    int frame;
};

struct PlayerInput {
    bool moveLeft;
    bool moveRight;
    bool jump;
    bool attack;
};

int main() {
    // Create socket
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        std::cerr << "Socket creation failed\n";
        return 1;
    }

    // Allow reuse of address
    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    // Bind to port
    sockaddr_in address;
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(8080);

    if (bind(server_fd, (sockaddr*)&address, sizeof(address)) < 0) {
        std::cerr << "Bind failed\n";
        return 1;
    }

    // Listen for connections
    listen(server_fd, 2);
    std::cout << "Server listening on port 8080\n";
    std::cout << "Waiting for 2 players...\n";

    // Accept 2 clients
    int client1 = accept(server_fd, nullptr, nullptr);
    std::cout << "Player 1 connected\n";

    int client2 = accept(server_fd, nullptr, nullptr);
    std::cout << "Player 2 connected\n";
    std::cout << "Game starting!\n\n";

    // Create game
    Arena arena;
    arena.addPlayer(1, "Player1", 200, 100);
    arena.addPlayer(2, "Player2", 600, 100);

    // Game loop
    auto lastTime = std::chrono::high_resolution_clock::now();
    float accumulator = 0.0f;
    int frame = 0;

    while (frame < 600) { // 10 seconds
        auto currentTime = std::chrono::high_resolution_clock::now();
        float deltaTime = std::chrono::duration<float>(currentTime - lastTime).count();
        lastTime = currentTime;

        accumulator += deltaTime;

        while (accumulator >= FIXED_TIMESTEP) {
            // Receive input from clients (non-blocking)
            PlayerInput input1 = {0}, input2 = {0};
            recv(client1, &input1, sizeof(input1), MSG_DONTWAIT);
            recv(client2, &input2, sizeof(input2), MSG_DONTWAIT);

            // Apply inputs
            arena.setPlayerInput(1, input1.moveLeft, input1.moveRight, input1.jump);
            arena.setPlayerInput(2, input2.moveLeft, input2.moveRight, input2.jump);

            // Update game
            arena.update(FIXED_TIMESTEP);

            accumulator -= FIXED_TIMESTEP;
            frame++;
        }

        // Send state to clients (20 Hz = every 3 frames)
        if (frame % 3 == 0) {
            GameState state;
            // Fill state from arena
            // ... (you implement this)

            send(client1, &state, sizeof(state), 0);
            send(client2, &state, sizeof(state), 0);
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    close(client1);
    close(client2);
    close(server_fd);

    return 0;
}
```

```cpp
// game_client.cpp
#include <iostream>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <termios.h>
#include <fcntl.h>

// Non-blocking keyboard input
bool keyPressed(char key) {
    // Simple keyboard input (implement or use ncurses)
    return false;
}

int main() {
    // Connect to server
    int sock = socket(AF_INET, SOCK_STREAM, 0);

    sockaddr_in server;
    server.sin_family = AF_INET;
    server.sin_port = htons(8080);
    inet_pton(AF_INET, "127.0.0.1", &server.sin_addr);

    if (connect(sock, (sockaddr*)&server, sizeof(server)) < 0) {
        std::cerr << "Connection failed\n";
        return 1;
    }

    std::cout << "Connected to server!\n";
    std::cout << "Controls: A/D = move, W = jump, Space = attack\n\n";

    // Game loop
    while (true) {
        // Read keyboard
        PlayerInput input = {0};
        input.moveLeft = keyPressed('a');
        input.moveRight = keyPressed('d');
        input.jump = keyPressed('w');
        input.attack = keyPressed(' ');

        // Send input to server
        send(sock, &input, sizeof(input), 0);

        // Receive game state
        GameState state;
        int bytes = recv(sock, &state, sizeof(state), 0);
        if (bytes <= 0) break;

        // Display (simple console)
        std::cout << "\rFrame " << state.frame
                  << " | P1: " << (int)state.player1_x << "," << (int)state.player1_y
                  << " | P2: " << (int)state.player2_x << "," << (int)state.player2_y
                  << std::flush;

        std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }

    close(sock);
    return 0;
}
```

**Test:**
```bash
# Terminal 1
./game_server

# Terminal 2
./game_client

# Terminal 3
./game_client
```

**Notice:** Input feels laggy! This is normal - we'll fix it with prediction.

---

### Day 9-10: Client-Side Prediction

**Theory: Why prediction?**

```
Without prediction:
  Press key → Send to server (50ms) → Physics (16ms) → Receive (50ms) = 116ms delay!

With prediction:
  Press key → Update locally (0ms!) → Send to server → Reconcile when response arrives
```

**Code:**

```cpp
// predictive_client.cpp

struct PredictedPlayer {
    float x, y;  // Predicted position
    float vx, vy;

    float serverX, serverY;  // Last confirmed position

    std::vector<std::pair<int, PlayerInput>> inputHistory; // frame, input

    void applyInput(const PlayerInput& input, float dt, int frame) {
        // Apply immediately (prediction!)
        if (input.moveLeft) vx = -200;
        else if (input.moveRight) vx = 200;
        else vx = 0;

        x += vx * dt;
        y += vy * dt;

        // Store for reconciliation
        inputHistory.push_back({frame, input});

        // Keep only last 60 frames (1 second)
        if (inputHistory.size() > 60) {
            inputHistory.erase(inputHistory.begin());
        }
    }

    void reconcileWithServer(float newServerX, float newServerY, int serverFrame) {
        serverX = newServerX;
        serverY = newServerY;

        // Calculate prediction error
        float errorX = x - serverX;
        float errorY = y - serverY;
        float error = std::sqrt(errorX*errorX + errorY*errorY);

        std::cout << "Prediction error: " << error << " pixels\n";

        if (error < 5.0f) {
            // Small error: smooth correction
            x = x * 0.8f + serverX * 0.2f;  // Lerp
            y = y * 0.8f + serverY * 0.2f;
        } else if (error < 50.0f) {
            // Medium error: faster correction
            x = x * 0.5f + serverX * 0.5f;
            y = y * 0.5f + serverY * 0.5f;
        } else {
            // Large error: snap (teleport, respawn, etc.)
            x = serverX;
            y = serverY;
        }

        // IMPORTANT: Replay inputs that happened after server frame
        // This keeps prediction accurate
        for (const auto& [frame, input] : inputHistory) {
            if (frame > serverFrame) {
                // Re-apply this input
                applyInput(input, FIXED_TIMESTEP, frame);
            }
        }
    }
};

int main() {
    // Connect to server...

    PredictedPlayer myPlayer;
    myPlayer.x = 200;
    myPlayer.y = 100;

    int localFrame = 0;

    while (true) {
        // 1. Read input
        PlayerInput input = readKeyboard();

        // 2. Apply input IMMEDIATELY (prediction)
        myPlayer.applyInput(input, FIXED_TIMESTEP, localFrame);

        // 3. Send input to server
        send(sock, &input, sizeof(input), 0);

        // 4. Receive server update (if available)
        GameState state;
        int bytes = recv(sock, &state, sizeof(state), MSG_DONTWAIT);
        if (bytes > 0) {
            myPlayer.reconcileWithServer(state.player1_x, state.player1_y, state.frame);
        }

        // 5. Render
        std::cout << "My position: " << myPlayer.x << ", " << myPlayer.y
                  << " (server: " << myPlayer.serverX << ", " << myPlayer.serverY << ")\n";

        localFrame++;
        std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }
}
```

**Test with artificial lag:**
```cpp
// In server, before sending state:
std::this_thread::sleep_for(std::chrono::milliseconds(100)); // 100ms lag
send(client, &state, sizeof(state), 0);
```

**Notice:** With prediction, game feels smooth even with 100ms lag!

---

### Day 11-14: Complete Networked Game

**Build:**
- Server with full arena game
- 2+ clients with prediction
- Combat over network
- Winner announcement

**Advanced features:**
- Lag compensation for attacks
- Dead reckoning for remote players
- Input buffering

**Weekend:** Play your game! Find bugs, fix them.

---

## 📅 Week 3: JavaScript & Browser Client
### **Goal: Build 3D browser-based client**

### Day 15-16: Vanilla JavaScript Canvas

**Start simple - no frameworks yet:**

```html
<!-- game.html -->
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            margin: 0;
            overflow: hidden;
            background: #222;
        }
        canvas {
            display: block;
            background: #87CEEB;
        }
        #ui {
            position: absolute;
            top: 10px;
            left: 10px;
            color: white;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div id="ui">
        <div>FPS: <span id="fps">0</span></div>
        <div>Position: <span id="pos">0, 0</span></div>
        <div>Controls: Arrow keys to move, Space to jump</div>
    </div>
    <canvas id="game"></canvas>

    <script>
        // Setup canvas
        const canvas = document.getElementById('game');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        // Game constants (same as C++!)
        const GRAVITY = 500;
        const MOVE_SPEED = 200;
        const JUMP_VELOCITY = 300;
        const FIXED_TIMESTEP = 1/60;
        const GROUND_Y = canvas.height - 50;

        // Player state
        let player = {
            x: canvas.width / 2,
            y: GROUND_Y,
            vx: 0,
            vy: 0,
            width: 40,
            height: 60,
            isGrounded: false
        };

        // Input state
        let keys = {};
        window.addEventListener('keydown', e => keys[e.key] = true);
        window.addEventListener('keyup', e => keys[e.key] = false);

        // Game loop (same pattern as C++!)
        let lastTime = Date.now() / 1000;
        let accumulator = 0;
        let frame = 0;
        let fps = 0;
        let fpsCounter = 0;
        let fpsTimer = 0;

        function gameLoop() {
            const now = Date.now() / 1000;
            const deltaTime = now - lastTime;
            lastTime = now;

            accumulator += deltaTime;

            // Fixed timestep updates
            while (accumulator >= FIXED_TIMESTEP) {
                updatePhysics(FIXED_TIMESTEP);
                accumulator -= FIXED_TIMESTEP;
                frame++;
            }

            // Render
            render();

            // FPS counter
            fpsCounter++;
            fpsTimer += deltaTime;
            if (fpsTimer >= 1.0) {
                fps = fpsCounter;
                fpsCounter = 0;
                fpsTimer -= 1.0;
                document.getElementById('fps').textContent = fps;
            }

            requestAnimationFrame(gameLoop);
        }

        function updatePhysics(dt) {
            // Handle input
            if (keys['ArrowLeft']) {
                player.vx = -MOVE_SPEED;
            } else if (keys['ArrowRight']) {
                player.vx = MOVE_SPEED;
            } else {
                player.vx *= 0.85; // Friction
            }

            if (keys[' '] && player.isGrounded) {
                player.vy = -JUMP_VELOCITY;
                player.isGrounded = false;
            }

            // Apply gravity
            if (!player.isGrounded) {
                player.vy += GRAVITY * dt;
            }

            // Update position
            player.x += player.vx * dt;
            player.y += player.vy * dt;

            // Ground collision
            if (player.y + player.height >= GROUND_Y) {
                player.y = GROUND_Y - player.height;
                player.vy = 0;
                player.isGrounded = true;
            }

            // Boundaries
            if (player.x < 0) player.x = 0;
            if (player.x + player.width > canvas.width) {
                player.x = canvas.width - player.width;
            }

            // Update UI
            document.getElementById('pos').textContent =
                Math.round(player.x) + ', ' + Math.round(player.y);
        }

        function render() {
            // Clear
            ctx.fillStyle = '#87CEEB';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw ground
            ctx.fillStyle = '#8B4513';
            ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

            // Draw player
            ctx.fillStyle = 'red';
            ctx.fillRect(player.x, player.y, player.width, player.height);

            // Draw velocity indicator (debug)
            ctx.strokeStyle = 'yellow';
            ctx.beginPath();
            ctx.moveTo(player.x + player.width/2, player.y + player.height/2);
            ctx.lineTo(
                player.x + player.width/2 + player.vx * 0.1,
                player.y + player.height/2 + player.vy * 0.1
            );
            ctx.stroke();
        }

        // Handle window resize
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        });

        // Start game loop
        gameLoop();
    </script>
</body>
</html>
```

**Open in browser:**
```bash
open game.html  # or just double-click
```

**Day 17: Add Networking to JavaScript**

```javascript
// Add WebSocket connection
const ws = new WebSocket('ws://localhost:8080');

let serverPlayer = { x: 0, y: 0 };
let predictedPlayer = { x: 0, y: 0 };

// Send input to server (60 Hz)
setInterval(() => {
    const input = {
        moveLeft: keys['ArrowLeft'] || false,
        moveRight: keys['ArrowRight'] || false,
        jump: keys[' '] || false,
        attack: keys['x'] || false
    };
    ws.send(JSON.stringify({ type: 'input', input }));
}, 1000/60);

// Receive state from server
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'state') {
        serverPlayer = data.player;

        // Reconcile prediction with server
        reconcile(predictedPlayer, serverPlayer);
    }
};

function reconcile(predicted, server) {
    const dx = predicted.x - server.x;
    const dy = predicted.y - server.y;
    const error = Math.sqrt(dx*dx + dy*dy);

    if (error < 10) {
        // Smooth correction
        predicted.x = predicted.x * 0.8 + server.x * 0.2;
        predicted.y = predicted.y * 0.8 + server.y * 0.2;
    } else {
        // Snap
        predicted.x = server.x;
        predicted.y = server.y;
    }
}
```

### Day 18-21: Learn Babylon.js

**Read Babylon.js basics:**
- Official tutorial: https://doc.babylonjs.com/start
- Focus on: Scene, Camera, Meshes, Physics

**Port your canvas game to 3D:**

```javascript
// game3d.html
import { Engine, Scene, Vector3, HemisphericLight, MeshBuilder,
         UniversalCamera, HavokPlugin } from '@babylonjs/core';

const canvas = document.getElementById('renderCanvas');
const engine = new Engine(canvas);
const scene = new Scene(engine);

// Camera
const camera = new UniversalCamera('camera',
    new Vector3(0, 5, -10), scene);
camera.setTarget(Vector3.Zero());
camera.attachControl(canvas, true);

// Light
new HemisphericLight('light', new Vector3(0, 1, 0), scene);

// Ground
const ground = MeshBuilder.CreateGround('ground',
    { width: 100, height: 100 }, scene);

// Player (box for now)
const player = MeshBuilder.CreateBox('player',
    { width: 1, height: 2, depth: 1 }, scene);
player.position.y = 1;

// Game loop (familiar!)
scene.onBeforeRenderObservable.add(() => {
    // Your physics code here!
});

engine.runRenderLoop(() => {
    scene.render();
});
```

**By end of week:** You should have a 3D browser game with movement, jumping, basic rendering.

---

## 📅 Week 4: Study Production Code
### **Goal: Understand why my code is designed the way it is**

### Day 22-23: Read & Compare Game Loop

**Your code:**
```cpp
while (running) {
    update(deltaTime);
}
```

**My code (ArenaGame.hpp:116-135):**
```cpp
void update() {
    auto currentTime = std::chrono::steady_clock::now();
    std::chrono::duration<float> elapsed = currentTime - m_lastUpdateTime;
    float deltaTime = elapsed.count();
    m_lastUpdateTime = currentTime;

    // Cap delta time to prevent spiral of death
    if (deltaTime > GameConfig::FIXED_TIMESTEP * GameConfig::MAX_PHYSICS_ITERATIONS) {
        deltaTime = GameConfig::FIXED_TIMESTEP * GameConfig::MAX_PHYSICS_ITERATIONS;
    }

    m_accumulator += deltaTime;

    int iterations = 0;
    while (m_accumulator >= GameConfig::FIXED_TIMESTEP &&
           iterations < GameConfig::MAX_PHYSICS_ITERATIONS) {
        physicsUpdate(GameConfig::FIXED_TIMESTEP);
        m_accumulator -= GameConfig::FIXED_TIMESTEP;
        m_gameTime += GameConfig::FIXED_TIMESTEP;
        m_frameNumber++;
        iterations++;
    }
}
```

**Questions to answer:**
1. Why cap deltaTime?
2. Why MAX_PHYSICS_ITERATIONS?
3. What is "spiral of death"?
4. When would this happen?

**Experiment:** Remove the cap, make game run slow (add `sleep(100)`), see what happens!

### Day 24-25: Study Character Movement

**Compare your Player struct with my Character class**

**Key differences to understand:**
- Separate velocity clamping
- Friction only on horizontal
- Rotation tracking
- State machine (Idle/Moving/Attacking)

**For each difference, ask:**
- Why is this separate?
- What bug does it prevent?
- When would my approach fail?

### Day 26-27: Study Client Prediction

**Read my `client_prediction.ts` in detail**

**Key concepts:**
- Input history with frame numbers
- Reconciliation algorithm
- Remote player interpolation
- Snapshot buffering

**Implement these in your JavaScript client**

### Day 28: Compare Architectures

**Draw diagrams of:**
1. Your architecture
2. My architecture

**Answer:**
- Why FFI instead of pure Rust?
- Why separate StreamManager?
- Why CBOR instead of JSON?
- Why 20 Hz snapshots not 60 Hz?

---

## 📅 Week 5-6: Learn Rust by Porting
### **Goal: Understand Rust by porting your C++ code**

### Day 29-30: Rust Basics

**Learn syntax by comparison:**

```cpp
// C++
struct Player {
    float x, y;
    float vx, vy;

    void update(float dt) {
        x += vx * dt;
    }
};

Player player = {0, 0, 10, 5};
player.update(0.016);
```

```rust
// Rust
struct Player {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
}

impl Player {
    fn update(&mut self, dt: f32) {
        self.x += self.vx * dt;
    }
}

let mut player = Player { x: 0.0, y: 0.0, vx: 10.0, vy: 5.0 };
player.update(0.016);
```

**Key differences:**
- `&mut self` (borrowing)
- No header files
- Pattern matching
- Result/Option types

### Day 31-35: Port Your Arena Game to Rust

**Step by step:**

1. **Day 31:** Port Player struct
2. **Day 32:** Port physics functions
3. **Day 33:** Port Arena class
4. **Day 34:** Port networking (use tokio)
5. **Day 35:** Compare with my code

### Day 36-42: Study & Modify My Code

**Tasks:**
1. Add new feature to my code (e.g., dash ability)
2. Change physics constants
3. Add new player state
4. Add new input type
5. Modify client prediction
6. Add new API endpoint

**For each task:**
- Plan changes
- Implement
- Test
- Debug
- Document what you learned

---

## 🛠️ Resources & Tools

### Development Tools

```bash
# C++ compiler
g++ --version  # Should be 7.0+

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Node.js (for JavaScript)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install node

# Build tools
sudo apt-get install build-essential cmake  # Linux
xcode-select --install  # macOS
```

### Learning Resources

**Game Loop:**
- [Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/) - MUST READ
- Glenn Fiedler's Game Networking series

**Client Prediction:**
- [Gabriel Gambetta - Fast-Paced Multiplayer](https://www.gabrielgambetta.com/client-server-game-architecture.html)
- [Valve Source Engine Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)

**Physics:**
- [Game Physics Cookbook](https://gamephysicscookbook.com/)

**Rust:**
- [The Rust Book](https://doc.rust-lang.org/book/)
- [Rust by Example](https://doc.rust-lang.org/rust-by-example/)

**JavaScript:**
- [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
- [JavaScript.info](https://javascript.info/)

**Babylon.js:**
- [Official Documentation](https://doc.babylonjs.com/)
- [Playground](https://playground.babylonjs.com/)

### My Code References

```
game_engine/
├── include/
│   ├── GameTypes.hpp       → Week 4, Day 22
│   ├── Character.hpp       → Week 4, Day 24
│   └── ArenaGame.hpp       → Week 4, Day 22-23
├── src/
│   ├── game_bindings.cpp   → Week 5, Day 36
│   └── example_usage.cpp   → Week 1-2 comparison
└── client_example/
    └── client_prediction.ts → Week 4, Day 26-27

backend/src/game/
├── ffi.rs                  → Week 5, Day 36
├── manager.rs              → Week 5, Day 37
└── router.rs               → Week 5, Day 38
```

---

## 🐛 Troubleshooting

### Week 1 Issues

**"My game loop runs too fast/slow"**
- Check: Are you using fixed timestep?
- Check: Are you sleeping between frames?
- Debug: Print actual FPS

**"Physics behaves differently each run"**
- Problem: Using variable timestep
- Solution: Use accumulator pattern

**"Players go through each other"**
- Check: Are you calling resolveCollisions()?
- Check: Is collision radius correct?
- Debug: Print distance between players

### Week 2 Issues

**"Network connection fails"**
```bash
# Check if port is available
lsof -i :8080

# Check firewall
sudo ufw status

# Try different port
# Change 8080 to 8081 in both server and client
```

**"Game feels laggy"**
- This is NORMAL for Week 2, Day 8
- Fixed in Week 2, Day 9 with prediction

**"Prediction is wrong"**
- Check: Are you replaying inputs?
- Check: Are frame numbers synchronized?
- Debug: Print prediction error

### Week 3 Issues

**"Canvas is blank"**
- Check browser console (F12)
- Check: Did you call gameLoop()?
- Verify canvas dimensions

**"WebSocket won't connect"**
- Check: Is server running?
- Check: Correct URL (ws:// not http://)
- Check CORS if needed

### Week 5 Issues

**"Rust borrow checker errors"**
- Read error message carefully
- Common fix: Add `&mut`
- Use `.clone()` if needed (not ideal but works)

**"Can't figure out lifetimes"**
- Start with owned types (no references)
- Add references later for optimization

---

## 📝 Weekly Milestones Checklist

### Week 1: C++ Game Loop
- [ ] Fixed timestep game loop works
- [ ] Gravity and jumping work correctly
- [ ] Multiple players collide properly
- [ ] Combat system (attack, health, cooldown)
- [ ] Can explain why fixed timestep matters

### Week 2: Networking
- [ ] TCP server accepts multiple clients
- [ ] Game state syncs over network
- [ ] Client-side prediction implemented
- [ ] Input reconciliation works
- [ ] Can explain prediction algorithm

### Week 3: JavaScript Client
- [ ] Canvas-based game works
- [ ] Network communication works
- [ ] 3D rendering with Babylon.js
- [ ] Client prediction in browser
- [ ] Can explain JavaScript event loop

### Week 4: Study Production
- [ ] Read all my header files
- [ ] Understand all major design decisions
- [ ] Can explain why my code is more complex
- [ ] Know when to use each pattern
- [ ] Can modify my code confidently

### Week 5-6: Rust
- [ ] Understand Rust syntax
- [ ] Port simple game to Rust
- [ ] Understand tokio async
- [ ] Can read my Rust code
- [ ] Can add features to my codebase

---

## 🎯 Final Project Ideas

After completing 6 weeks, build one of these:

**Project 1: Battle Royale**
- 10+ players
- Shrinking arena
- Last player standing wins
- Requires: Everything you learned

**Project 2: Racing Game**
- 4 players
- Track with checkpoints
- Collision between cars
- Requires: Physics + networking

**Project 3: Fighting Game**
- 1v1 combat
- Combos and special moves
- Frame-perfect inputs
- Requires: Tight prediction

**Project 4: Your Own Game**
- Use everything you learned
- Implement your vision
- Add to portfolio!

---

## 💡 Study Tips

### Daily Routine

**Morning (2-3 hours):**
- Read theory
- Watch tutorials
- Take notes

**Afternoon (4-6 hours):**
- Code!
- Experiment
- Break things

**Evening (1-2 hours):**
- Document what you learned
- Plan tomorrow
- Review code

### Learning Strategies

**Active Learning:**
```
Read code → Type it yourself → Modify it → Break it → Fix it
```

**Not just copying:**
```
❌ Copy-paste code
✅ Type it yourself
✅ Change variable names
✅ Add comments explaining why
✅ Modify to add features
```

**When stuck:**
1. Read error message completely
2. Google the error
3. Look at my code for hints
4. Simplify until it works
5. Add complexity back

**Document everything:**
- Keep a learning journal
- Write: "Today I learned..."
- Draw diagrams
- Explain concepts in your own words

---

## 🎓 Assessment

### Week 1 Test Yourself:
```
□ Can you explain fixed timestep to a friend?
□ Can you add new physics (wind, water)?
□ Can you debug jittery movement?
□ Can you add 4th player easily?
```

### Week 2 Test Yourself:
```
□ Can you explain client prediction benefits?
□ Can you implement lag compensation?
□ Can you debug desync issues?
□ Can you add spectator mode?
```

### Week 3 Test Yourself:
```
□ Can you explain JavaScript promises?
□ Can you add particle effects?
□ Can you optimize rendering?
□ Can you profile browser performance?
```

### Week 4 Test Yourself:
```
□ Can you explain each design decision in my code?
□ Can you add new feature without breaking anything?
□ Can you refactor safely?
□ Can you choose right pattern for new feature?
```

### Week 5-6 Test Yourself:
```
□ Can you write Rust without fighting borrow checker?
□ Can you use tokio effectively?
□ Can you profile Rust code?
□ Can you contribute to my codebase?
```

---

## 🚀 Getting Started Tomorrow

**Your action plan for Day 1:**

```bash
# 1. Create workspace
mkdir -p ~/game_dev_learning/day1
cd ~/game_dev_learning/day1

# 2. Create first file
touch game_loop_basic.cpp

# 3. Open in editor
code game_loop_basic.cpp  # or vim, nano, etc.

# 4. Type the Day 1 code (don't copy-paste!)

# 5. Compile
g++ -std=c++17 game_loop_basic.cpp -o game_loop

# 6. Run
./game_loop

# 7. Experiment!
```

**Download this plan:**
```bash
# Save this file
curl -o LEARNING_PLAN.md https://...

# Read daily
cat LEARNING_PLAN.md | grep "Day $(date +%d)"
```

---

## 📞 Getting Help

**When you're stuck:**

1. **Read error message** - Completely, carefully
2. **Google it** - Someone else had this problem
3. **Check my code** - Look for similar pattern
4. **Simplify** - Remove code until it works
5. **Ask** - Stack Overflow, Discord, Reddit

**Good question format:**
```
What I'm trying to do: [goal]
What I expect: [expected behavior]
What actually happens: [actual behavior]
What I've tried: [attempts]
Code: [minimal example]
```

**Resources:**
- r/gamedev
- Game Dev Discord servers
- Stack Overflow
- My code comments

---

## 🎮 Remember

**Learning to build games takes time:**
- Week 1 might feel slow - that's OK!
- Concepts compound - Week 3 builds on Week 1
- Struggle means learning
- Everyone gets stuck
- Keep coding!

**The goal isn't to understand everything immediately:**
- Build working things
- Understand concepts
- Learn by doing
- Iterate and improve

**You'll know you've succeeded when:**
- You can build a multiplayer game from scratch
- You can explain core concepts to others
- You can read and modify production code
- You can debug complex issues
- You can choose the right patterns

---

## ✨ Final Words

You have C++ and networking experience - that's a HUGE advantage!

The hardest parts for most people:
- ✅ C++ syntax - You know this!
- ✅ Network programming - You know this!
- ❓ Game loop concepts - You'll learn Week 1
- ❓ Client prediction - You'll learn Week 2
- ❓ Rust syntax - You'll learn Week 5

**You're going to do great!** 🚀

Start tomorrow with Day 1. Build that simple game loop. Feel the satisfaction of seeing it work.

Then keep building, keep learning, keep coding.

In 6 weeks, you'll have the skills to build professional multiplayer games.

**Let's do this!** 🎮

---

*Last updated: 2026-01-13*
*Questions? Comments? Found a bug in the plan? Let me know!*
