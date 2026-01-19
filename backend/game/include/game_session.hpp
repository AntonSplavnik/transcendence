#pragma once

#include <cstdint>

class GameSession;

#include "transcendence-backend/src/game_ffi.rs.h"

class GameSession {
public:
  GameSession();

  std::uint32_t tick_count() const;
  void tick(std::uint32_t dt_ms);
  void on_move(std::uint64_t user_id, const Move &msg);
  void on_attack(std::uint64_t user_id, const Attack &msg);
  void on_use_ability(std::uint64_t user_id, const UseAbility &msg);
  void on_emote(std::uint64_t user_id, const Emote &msg);

private:
  std::uint64_t tick_count_;
};

std::unique_ptr<GameSession> game_session_new();
