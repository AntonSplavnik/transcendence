_This project has been created as part of the 42 curriculum by kwurster, asplavnic, drongier, lmeubrin_

# ft_transcendence

> A character-based browser fighting game with real-time WebTransport, 3D Babylon.js rendering,
> and a social layer (profiles, chat, friends). Future stretch goal: cooperative survival in a
> procedurally generated world against AI enemies.

---

## Table of Contents

- [Description](#description)
- [Team Information](#team-information)
- [Project Management](#project-management)
- [Instructions](#instructions)
- [Technical Stack](#technical-stack)
- [Database Schema](#database-schema)
- [Features List](#features-list)
- [Modules](#modules)
- [Individual Contributions](#individual-contributions)
- [Resources](#resources)

---

## Description

ft_transcendence is a full-stack, real-time multiplayer web game built entirely in the browser. Players register, pick a character, and fight opponents in a 3D arena rendered with Babylon.js. All gameplay events are streamed over WebTransport (HTTP/3), giving the server authoritative control with minimal latency.
Our game is called **Hit 'em good** — a character-based arena fighter supporting 2–8 players with multiple game modes.

**Key features:**

- **3D arena fighter** with 2 playable character classes (Knight and Rogue), combo attack chains, abilities, and stamina mechanics — rendered in Babylon.js with isometric camera
- **Server-authoritative game engine** written in C++ (entt ECS), compiled into the Rust backend via CXX FFI, running at 60 Hz on a dedicated thread
- **2–8 player multiplayer** over WebTransport (HTTP/3) with lobby system, character selection, and ready-up countdown
- **Two game modes**: Deathmatch (kill-limit, respawning) and Last Standing (elimination, no respawns)
- **Spectator mode** allowing users to watch ongoing matches in real time
- Secure registration and login with Argon2id password hashing
- Optional TOTP two-factor authentication with recovery codes
- Full session management: view all active sessions, revoke them remotely, and change passwords — all MFA-protected
- Friends system with real-time online status tracking
- Profile system with custom avatars (AVIF format, client-side conversion)
- Real-time notification system with WebTransport delivery and offline persistence
- Spatial audio engine with per-character sound events
- Privacy Policy and Terms of Service pages
- Complete HTTPS everywhere via Salvo + Rustls

---

## Team Information

| Login | GitHub | Role |
|-------|--------|------|
| kwurster | [@kjzl](https://github.com/kjzl) | Tech Lead, Backend Engineer |
| asplavnic | [@AntonSplavnik](https://github.com/AntonSplavnik) | Product Owner, Game Developer |
| lmeubrin | [@Moat423](https://github.com/Moat423) | Project Manager, Frontend Engineer |
| drongier | [@drongier](https://github.com/drongier) | Full-stack Developer, DevOps |

**kwurster** designed and built the entire Rust backend: auth system, 2FA, Diesel ORM with SQLite migrations, rate limiting, the WebTransport `stream_manager`, notification infrastructure, and the full test suite. He also wrote the CI/CD pipeline for the backend and the frontend WebTransport codec (`CompressedCborCodec.ts`).
His responsibilities as the Tech Lead included setting the overall technical direction, defining the architecture of the backend, and ensuring security best practices were followed throughout, such as using proper CI/CD pipelines, secure password hashing, and robust session management.

**asplavnic** defined the game vision and mechanics as product owner. He developed the complete game: the C++ ECS game engine (entt), the Babylon.js 3D scene with character animations and weapon swing trails, combat mechanics (attack chains, abilities, stamina), two game modes (Deathmatch and Last Standing), and the a lot of the frontend game client (lobby UI, HUD).
As a Product Owner, he was responsible for defining the user experience for this game-project, and ensuring the final product met the initial vision.

**lmeubrin** architected the frontend: React Router setup, `AuthContext`, route guards, JWT refresh (both proactive timer-based and reactive Axios interceptor), 2FA frontend modals, the session management page, and the landing page (`LandingPage.tsx` + `LandingScene.tsx`). She built the design system (17+ UI components including game-specific components like `CharacterSelector`, `CharacterPicker`, `PlayerAvatarRow`, `ChampionGrid`, and `CharacterStats` and the game end screen), the frontend CI/CD pipeline, the Privacy Policy and Terms of Service pages, and the spectator mode.
Her Project Manager role involved coordinating the team, setting impulses for meetings and strategy, and ensuring that the team stayed on track.

**drongier** owns the avatar system end-to-end: backend validation, caching, and router; frontend upload flow, client-side AVIF conversion, display, and ETag caching; and the profile editing modal (`EditUserModal`). He built the friends frontend (`FriendsDrawer`, `AddFriendForm`), designed and implemented the in-game audio stack (Babylon `AudioEngineV2` buses, shared `SoundBank`, and trigger-table-driven playback), including local/remote/game-event sound behavior, anti-spam cooldown tuning, and combat-focused sound design/mix balancing for clearer gameplay feedback. He also contributed audio integration for the 3D engine and the frontend game client.
As a developer with a full-stack role, he worked closely with all parts of the project.

---

## Project Management

The team used GitHub for all collaboration:

- **Issues and pull requests** for task tracking and code review — every feature went through a PR with at least one review before merge and issues were used extensively.
- **Slack** as the primary communication channel for daily coordination and sharing documents.

Work was distributed by area of ownership: kwurster held the backend (auth, sessions, WebTransport, game server integration), lmeubrin held the frontend architecture and design system, asplavnic drove game direction and built the game engine and 3D client, and drongier covered avatar/profile, friends frontend, audio, and deployment infrastructure.

---

## Instructions

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Rust (stable) | 1.85+ | Backend compiler |
| Cargo | ships with Rust | Backend build + test |
| Node.js | 20+ | Frontend build toolchain |
| npm | 10+ | Frontend package manager |
| diesel_cli | latest | Database migrations |
| mkcert / openssl | any | Generate local TLS certificate |

### Environment setup

The backend reads configuration from a `.env` file. Copy the example and fill in values:

```sh
cp backend/.env.example backend/.env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite path, e.g. `file:./data/diesel.sqlite` |
| `TOTP_ENC_KEY` | Yes | Base64-encoded 32-byte AES key for encrypting TOTP secrets |

### TLS certificates

`make setup` automatically generates a self-signed TLS certificate in `backend/certs/` using openssl if one does not already exist. If `certutil` (from `libnss3-tools`) is available, the certificate is also registered in the user's NSS database so Chrome and Firefox trust it without warnings.

To verify the current certificate status:

```sh
make check-cert
```

### Running

All commands are run from the repository root via the Makefile.

**Docker (recommended):**

```sh
make          # Build and start all containers (foreground)
make dev      # Docker in background + local Vite hot reload + Chrome dev instance
make lean     # Sequential Docker build for space-constrained machines
```

`make` (alias for `make all`) builds the frontend and backend in a multi-stage Docker image and starts the application via `docker compose`. `make dev` starts Docker in the background, then runs the Vite dev server locally with hot reload — ideal for frontend development.

**Local build (without Docker):**

```sh
make build    # npm ci + npm run build + cargo build
```

**Opening Chrome with WebTransport support:**

```sh
make chrome-dev                                    # Opens https://localhost:8443
make chrome-dev CHROME_URL=http://localhost:5173    # Opens the Vite dev server
```

This launches a separate Chrome instance with `--webtransport-developer-mode` enabled and the self-signed certificate SPKI pinned (required for WebTransport over self-signed TLS).

**Backend tests:**

```sh
cd backend && cargo test
```

Frontend tests:

```sh
cd frontend && npm run test
```


All pre push hooks:

```sh
make prek
```


**Docker management:**

```sh
make docker-down    # Stop containers
make docker-clean   # Stop containers + remove volumes and images
make reset-db       # Reset database volumes
```

**Clean everything:**

```sh
make clean    # Remove frontend/dist, node_modules, cargo artifacts, Docker volumes and images
```

---

## Technical Stack

### Frontend

| Technology | Role | Why |
|------------|------|-----|
| React 19 | UI framework | Component model, large ecosystem, composable with 3D canvas |
| Vite + SWC | Build tool | Instant hot reload; SWC compiler is written in Rust |
| TypeScript | Language | Static types catch errors early, essential for complex auth + game state |
| Tailwind CSS | Styling | Utility-first, custom theme (stone + gold palette), no CSS file context-switching |
| Babylon.js | 3D engine | Browser-native WebGL game engine; handles scene, physics, camera, and assets |
| Babylon AudioEngineV2 | Audio engine | Bus-based routing (`master/sfx/music/ambient/ui`), spatial audio, and shared sound playback control |
| Axios | HTTP client | Interceptors make JWT 401-retry logic clean and centralised |
| React Router | Client routing | Hash navigation, route guards (ProtectedRoute / PublicRoute) |
| WebTransport | Real-time transport | HTTP/3 persistent connection to backend for game events and notifications |

For full frontend documentation including the design system and component reference, see [docs/frontend.md](docs/frontend.md).

### Backend

| Technology | Role | Why |
|------------|------|-----|
| Rust (stable) | Language | Memory-safe systems language; no GC pauses, ideal for game servers |
| Salvo | Web framework | Async, ergonomic routing and middleware ("hoops"); first-class WebTransport support |
| Rustls | TLS | Pure-Rust TLS stack; no OpenSSL dependency, simpler deployment |
| Diesel | ORM | Compile-time query type-checking; schema-first migrations |
| SQLite | Database | Embedded, zero-config, sufficient for the expected user load |
| Argon2id | Password hashing | OWASP-recommended memory-hard algorithm |
| BLAKE3 | Token hashing | Fast, cryptographically secure; used to hash session tokens before DB storage |
| TOTP (totp-rs) | Two-factor auth | RFC 6238 TOTP; secrets encrypted at rest with AES |
| quick_cache | In-memory cache | LRU cache for small avatars (1000 entries, ~4 MB) |
| CBOR | Serialisation | Compact binary format for WebTransport messages (`CompressedCborCodec`) |
| C++ 20 game engine (entt) | Game logic | ECS-based game engine compiled into Rust via CXX FFI bridge; handles physics, combat, and game modes at 60 Hz |
| DashMap / parking_lot | Concurrency | Lock-free concurrent hash maps for connection tracking; efficient mutexes for lobby state |

For full backend authentication documentation, see [docs/backend-auth.md](docs/backend-auth.md).
For the avatar system, see [docs/avatar-backend.md](docs/avatar-backend.md).

### Database

SQLite was chosen because:

- Zero configuration — no separate database server process to run or deploy.
- The Diesel ORM provides compile-time checked queries and a robust migration system.
- For a game with up to ~1000 concurrent users, SQLite's single-writer model is not a bottleneck; all hot reads go through the in-memory cache.
- Simplifies Docker deployment (single binary + single file).

---

## Database Schema

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `email` | TEXT UNIQUE | Case-insensitive (`COLLATE NOCASE`) |
| `nickname` | TEXT UNIQUE | Case-insensitive (`COLLATE NOCASE`) |
| `password_hash` | TEXT | Argon2id encoded hash |
| `description` | TEXT | User bio; defaults to empty string |
| `totp_enabled` | BOOLEAN | True only after enrollment is confirmed |
| `totp_secret_enc` | TEXT nullable | AES-encrypted TOTP secret |
| `totp_confirmed_at` | DATETIME nullable | Timestamp of successful 2FA enrollment |
| `created_at` | DATETIME | |
| `tos_accepted_at` | DATETIME nullable | Set when user accepts the current Terms of Service |
| `email_confirmed_at` | DATETIME nullable | Set when user confirms their email address |
| `email_confirmation_token_hash` | BLOB nullable | BLAKE3 hash of the email-confirmation token |
| `email_confirmation_token_expires_at` | DATETIME nullable | Expiry of the confirmation token |
| `email_confirmation_token_email` | TEXT nullable | Email address the confirmation was sent to |

### `sessions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK | References `users(id)` ON DELETE CASCADE |
| `token_hash` | BLOB UNIQUE | BLAKE3 hash of the raw session token (32 bytes) |
| `device_id` | TEXT | Browser/device identifier cookie value |
| `device_name` | TEXT nullable | Derived from User-Agent header |
| `ip_address` | TEXT nullable | Remote address at login time |
| `created_at` | DATETIME | |
| `refreshed_at` | DATETIME | Updated on every token rotation |
| `last_used_at` | DATETIME | Updated on every authenticated request |
| `last_authenticated_at` | DATETIME | Updated on login and explicit reauth; set to epoch to force reauth |

### `two_fa_recovery_codes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK | References `users(id)` ON DELETE CASCADE |
| `code_hash` | BLOB | BLAKE3 hash of the recovery code (raw codes never stored) |
| `used_at` | DATETIME nullable | Set when code is consumed (single-use) |
| `created_at` | DATETIME | |

### `avatars_large`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | INTEGER PK FK | References `users(id)` ON DELETE CASCADE |
| `data` | BLOB | AVIF image at 450x450 px, max 30 KB |
| `updated_at` | TIMESTAMP | |

### `avatars_small`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | INTEGER PK FK | References `users(id)` ON DELETE CASCADE |
| `data` | BLOB | AVIF image at 200x200 px, max 12 KB; LRU-cached in memory |
| `updated_at` | TIMESTAMP | |

### `notifications`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK | References `users(id)` ON DELETE CASCADE |
| `data` | BLOB | CBOR-encoded `Notification` enum value |
| `created_at` | DATETIME | |

### `account_deletion_requests`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | INTEGER PK FK | References `users(id)` ON DELETE CASCADE |
| `token` | BLOB | 32-byte random token, base64url-encoded in API responses |
| `confirm_token` | BLOB nullable | 32-byte email confirmation token; NULL after confirmed |
| `expires_at` | DATETIME | 30 minutes from initiation |

### `data_export_requests`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | INTEGER PK FK | References `users(id)` ON DELETE CASCADE |
| `token` | BLOB | 32-byte random token, base64url-encoded in API responses |
| `confirm_token` | BLOB nullable | 32-byte email confirmation token; NULL after confirmed |
| `expires_at` | DATETIME | 30 minutes from initiation |

### `friend_requests`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `sender_id` | INTEGER FK | References `users(id)` ON DELETE CASCADE |
| `receiver_id` | INTEGER FK | References `users(id)` ON DELETE CASCADE; CHECK `sender_id != receiver_id` |
| `status` | INTEGER | 0 = pending, 1 = accepted; CHECK IN (0, 1) |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

Unique constraint on the ordered pair `(MIN(sender_id, receiver_id), MAX(sender_id, receiver_id))` prevents duplicate requests between the same two users.

### `tos_versions`

| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT PK | Version identifier (e.g. `"v1"`) |
| `created_at` | DATETIME | Defaults to `CURRENT_TIMESTAMP` |

### Relationships summary

- One user has many sessions (cascade delete).
- One user has many recovery codes (cascade delete).
- One user has at most one large avatar and one small avatar (cascade delete).
- One user has many notifications (cascade delete).
- One user has at most one pending deletion request and one pending export request (cascade delete).
- One user can send and receive many friend requests (cascade delete both sides).
- `tos_versions` is a standalone lookup table (no FK to users).
- Sessions reference users; avatars and notifications are user-scoped.

---

## Features List

### Authentication & Security

| Feature | By | Description |
|---------|-----|-------------|
| Registration | kwurster | Email + nickname uniqueness enforced at DB level (case-insensitive). Argon2id hashing. Rate-limited. |
| Login | kwurster | Constant-time password verification. 2FA check if enabled. Reuses existing device session. Rate-limited. |
| Two-token auth | kwurster | Short-lived JWT (15 min, HttpOnly cookie) + long-lived session token (BLAKE3-hashed, path-scoped cookie). JWT rotated on every refresh. |
| JWT refresh (reactive) | lmeubrin | Axios interceptor retries any request that gets `InvalidJwt` 401, then replays the original call. |
| JWT refresh (proactive) | lmeubrin | Timer-based hook fires 1 minute before expiry. Handles backgrounded tabs via page visibility API. Exponential backoff on network errors. |
| TOTP 2FA | kwurster (backend), lmeubrin (frontend) | RFC 6238 TOTP. Secret encrypted at rest. Single-use recovery codes stored as hashes. Enable/confirm/disable flow. |
| Rate limiting | kwurster | IP-based limits on register/login. User + IP limits on authenticated endpoints. |
| HTTPS / TLS | kwurster | Salvo + Rustls; all cookies `Secure`, `HttpOnly`, `SameSite=Lax`. |
| GDPR compliance | kwurster (backend), lmeubrin (frontend) | Account deletion (pseudo-anonymization) and personal data export via three-phase token flow. Password + MFA verification at each step. Email confirmation for verified users. Frontend "Privacy & Data" modal with nickname confirmation for deletion. |

### Session Management

| Feature | By | Description |
|---------|-----|-------------|
| Session listing | kwurster (backend), lmeubrin (frontend) | Password-gated. Shows device name, IP, timestamps for all sessions. |
| Remote logout | kwurster (backend), lmeubrin (frontend) | Deauth selected sessions or all other sessions. MFA-verified. |
| Session deletion | kwurster (backend), lmeubrin (frontend) | Hard-delete session records from DB. Password + MFA required. |
| Password change | kwurster (backend), lmeubrin (frontend) | Optional: force reauth on all other sessions after password change. |

### Profile

| Feature | By | Description |
|---------|-----|-------------|
| Avatar upload | drongier | Client converts any image to AVIF at two sizes (450x450 and 200x200) before upload. Backend validates format, dimensions, size limits. No alpha or animation allowed. |
| Avatar display | drongier | Small avatars LRU-cached in memory (1000 entries). HTTP ETag caching. Default AVIF avatar embedded in binary. |
| Profile editing | drongier | `EditUserModal` for changing nickname and description. |
| User description | drongier (frontend) | Free-text bio field on user profile. |

### Real-time & Networking

| Feature | By | Description |
|---------|-----|-------------|
| WebTransport connection | kwurster | HTTP/3 persistent connection with two-step auth. `stream_manager` manages per-user bidirectional streams with automatic displacement on multi-tab login. |
| CBOR codec | kwurster | `CompressedCborCodec.ts` on the frontend encodes/decodes binary messages with zstd compression. |
| Notifications | kwurster | 5 notification types covering friend CRUD. Real-time delivery via WebTransport; offline persistence in DB with at-least-once delivery on reconnect. |
| Notification UI | drongier (audio), lmeubrin (toast) | `NotificationToast` with stacking, slide-out dismiss, sound effects, and click-through to relevant UI. |
| Stream groups | kwurster | `StreamGroup` broadcast model for lobby and game streams. Fire-and-forget with backpressure cancellation — slow clients are dropped, not buffered. |

### Game Engine & Gameplay

| Feature | By | Description |
|---------|-----|-------------|
| C++ ECS game engine | asplavnic | entt-based Entity Component System compiled into Rust via CXX FFI. 6 systems (CharacterController, Physics, Collision, Combat, GameMode, Stamina) run in 4 phases per tick. |
| 60 Hz server-authoritative loop | kwurster (hosting), asplavnic (engine) | Game runs on dedicated OS thread (not tokio task) at 16.67 ms per tick. Server holds authoritative state; clients receive read-only snapshots. |
| Character classes | asplavnic | 2 playable classes (Knight and Rogue) with distinct stats, attack chains (2–3 stages), 2 unique abilities each, and stamina pools. |
| Combat system | asplavnic | Attack chains with timing windows, abilities with cooldowns and cast durations, stamina costs, critical hits, knockback. All validated server-side. |
| Game modes | asplavnic | Deathmatch (kill-limit with respawns) and Last Standing (elimination, no respawns). Win conditions, player ranking, and match-end stats per mode. |
| Lobby system | kwurster (backend), asplavnic (frontend) | Create/join/leave lobbies, character selection, ready-up with countdown (3 s all-ready / 10 s full / 60 s default), public/private visibility, game mode selection. |
| Spectator mode | lmeubrin | Users can spectate ongoing matches via `spectateLobby()` API. Spectators receive game snapshots on a uni-stream (no input allowed). Count displayed in lobby. |

### 3D Rendering

| Feature | By | Description |
|---------|-----|-------------|
| Babylon.js scene | asplavnic | Isometric orthographic camera, Forest arena environment loaded from glTF, KayKit Adventurers asset pack. |
| Character rendering | asplavnic (animations), lmeubrin (UI components) | glTF character models with bone-attached equipment (weapons, shields), animation state machines with crossfading, weapon swing trails with vertex color alpha. |
| In-game HUD | asplavnic | Babylon.js GUI overlay: health bar, stamina bar, ability cooldown bars (local player); world-space projected enemy health bars above each character. |
| Game-end leaderboard | asplavnic | Modal with placement, kills, deaths, damage dealt/taken per player. Auto-return to lobby after countdown. |

### Friends & Social

| Feature | By | Description |
|---------|-----|-------------|
| Friends system | kwurster (backend), drongier (frontend) | Full CRUD: send, accept, reject, cancel, and remove friend requests. Backend in `backend/src/friends/` with comprehensive test suite. |
| Online status | kwurster (backend), drongier (frontend) | Real-time presence via `StreamManager::is_connected()`. Green/gray dot indicator in friends drawer and public profiles. |
| Public profiles | drongier (modal) | `PublicProfileModal` showing avatar, nickname, online status, bio, and member-since date. Triggered from friends list. |
| Friends drawer | drongier | `FriendsDrawer` with sections for friends list, incoming requests (with counter badge), and pending outgoing requests. |

### UI/UX

| Feature | By | Description |
|---------|-----|-------------|
| Design system | lmeubrin | 17 reusable components (`Button`, `Card`, `Modal`, `Input`, `Alert`, `Badge`, `Dropdown`, `InfoBlock`, `ErrorBanner`, `LoadingSpinner`, `Layout`). Stone/gold/dungeon theme. |
| Landing page | lmeubrin | `LandingPage.tsx` with animated `LandingScene.tsx`. Entry point before auth. |
| Route guards | lmeubrin | `ProtectedRoute` / `PublicRoute` wrap all routes; unauthenticated users redirect to `/auth`, authenticated users redirect to `/home`. |
| Error banner | lmeubrin | Fixed-position auto-dismiss banner for cross-page error messages (stored in `localStorage` between redirects). |
| Privacy Policy | asplavnic | Accessible from footer; covers data collection, cookies, and user rights. |
| Terms of Service | asplavnic | Accessible from footer; covers acceptable use and account rules. |
| Sound system | drongier | Spatial audio engine with `AudioEngineV2` bus routing (`master/sfx/music/ambient/ui`), preloaded `SoundBank`, trigger tables for local/remote/game events, anti-spam cooldown, and persistent audio settings. |
| WCAG 2.1 AA accessibility | lmeubrin/drongier | Full keyboard navigation (Dropdown arrow keys, Modal focus trap), skip link, reduced-motion support, ARIA landmark regions, descriptive labels on all interactive elements. The 3D game canvas carries a descriptive text alternative under WCAG SC 1.1.1 (sensory experience exemption). |

---

## Modules

### Summary

| # | Module | Type | Points | Status |
|---|--------|------|--------|--------|
| 1 | Frontend + backend frameworks (React + Salvo) | Web Major | 2 | Done |
| 2 | Real-time features via WebTransport HTTP/3 | Web Major | 2 | Done |
| 3 | Advanced 3D graphics — Babylon.js | Gaming Major | 2 | Done |
| 4 | Complete web-based game (arena fighter) | Gaming Major | 2 | Done |
| 5 | Remote players | Gaming Major | 2 | Done |
| 6 | ORM — Diesel + SQLite | Web Minor | 1 | Done |
| 7 | Two-Factor Authentication (TOTP) | User Mgmt Minor | 1 | Done |
| 8 | Custom: Session Management | Modules of choice Minor | 1 | Done |
| 9 | Custom: Audio System | Modules of choice Minor | 1 | Done |
| 10 | Accessibility compliance (WCAG 2.1 AA) | Accessibility Major | 2 | Done |
| 11 | Multiplayer 3+ players | Gaming Major | 2 | Done |
| 12 | Spectator mode | Gaming Minor | 1 | Done |
| 13 | Custom design system | Web Minor | 1 | Done |
| 14 | Standard user management | User Mgmt Major | 2 | Done |
| 15 | Game customization options | Gaming Minor | 1 | Done |
| 16 | Notification system | Web Minor | 1 | Done |
| 17 | User interaction — chat, friends, profiles | Web Major | 2 | In progress |
| 18 | Gamification system | Web Minor | 1 | Done |

| | **Total (excluding module 17)** | | **25** | Exceeds 14-point target |

---

### Module 1 — Frontend and backend frameworks

_Web Major (2 pts) — by all (lmeubrin (frontend) and kwurster (backend) and asplavnic (game front and backend) and drongier (frontend and backend))_

The subject allows replacing the default vanilla JS frontend and the default backend with framework-based alternatives. We use **React** (with Vite, TypeScript, and Tailwind CSS) on the frontend and **Salvo** (a Rust async web framework) on the backend.

**Why React:** Component model maps naturally onto a game UI with distinct panels (auth, profile, game canvas, session management). React's virtual DOM and context API make state management across auth flows and JWT refresh tractable. Also it is valuable nowadays to learn a modern frontend framework and React is the most widely used with a huge ecosystem.

**Why Salvo:** Salvo is one of the few Rust web frameworks with first-class WebTransport support. Its "hoop" middleware model is composable and makes route-level authentication, rate limiting, and request enrichment declarative.

**Implementation:** The frontend lives in `frontend/` (React + Vite + TypeScript + Tailwind). The backend lives in `backend/` (Rust + Salvo + Diesel). The Vite dev proxy forwards `/api/*` to the backend during development; in production the backend serves the compiled `dist/` folder.

---

### Module 2 — Real-time features via WebTransport HTTP/3

_Web Major (2 pts) — by kwurster (backend, notification frontend) and asplavnic (game frontend) and drongier (friends frontend) and lmeubrin (game frontend)_

WebTransport (HTTP/3) replaces conventional WebSocket for all real-time game and notification traffic. Unlike WebSockets, WebTransport supports multiple independent bidirectional streams within one connection, does not have head-of-line blocking, and runs over QUIC.

**Why WebTransport over WebSocket:** Game events for different entities can be sent on independent streams; a dropped packet for one stream does not stall others. QUIC's connection migration also handles mobile network handoffs more gracefully. It is faster and more efficient than WebSockets, especially for the real-time demands of a fighting game.

**Implementation:** The Rust backend exposes `/api/wt` as a WebTransport endpoint (gated by `requires_user_login()`). The `stream_manager` module manages per-user stream lifecycle. The frontend `CompressedCborCodec.ts` encodes messages as CBOR with zstd compression before sending. On connect, the server sends a `ServerHello` notification to confirm the session is live.

---

### Module 3 — Advanced 3D graphics with Babylon.js

_Gaming Major (2 pts) — by asplavnic (scene, animations, weapon trails), lmeubrin (character rendering UI), drongier (audio integration, minor fixes)_

The game arena is rendered in 3D using **Babylon.js**, a full-featured browser game engine built on WebGL. Babylon handles the scene graph, lighting, camera, mesh loading, physics, and the render loop — allowing us to build a visually rich arena without writing raw WebGL.

**Why Babylon.js over Three.js:** Babylon.js is purpose-built for games (built-in physics, animation system, collision detection, asset manager) rather than general 3D visualisation. It also has strong TypeScript support.

**Implementation:** The Babylon scene is wrapped in a React component (`GameCanvas.tsx`) that uses `useRef` for the `<canvas>` element and `useEffect` for engine lifecycle. The camera uses an isometric orthographic projection (35.264° elevation, 45° Y-rotation) for a fixed overhead view. Character models are loaded from the KayKit Adventurers glTF pack with bone-attached equipment (swords, shields, daggers) and crossfaded animation state machines. Weapon swing trails use vertex color alpha blending for visual feedback during attacks. The Forest arena is loaded as a full glTF scene. Per-frame updates stay inside Babylon's render loop to avoid triggering React re-renders — high-frequency game snapshots (60 Hz) are stored in refs, not React state.

---

### Module 4 — Complete web-based game (arena fighter)

_Gaming Major (2 pts) — by mostly asplavnic (game engine + frontend) and kwurster (backend integration) (with contributions from lmeubrin and drongier)_

The core deliverable is a fully playable character-based arena fighting game running in the browser. Players pick a character, enter a match, and fight in real time. The server holds authoritative game state via a C++ game engine (entt ECS) compiled into the Rust backend through CXX FFI.

**Why a fighting game:** A fighting game is a natural fit for WebTransport's low-latency bidirectional streams. Client sends inputs; server validates, updates state, and broadcasts to all players in the match. This cleanly demonstrates the real-time module.

**Implementation:** The game engine runs 6 ECS systems across 4 phases per tick at 60 Hz on a dedicated OS thread: CharacterController (input), Physics + Collision (fixed update), Combat (attack chains, abilities, damage), GameMode + Stamina (late update). Two playable classes (Knight and Rogue) each have unique stat profiles, 2–3 stage attack combos, two abilities with cooldowns and cast durations, and stamina pools. Two game modes are available: Deathmatch (kill-limit with respawns after 5 s) and Last Standing (elimination — last alive wins). The frontend provides a full lobby system with character selection, ready-up countdown, an in-game HUD (health/stamina/cooldown bars), and a game-end leaderboard showing placement, kills, deaths, and damage stats.

---

### Module 5 — Remote players

_Gaming Major (2 pts) — by kwurster (backend) and asplavnic (game backend and frontend)_

Players connect from separate browsers on separate computers and play over the network in real time, with the server acting as the authoritative relay and game state manager.

**Implementation:** Each player establishes a WebTransport connection and joins a lobby via REST API. On game start, the server opens a bidirectional game stream per player. The client sends `GameClientMessage` (input state) at any rate; the server applies inputs immediately and broadcasts `GameServerMessage` (snapshots + network events) to all connected players at 60 Hz. Disconnection is handled via `on_disconnect` hooks — the stream cancellation is tracked and a background cleanup task prevents ghost players. The `StreamGroup` broadcast model ensures one slow client does not stall others (backpressure cancellation).

---

### Module 6 — ORM with Diesel and SQLite

_Web Minor (1 pt) — by kwurster with drongier (avatar DB integration)_

All database access goes through **Diesel**, a compile-time type-checked ORM for Rust. Diesel's schema macro generates Rust types from the SQL schema; query builder calls that do not type-check fail at compile time, not at runtime.

**Implementation:** Schema defined in `backend/src/schema.rs` (auto-generated by `diesel print-schema`). Migrations in `backend/migrations/` cover all six tables. Connection pooling via `r2d2`. No raw SQL in application code.

---

### Module 7 — Two-Factor Authentication (TOTP)

_User Management Minor (1 pt) — by kwurster (backend) and lmeubrin (frontend)_

Users can optionally enable TOTP-based 2FA. Once enabled, every login and session reauth requires a valid 6-digit TOTP code (or a single-use recovery code). 2FA protects the account even if the password is compromised.

**Implementation:** Enrollment is a two-step flow: `POST /api/user/2fa/start` (returns QR code and base32 secret), then `POST /api/user/2fa/confirm` (verifies a code and returns recovery codes once). The TOTP secret is AES-encrypted at rest (`TOTP_ENC_KEY` env var). Recovery codes are stored as BLAKE3 hashes and invalidated after use. The frontend `TwoFactorAuthModal` guides the user through enrollment; `TwoFactorLoginModal` handles the code prompt at login.

---

### Module 8 — Custom Minor: Session Management

_Modules of choice Minor (1 pt) — by lmeubrin (frontend) and kwurster (backend)_

In a competitive gaming platform, account security matters. This module gives users full visibility and control over their active sessions: where they are logged in, on what device, from what IP, and since when.

**Justification:** Session management is a recognised OWASP best practice (OWASP ASVS Session Management). It directly addresses unauthorized access threats — a compromised password is much less damaging if the victim can spot and kill the rogue session immediately. It also aligns with GDPR's principle of data subject control. No existing ft_transcendence module covers this.

**Implementation:** Password-gated access to session data (password is kept in a hidden ref to avoid re-prompting for each action). Three distinct revocation modes: deauth selected sessions, deauth all others, hard-delete records. All destructive operations additionally require the MFA code when 2FA is active. The frontend minimises user friction by not clearing the MFA field between operations so the user can reuse a valid TOTP code within its 30-second window. The backend enforces rolling (7-day) and absolute (30-day) reauth policies.

---

### Module 9 — Custom Minor: Audio System

_Modules of choice Minor (1 pt) — by drongier_

In a competitive multiplayer fighting game, audio is not cosmetic: it is core gameplay feedback. This module introduces a dedicated sound system that covers local responsiveness, remote synchronization, and 3D spatial perception. Players hear immediate feedback for their own actions, positional cues for opponents, and consistent mix behavior across UI, menu, and in-game contexts.

**Justification:** Real time game audio design follows established middleware principles (FMOD/Wwise): event-driven playback, sound banks, mixer buses, and separation between gameplay state and audio rendering. This module addresses practical gameplay risks (audio spam, repetitive fatigue, desynced feedback) while improving accessibility and game readability. No standard module in ft_transcendence provides this end-to-end architecture.

**Implementation:** The frontend uses a shared Babylon `AudioEngineV2` stack with routed buses (`master`, `sfx`, `music`, `music_ingame`, `ambient`, `ui`), a preloaded `SoundBank`, and declarative trigger tables for local input, remote snapshot deltas, and server events. Audio settings are persisted in local storage with validation and legacy migration support. Local jump/attack spam was mitigated by moving critical triggers away from raw key presses to animation/gameplay events, ensuring one-shot playback at the right moment. The backend integration relies on authoritative game events and stream delivery so every client receives consistent combat/audio outcomes while preserving immediate local feedback where needed.

---

### Module 10 — Complete Accessibility Compliance (WCAG 2.1 AA)

_Accessibility and Internationalization Major (2 pts) — by lmeubrin_

All non-game UI conforms to WCAG 2.1 Level AA, providing full screen reader support, keyboard navigation, and assistive technology compatibility. The 3D game canvas is a real-time visual-spatial sensory experience and falls under the WCAG SC 1.1.1 sensory experience exemption; it carries a descriptive `aria-label` identifying its nature.
This has been tested manually by just tabbing through the interface and using a screen reader (e.g. NVDA) to verify that all interactive elements are announced properly and that the user can navigate and operate the UI without a mouse. Automated tools like Lighthouse can also be used for an initial audit (Ctrl+Shift+I → Lighthouse → Accessibility).

**What was implemented:**

- **Keyboard navigation:** `Dropdown` component implements the full ARIA menu pattern — Arrow Up/Down navigate items, Home/End jump to first/last, Tab closes the menu. `Modal` traps Tab/Shift+Tab within its boundary and restores focus to the trigger element on close.
- **Skip link:** Visually hidden "Skip to main content" link (first focusable element in the page) targets `<div id="main-content" tabIndex={-1}>` in `AppRoutes`, enabling keyboard users to bypass navigation on every page.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables all CSS animations and transitions for users who have enabled this OS-level accessibility preference. Affects dropdown entrance, toast slide, button transitions, and the loading spinner.
- **ARIA landmarks:** Each route component (`Home`, `AuthPage`, `SessionManagement`, `PrivacyPolicy`, `TermsOfService`) owns its own `<main>` landmark, keeping exactly one `<main>` per page regardless of active route. The `<div id="main-content">` wrapper in `AppRoutes` is intentionally a `<div>` (not `<main>`) to avoid nested main landmarks. `<footer role="contentinfo">` marks the footer.
- **Form accessibility:** All inputs use the Input component's built-in `aria-invalid`, `aria-describedby`, and `role="alert"` error pattern. The description textarea in `EditUserModal` gained `aria-invalid` and is linked to its error message via `aria-describedby`. Character count uses `aria-live="polite"`.
- **Descriptive labels:** Session checkboxes now include device name in `aria-label`. Notification action buttons have context-bearing labels instead of the generic "Open". Decorative SVG icons are marked `aria-hidden="true"`.
- **Focus management:** Modal auto-focuses the first element (respecting `autoFocus` on inputs), stores the previously focused element, and restores it on close. Focus is never lost after any interactive action.
- **Game canvas:** `aria-label="Real-time 3D multiplayer arena game — requires visual interaction"` on the Babylon.js canvas satisfies WCAG SC 1.1.1 for the sensory experience exception.
- **Colour contrast (WCAG 1.4.3):** A dedicated palette step `stone-350` (#8d8177, 4.59:1 on stone-900) was added for de-emphasised text that sits directly on the page background. All text inside Cards and Modals (stone-800 background) uses `stone-300` (5.2:1). Both ratios clear the 4.5:1 AA threshold for normal text.

**Known Lighthouse flags (accepted exemptions)**

**Placeholder text contrast** — `placeholder-stone-500` (#706058) renders at 3.0:1 on stone-909 backgrounds. Lighthouse flags this via axe-core's `color-contrast` rule. Under **WCAG 2.1 SC 1.4.3**, placeholder text qualifies as an _"inactive user interface component"_ and is explicitly exempt from the 4.5:1 contrast requirement. WCAG 2.2 added a clarifying note confirming this interpretation. The lower contrast is intentional: placeholder should be visually distinct from actual user input (`text-stone-100`, 13:1 contrast), so users can tell the difference at a glance between empty and filled fields.

---

### Module 11 — Multiplayer 3+ players

_Gaming Major (2 pts) — by kwurster (backend) and asplavnic (game engine)_

The game supports 2–8 simultaneous players in a single match, extending beyond the standard 1v1 format into free-for-all arenas.

**Implementation:** The C++ game engine defines `min_players() = 2` and `max_players() = 8`. The lobby system enforces these bounds on join. Player spawn positions are calculated in an evenly-spaced circle pattern (`SpawnPositions` helper) to ensure fair starting positions regardless of player count. The 60 Hz game loop processes inputs from all connected players each tick, and the `StreamGroup` broadcasts the authoritative `GameStateSnapshot` (containing all `CharacterSnapshot` entries) to every player and spectator simultaneously. Both game modes (Deathmatch and Last Standing) track per-player kills, deaths, and ranking across the full participant set.

---

### Module 12 — Spectator mode

_Gaming Minor (1 pt) — by lmeubrin_

Users can watch ongoing matches without participating. Spectators see the full game state in real time but cannot send input or affect gameplay.

**Implementation:** A dedicated `POST /api/game/lobby/{id}/spectate` endpoint joins a user as a spectator (distinct from a player). Spectators receive game state via a uni-directional stream (server → client only); the `GameContext` detects spectator status and gates `sendInput()`. The `InGameGuard` route protection prevents spectators from navigating to `/game` — they remain on the lobby view with a "Game in progress" badge. Spectator count is displayed in the lobby UI. Spectators can leave via the standard `POST /api/game/lobby/{id}/leave` endpoint.

---

### Module 13 — Custom design system

_Web Minor (1 pt) — by lmeubrin with drongier

A unified visual design system with 17+ reusable components, a custom colour palette, consistent typography, and iconography — giving the application a cohesive dungeon-game aesthetic rather than a generic bootstrap look.

**Justification:** The subject requires "a proper color palette, typography, and icons (minimum: 10 reusable components)." Our system exceeds this with 17+ exported components.

**Implementation:** All components are exported from `frontend/src/components/ui/index.ts`: `Button`, `Card`, `Modal`, `Input`, `Alert`, `Badge`, `InfoBlock`, `ErrorBanner`, `LoadingSpinner`, `Layout`, `Dropdown` (with `DropdownItem`, `DropdownSeparator`), `ModelPreview`, `CharacterPicker`, `PlayerAvatarRow`, `ChampionGrid`, `CharacterStats`, and `CharacterSelector`. The colour palette is derived from the KayKit dungeon texture (`stone-*` neutrals, `gold-*` primary, semantic colours for danger/success/warning/info, `accent-*` for game elements). Three font families: Fredoka (display headings), Nunito Sans (body text), JetBrains Mono (code). Icons via Lucide React. All interactive elements carry ARIA labels for accessibility.

---

### Module 14 — Standard user management and authentication

_User Management Major (2 pts) — by drongier (profile, avatar, friends frontend), kwurster (friends backend, online status)_

Beyond the mandatory sign-up and login, this module provides a complete user management layer: editable profiles, avatars, a friends system with online status, and profile viewing.

**Implementation:**
- **Profile editing:** `EditUserModal` allows users to change their nickname and description.
- **Avatar upload:** Client-side image conversion to AVIF at two sizes (450x450, 200x200). Backend validates format, dimensions, size limits. Default AVIF avatar embedded in binary via `include_bytes!`. Small avatars LRU-cached in memory (1000 entries). HTTP `ETag` caching.
- **Friends system:** Full CRUD in `backend/src/friends/` — send, accept, reject, cancel, remove. Frontend `FriendsDrawer` shows friends list, incoming requests (with counter badge), and pending outgoing requests. Comprehensive backend test suite.
- **Online status:** `StreamManager::is_connected(user_id)` checks whether the user has an active WebTransport connection. Frontend displays green (online) or gray (offline) dot indicator in friends drawer and `PublicProfileModal`.
- **Profile page:** `PublicProfileModal` displays avatar, nickname, online/offline status, bio, and "member since" date for any user. Accessible from the friends list.

---

### Module 15 — Game customization options

_Gaming Minor (1 pt) — by asplavnic (game engine, modes) and kwurster (lobby settings backend)_

Players and hosts can customise their gameplay experience through character selection, game mode choice, and lobby settings.

**Implementation:**
- **Abilities and attacks:** Two playable classes (Knight and Rogue) with fundamentally different playstyles. Each has a multi-stage attack combo (Knight: 3 stages, Rogue: 2 stages), two unique abilities with cooldowns and cast durations, and distinct stat profiles (attack, defense, speed, health on a 1–10 scale). Stamina pools and costs differ per class.
- **Game modes as themes:** Deathmatch (kill-limit with 5 s respawn — aggressive, fast-paced) and Last Standing (elimination, no respawns — cautious, high-stakes) provide fundamentally different gameplay experiences with distinct win conditions, respawn logic, and ranking strategies.
- **Customisable game settings:** The lobby host can set the lobby name, toggle public/private visibility, and select the game mode via `PATCH /api/game/lobby/{id}/settings`. Each player independently selects their character class.
- **Default options:** Knight is the default character class. Lobby defaults to public. Game mode must be explicitly chosen by the host (the UI prevents readying without a mode selected) as a design choice.

---

### Module 16 — Notification system

_Web Minor (1 pt) — by kwurster (backend) and lmeubrin (frontend toast UI)_

A real-time notification system that pushes events to users over WebTransport, with offline persistence for missed notifications and a toast UI for visual feedback.

**Implementation:** The backend defines 5 notification types in `NotificationPayload`: `FriendRequestReceived`, `FriendRequestAccepted`, `FriendRequestRejected`, `FriendRequestCancelled`, and `FriendRemoved` — covering all friend-related creation, update, and deletion actions. If the user has a live WebTransport stream, the notification is delivered immediately (zero DB latency). If the user is offline, it is persisted to the `notifications` table (CBOR-encoded) and drained on reconnect with at-least-once delivery. The frontend `NotificationToast` component supports stacking (up to 2 individual cards, then visual stack), slide-out dismiss animation, sound effects via `useUIAudio()`, and click-through actions (e.g., opening the friends drawer). The `NotificationContext` handles stream registration, async display-text resolution (resolves user IDs to nicknames), and FIFO queue ordering.

---

### Module 17 — User interaction (chat, friends, profiles)

_Web Major (2 pts) — in progress_

A social layer alongside the game: user profile pages, a friends system (add/remove), and direct messaging.

**Status:** Friends system and profile viewing are fully implemented. **Chat is not yet implemented** — this is the remaining requirement before this module can be claimed.

**What is done:**
- **Friends system** (kwurster backend, drongier frontend): Full CRUD — send, accept, reject, cancel, remove. Real-time online status via WebTransport connection presence. `FriendsDrawer` with incoming/outgoing request sections.
- **Profile system** (drongier): `PublicProfileModal` displays avatar, nickname, online status, bio, and join date. Triggered from friends list.

**What is missing:**
- A basic chat system (send/receive messages between users).

---

### Module 18 — Gamification system

_Web Minor (1 pt) — by kwurster(backend) and drongier(backend & frontend)_

A persistent gamification layer that rewards user actions, tracks long-term progression, and gives players immediate and understandable feedback.

**Implementation:**
- **Achievements:** Achievement definitions are stored in the `achievements` table and per-user progress/unlock state in `user_achievements` (bronze/silver/gold tiers with thresholds).
- **XP / level progression:** User progression is stored in `user_stats` (`xp`, `level`, win/loss streaks, combat totals). XP gain is computed through explicit reward rules and level is recalculated from total XP.
- **Rewards mechanics:** Achievement tier unlocks grant XP rewards, which are immediately merged into the player progression state.
- **Persistent by design:** All progression and unlock data is database-backed and survives reconnects/restarts (Diesel models + migrations).
- **Visual feedback:** Newly unlocked achievement tiers emit real-time notifications and progression metrics (`xp_in_level`, `xp_to_next`, `progress_percent`) are exposed for frontend progress bars and UI indicators.
- **Clear progression rules:** Unlock tiers are threshold-based, XP rewards are deterministic, and progression formulas are centralized in the backend (`gamification/xp.rs` and achievements checks), making behavior predictable and auditable.

---

## Individual Contributions

### kwurster

- Tech Lead responsibilities: overall technical direction, architecture decisions, security best practices, code review
- Entire Rust backend architecture: Salvo routing, middleware hoops, async request lifecycle
- Auth system: registration, login, two-token model (JWT + session token), BLAKE3 hashing, Argon2id passwords
- Session management backend: all endpoints, rolling/absolute reauth policy, deauth vs delete semantics
- Two-factor authentication backend: TOTP enrollment, encrypted secret storage, recovery code hashing
- Diesel ORM integration: schema, models, migration files
- Rate limiting: IP-based and user-based quota hoops on all public and authenticated routes
- WebTransport backend: `/api/wt` endpoint, `stream_manager`, per-user stream lifecycle, `StreamGroup` broadcast model
- Game server backend integration: CXX FFI bridge to C++ engine, `GameManager` singleton, lobby management (create/join/leave/ready/settings), 60 Hz game loop hosting on dedicated OS thread, disconnect handling
- Friends backend: full CRUD endpoints (send/accept/reject/cancel/remove/list), online status via `StreamManager::is_connected()`, comprehensive test suite
- Notification system: `notifications` table, CBOR-encoded `NotificationPayload` enum (5 friend event types + `ServerHello`), real-time delivery + offline persistence
- Frontend WebTransport: codec `CompressedCborCodec.ts` (CBOR + zstd) and Stream manager
- Backend CI/CD pipeline
- GDPR backend: account deletion (pseudo-anonymization), data export, three-phase token flow, email confirmation endpoints, 56 integration tests
- Full backend test infrastructure: mock server, `ApiClient`, `User` typestate, test conventions

### asplavnic

- Product ownership: game design, mechanic definitions, feature prioritisation
- Privacy Policy page (PR #105): content covering data collection, cookies, user rights
- Terms of Service page (PR #105): acceptable use policy, account rules
- C++ game engine (entt ECS): 6 systems across 4 phases — CharacterController, Physics, Collision, Combat, GameMode, Stamina
- Game modes: Deathmatch (kill-limit, respawns) and Last Standing (elimination)
- Combat system: attack chains (2–3 stages per class), 2 abilities per class, stamina pools, critical hits, knockback
- Character presets: Knight and Rogue with distinct stat profiles
- Babylon.js 3D scene: isometric camera, Forest arena, character animations, weapon swing trails, bone-attached equipment
- Frontend game client: lobby UI with character selection and ready-up, in-game HUD (health/stamina/cooldown bars, enemy health bars)
- CXX FFI bridge interface: `GameHandle` methods for start, update, add/remove player, input, snapshot, and network events

### lmeubrin

- Project Manager responsibilities: team coordination, meeting facilitation, timeline management, review leadership
- Frontend architecture: React Router setup, `AppRoutes.tsx`, `AuthContext.tsx`
- Route guards: `ProtectedRoute` and `PublicRoute` components
- JWT refresh: proactive (`useJwtRefresh` hook) and reactive (Axios interceptor) mechanisms
- Two-factor authentication frontend: `TwoFactorAuthModal`, `TwoFactorLoginModal`, `ReauthModal`
- Session management page: full UI over all session management backend endpoints
- Landing page: `LandingPage.tsx` and animated `LandingScene.tsx`
- Design system: 17+ UI components (`Button`, `Card`, `Modal`, `Input`, `Alert`, `Badge`, `Dropdown`, `InfoBlock`, `ErrorBanner`, `LoadingSpinner`, `Layout`, `ModelPreview`, `CharacterPicker`, `PlayerAvatarRow`, `ChampionGrid`, `CharacterStats`, `CharacterSelector`), stone/gold/dungeon theme, full Tailwind custom config
- Character rendering UI components: `CharacterSelector`, `CharacterPicker`, `PlayerAvatarRow`, `ChampionGrid`, `CharacterStats`
- Spectator mode: `spectateLobby()` API integration, `InGameGuard` route protection, spectator detection in `GameContext`
- Error system: `storeError` / `retrieveStoredError` pattern, `ErrorBanner` component
- GDPR frontend: Privacy & Data modal with account deletion and data export flows, nickname confirmation for deletion, WCAG-compliant step-based UI
- Frontend CI/CD pipeline
- WCAG 2.1 AA accessibility compliance (Module 11): Dropdown keyboard navigation, Modal focus trap and focus restoration, skip link, `prefers-reduced-motion` support, ARIA landmarks, descriptive labels, game canvas text alternative

### drongier

- Avatar system end-to-end:
  - Backend: AVIF validation, two-size storage, `quick_cache` LRU for small avatars, ETag caching, default avatar embedding
  - Frontend: image crop/resize/AVIF conversion, upload flow, avatar display components
- Profile editing: `EditUserModal` for nickname and description changes
- User description field: backend migration + frontend display/edit
- Friends frontend: `FriendsDrawer` (friends list, incoming/outgoing request sections with counter badges), `AddFriendForm`, online status display (green/gray dot), `PublicProfileModal`
- WCAG 2.1 AA accessibility compliance while working on the frontend
- Audio architecture: designed and implemented the in-game audio stack (Babylon `AudioEngineV2` buses, shared `SoundBank`, trigger-table-driven playback for local/remote/game events)
- Sound design: tuned combat/movement feedback, cooldown anti-spam behavior, and overall mix balance for clearer, more readable gameplay audio
- 3D engine contributions: audio integration for the game engine, minor 3D engine fixes
- Gamification : integrated progression and achievement for user

---

## Resources

### External references

| Resource | URL | Purpose |
|----------|-----|---------|
| Salvo documentation | <https://salvo.rs/book> | Rust web framework reference |
| Diesel ORM guide | <https://diesel.rs/guides> | ORM patterns and migration workflow |
| Babylon.js documentation | <https://doc.babylonjs.com> | 3D engine API reference |
| WebTransport API (MDN) | <https://developer.mozilla.org/en-US/docs/Web/API/WebTransport> | Browser WebTransport API |
| WebTransport spec (W3C) | <https://www.w3.org/TR/webtransport/> | Protocol specification |
| OWASP Session Management | <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html> | Security guidance for session design |
| Argon2 RFC | <https://datatracker.ietf.org/doc/rfc9106/> | Password hashing specification |
| TOTP RFC 6238 | <https://datatracker.ietf.org/doc/html/rfc6238> | Time-based OTP specification |
| AVIF spec | <https://aomediacodec.github.io/av1-avif/> | Image format used for avatars |
| WCAG 2.1 specification | <https://www.w3.org/TR/WCAG21/> | Web Content Accessibility Guidelines |
| ARIA authoring practices | <https://www.w3.org/WAI/ARIA/apg/> | ARIA patterns for menus, dialogs, widgets |

### Internal documentation

| Document | Path | Contents |
|----------|------|----------|
| Backend auth | [docs/backend-auth.md](docs/backend-auth.md) | Full auth architecture, token model, endpoints, threat model |
| Avatar backend | [docs/avatar-backend.md](docs/avatar-backend.md) | Avatar system architecture, validation rules, caching strategy |
| Frontend | [docs/frontend.md](docs/frontend.md) | Frontend stack, design system, auth flow, JWT refresh |
| Game | [docs/game.md](docs/game.md) | Game architecture, engine design, lobby system, and gameplay mechanics |
| Audio engine | [docs/audio_engine.md](docs/audio_system.md) | Audio architecture, bus routing, triggers, and sound system behavior |
| Friends | [docs/friends.md](docs/friends.md) | Friends system design and API contract |
| Spectator mode | [docs/spectator-mode.md](docs/spectator-mode.md) | Spectator system design, API, and stream architecture |
| Streaming architecture | [docs/streaming-architecture.md](docs/streaming-architecture.md) | WebTransport stream types, connection lifecycle, broadcast model |
| 2FA frontend | [docs/frontend-2fa.md](docs/frontend-2fa.md) | 2FA modal components and enrollment flow |
| Session management | [docs/session-management.md](docs/session-management.md) | Session management page design and backend contract |
| TODO | [docs/todo.md](docs/todo.md) | What still needs to be done before evaluation |

### AI usage

AI assistants were used throughout the project for:

- **Code review and debugging** — every pull request was reviewed by AI as well as at least one human reviewer. AI was used to write most frontend tests and identify bugs and edge cases in the auth flows and everywhere else. It was also used to discuss the architecture and design of the backend logic.
- **Documentation drafting** — initial drafts of `docs/backend-auth.md`, `docs/avatar-backend.md`, and this README were written with AI assistance and then reviewed and corrected by the team.
- **Design decisions** — discussing trade-offs for session token storage, avatar caching strategies, and WebTransport vs WebSocket.
- **Test infrastructure** — the backend mock server and typestate-based test helpers were developed with AI pair-programming.
- **Frontend patterns** — the proactive JWT refresh hook design and the ref-based sensitive-data pattern in 2FA modals were refined through AI discussion.

All AI-generated content was reviewed, corrected where wrong, and ultimately owned by the team member responsible for the area.
