#include "game_session.hpp"

GameSession::GameSession() : tick_count_(0) {}

std::uint32_t GameSession::tick_count() const { return tick_count_; }

void GameSession::tick(std::uint32_t dt_ms) { tick_count_ += dt_ms; }

void GameSession::on_move(std::uint64_t user_id, const Move &msg) {
  (void)user_id;
  (void)msg.delta_x;
  (void)msg.delta_y;
}

void GameSession::on_attack(std::uint64_t user_id, const Attack &msg) {
  (void)user_id;
  (void)msg.target_id;
}

void GameSession::on_use_ability(std::uint64_t user_id, const UseAbility &msg) {
  (void)user_id;
  (void)msg.ability_id;
  (void)msg.target_id;
  server_despawn(ServerDespawn{});
}

void GameSession::on_emote(std::uint64_t user_id, const Emote &msg) {
  (void)user_id;
  (void)msg.emote_id;
}

std::unique_ptr<GameSession> game_session_new() {
  return std::make_unique<GameSession>();
}
