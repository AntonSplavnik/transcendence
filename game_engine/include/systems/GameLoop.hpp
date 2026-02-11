#pragma once

#include "GameTypes.hpp"
#include <chrono>

namespace ArenaGame {

// =============================================================================
// UpdatePhase - Different phases of the game loop
// =============================================================================
enum class UpdatePhase {
    Start,        // Called once at initialization
    EarlyUpdate,  // Called before physics (input processing)
    FixedUpdate,  // Called at fixed intervals (physics simulation)
    Update,       // Called every frame (game logic)
    LateUpdate,   // Called after Update (camera, interpolation)
    Render        // Called for rendering (not used in server)
};

// =============================================================================
// GameLoop - Manages the game loop timing and update phases
// =============================================================================
// Implements fixed timestep for physics and variable timestep for game logic
//
// Loop structure:
//   EarlyUpdate (variable dt) - Process input
//   while (accumulated time >= fixed timestep):
//       FixedUpdate (fixed dt) - Physics simulation
//   Update (variable dt) - Game logic
//   LateUpdate (variable dt) - Post-processing
//
// Based on "Fix Your Timestep" by Glenn Fiedler
// https://gafferongames.com/post/fix_your_timestep/
// =============================================================================

class GameLoop {
public:
    struct Config {
        float fixedTimestep = GameConfig::FIXED_TIMESTEP;  // Physics timestep (default: 1/60s)
        int maxPhysicsIterations = GameConfig::MAX_PHYSICS_ITERATIONS;  // Prevent spiral of death
        float maxDeltaTime = 0.25f;  // Clamp delta time to prevent huge jumps
    };

    GameLoop();

    // Configuration
    void setConfig(const Config& config) { m_config = config; }
    const Config& getConfig() const { return m_config; }

    // Timing
    void reset();
    void tick();  // Call this every frame

    // Query current update phase
    UpdatePhase getCurrentPhase() const { return m_currentPhase; }
    bool isInPhase(UpdatePhase phase) const { return m_currentPhase == phase; }

    // Get delta times for different phases
    float getVariableDeltaTime() const { return m_variableDeltaTime; }  // For Update/LateUpdate
    float getFixedDeltaTime() const { return m_config.fixedTimestep; }  // For FixedUpdate
    float getInterpolationAlpha() const { return m_accumulator / m_config.fixedTimestep; }  // For rendering

    // Frame/time info
    uint64_t getFrameCount() const { return m_frameCount; }
    uint64_t getFixedFrameCount() const { return m_fixedFrameCount; }
    double getTotalTime() const { return m_totalTime; }
    double getFixedTime() const { return m_fixedTime; }
    float getFPS() const { return m_currentFPS; }

    // Check if we should execute a phase this frame
    bool shouldExecuteEarlyUpdate() const { return m_executeEarlyUpdate; }
    bool shouldExecuteFixedUpdate() const { return m_executeFixedUpdate; }
    bool shouldExecuteUpdate() const { return m_executeUpdate; }
    bool shouldExecuteLateUpdate() const { return m_executeLateUpdate; }

    // For manual phase control (advanced usage)
    void beginPhase(UpdatePhase phase) { m_currentPhase = phase; }
    void endPhase() { m_currentPhase = UpdatePhase::Update; }

private:
    Config m_config;

    // Timing
    std::chrono::steady_clock::time_point m_lastFrameTime;
    float m_variableDeltaTime;
    float m_accumulator;

    // Frame counters
    uint64_t m_frameCount;        // Total frames
    uint64_t m_fixedFrameCount;   // Physics frames
    double m_totalTime;           // Total elapsed time
    double m_fixedTime;           // Physics time

    // Current phase
    UpdatePhase m_currentPhase;

    // Phase execution flags (set by tick())
    bool m_executeEarlyUpdate;
    bool m_executeFixedUpdate;
    bool m_executeUpdate;
    bool m_executeLateUpdate;

    // FPS tracking
    float m_currentFPS;
    float m_fpsAccumulator;
    int m_fpsFrameCount;
    std::chrono::steady_clock::time_point m_lastFPSTime;
};

// =============================================================================
// Implementation
// =============================================================================

inline GameLoop::GameLoop()
    : m_variableDeltaTime(0.0f)
    , m_accumulator(0.0f)
    , m_frameCount(0)
    , m_fixedFrameCount(0)
    , m_totalTime(0.0)
    , m_fixedTime(0.0)
    , m_currentPhase(UpdatePhase::Update)
    , m_executeEarlyUpdate(false)
    , m_executeFixedUpdate(false)
    , m_executeUpdate(false)
    , m_executeLateUpdate(false)
    , m_currentFPS(0.0f)
    , m_fpsAccumulator(0.0f)
    , m_fpsFrameCount(0)
{
    reset();
}

inline void GameLoop::reset() {
    m_lastFrameTime = std::chrono::steady_clock::now();
    m_lastFPSTime = m_lastFrameTime;
    m_variableDeltaTime = 0.0f;
    m_accumulator = 0.0f;
    m_frameCount = 0;
    m_fixedFrameCount = 0;
    m_totalTime = 0.0;
    m_fixedTime = 0.0;
    m_currentFPS = 0.0f;
    m_fpsAccumulator = 0.0f;
    m_fpsFrameCount = 0;
}

inline void GameLoop::tick() {
    // Calculate delta time
    auto currentTime = std::chrono::steady_clock::now();
    float rawDeltaTime = std::chrono::duration<float>(currentTime - m_lastFrameTime).count();
    m_lastFrameTime = currentTime;

    // Clamp delta time to prevent spiral of death
    m_variableDeltaTime = std::min(rawDeltaTime, m_config.maxDeltaTime);

    // Accumulate time for fixed updates
    m_accumulator += m_variableDeltaTime;

    // Update total time
    m_totalTime += m_variableDeltaTime;
    m_frameCount++;

    // Determine which phases to execute this frame
    m_executeEarlyUpdate = true;  // Always execute
    m_executeFixedUpdate = (m_accumulator >= m_config.fixedTimestep);
    m_executeUpdate = true;       // Always execute
    m_executeLateUpdate = true;   // Always execute

    // Update FPS counter (every second)
    m_fpsAccumulator += m_variableDeltaTime;
    m_fpsFrameCount++;

    auto timeSinceLastFPS = std::chrono::duration<float>(currentTime - m_lastFPSTime).count();
    if (timeSinceLastFPS >= 1.0f) {
        m_currentFPS = m_fpsFrameCount / timeSinceLastFPS;
        m_lastFPSTime = currentTime;
        m_fpsFrameCount = 0;
    }
}

} // namespace ArenaGame
