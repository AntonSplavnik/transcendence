# Transcendence Project Context

## Overview
Transcendence is a real-time multiplayer web application. While the original requirement (based on the project name/README) suggests a Pong game, the current codebase implements a **Roguelike/RPG Dungeon Crawler** with multiplayer elements.

## Tech Stack

### Backend
- **Language:** Rust (Edition 2024)
- **Framework:** [Salvo](https://salvo.rs/) (Web API, HTTP/3, WebTransport)
- **Database:** SQLite
- **ORM:** Diesel
- **Async Runtime:** Tokio
- **Serialization:** Serde, Ciborium (CBOR), Zstd (compression)
- **Authentication:**
    - JWT (Short-lived access tokens)
    - Sessions (Long-lived refresh tokens, DB-backed)
    - TOTP (2FA) + Recovery Codes
    - Argon2 (Password hashing)
- **Real-time Communication:** WebTransport (via Salvo/Quinn) using a custom `compress_cbor_codec`.

### Frontend
- **Framework:** React 19
- **Build Tool:** Vite
- **Language:** TypeScript
- **Styling:** TailwindCSS, PostCSS
- **Game Engine:**
    - [Babylon.js](https://www.babylonjs.com/) (3D Rendering)
    - [rot.js](https://ondras.github.io/rot.js/hp/) (Roguelike utilities)
- **State Management:** React Hooks / Context (implied)

## Project Structure

### Backend (`/backend`)
- `src/main.rs`: Application entry point.
- `src/auth/`: robust authentication logic (Session, JWT, TOTP).
- `src/db.rs` & `src/schema.rs`: Database connection and Diesel schema.
- `src/routers.rs`: API route definitions.
- `src/stream/`: Real-time stream handling (WebTransport/Quinn).
- `migrations/`: Diesel SQL migrations.
- `config.toml`: Application configuration.

### Frontend (`/frontend`)
- `src/App.tsx`: Main React component / routing.
- `src/game/`: Game logic, scenes, entities, systems.
    - `scenes/`: Babylon.js scenes (e.g., `GameScene.tsx`).
    - `entities/`: Game objects (Player, Enemy, Chest, etc.).
    - `systems/`: Game systems (PerkSystem, etc.).
- `src/components/`: React UI components (Profile, Friends, Auth).
- `src/assets/`: Game assets (sprites, sounds).

## Key Database Tables (`backend/src/schema.rs`)
- `users`: Core user data (email, password_hash, totp).
- `sessions`: Active refresh sessions.
- `game_history`: Stats per game (kills, time_played). *Note: "kills" confirms RPG nature.*
- `user_stats`: Aggregated user statistics.
- `friendships`: Friend system.

## Development Commands

### Backend
- **Run:** `cargo run`
- **Check:** `cargo check`
- **Lint:** `cargo clippy`
- **Migrate:** `diesel migration run`

### Frontend
- **Install:** `npm install`
- **Dev Server:** `npm run dev` (Runs Vite)
- **Build:** `npm run build`
- **Lint:** `npm run lint`

## Notes for LLM Agent
- **Conventions:** Follow Rust idiomatic patterns (Result/Option, iterators). Use Functional React components with Hooks.
- **Context:** The game is likely *not* Pong despite the project name. It involves weapons, enemies, and stats like "kills".
- **API:** The backend exposes a REST API at `/api` and a WebTransport endpoint at `/api/wt`.
