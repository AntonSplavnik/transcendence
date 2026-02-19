#pragma once

#include <cstdint>
#include <cstddef>

namespace ArenaGame {

enum class GameEventType : uint8_t {
    Jump = 0,
    Land = 1,
    Hit = 2,
    Death = 3,
    Footstep = 4,
    Attack = 5,
    Dodge = 6,
};

struct GameEvent {
    GameEventType type;
    uint32_t playerID;
    float posX, posY, posZ;
    float param1;  // context-dependent (e.g., impact velocity for Land)
    float param2;  // reserved
};

class GameEventQueue {
    static constexpr size_t MAX_EVENTS = 64;
    GameEvent m_events[MAX_EVENTS];
    size_t m_count = 0;

public:
    void push(const GameEvent& event) {
        if (m_count < MAX_EVENTS) {
            m_events[m_count++] = event;
        }
    }

    size_t count() const { return m_count; }
    const GameEvent* data() const { return m_events; }
    void clear() { m_count = 0; }
};

} // namespace ArenaGame
