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

**Key features:**

- Secure registration and login with Argon2id password hashing
- Optional TOTP two-factor authentication with recovery codes
- Full session management: view all active sessions, revoke them remotely, and change passwords — all MFA-protected
- Profile system with custom avatars (AVIF format, client-side conversion)
- Real-time communication layer over WebTransport (HTTP/3) for game events and notifications
- 3D fighting game with Babylon.js rendering (in active development on feature branch)
- Privacy Policy and Terms of Service pages
- Complete HTTPS everywhere via Salvo + Rustls

The game itself — character selection, the fighting arena, and the entity system — is in active development on a feature branch and will be merged before evaluation.

---

## Team Information

| Login | GitHub | Role |
|-------|--------|------|
| kwurster | [@kjzl](https://github.com/kjzl) | Tech Lead, Backend Engineer |
| asplavnic | [@AntonSplavnik](https://github.com/AntonSplavnik) | Product Owner, Game Developer |
| lmeubrin | [@Moat423](https://github.com/Moat423) | Project Manager, Frontend Engineer |
| drongier | [@drongier](https://github.com/drongier) | Full-stack Developer, DevOps |

**kwurster** designed and built the entire Rust backend: auth system, 2FA, Diesel ORM with SQLite migrations, rate limiting, the WebTransport `stream_manager`, notification infrastructure, and the full test suite. He also wrote the CI/CD pipeline for the backend and the frontend WebTransport codec (`CompressedCborCodec.ts`).

**asplavnic** defined the game vision and mechanics as product owner. He built the Privacy Policy and Terms of Service pages and is developing the complete game on a feature branch: server-side validation, the Babylon.js scene, the entity system, and the full fighting game logic.

**lmeubrin** architected the frontend: React Router setup, `AuthContext`, route guards, JWT refresh (both proactive timer-based and reactive Axios interceptor), 2FA frontend modals, the session management page, and the landing page (`LandingPage.tsx` + `LandingScene.tsx`). She also built the design system (11 UI components) and the frontend CI/CD pipeline.

**drongier** owns the avatar system end-to-end: backend validation, caching, and router; frontend upload flow, client-side AVIF conversion, display, and ETag caching; and the profile editing modal (`EditUserModal`). He is also working on the sound system (in progress, not yet merged).

---

## Project Management

The team used GitHub for all collaboration:

- **Issues and pull requests** for task tracking and code review — every feature went through a PR with at least one review before merge.
- **Discord** as the primary communication channel for daily coordination.
- **Notion** for shared notes, game design documents, and sprint planning.

Work was distributed by area of ownership: kwurster held the backend, lmeubrin held the frontend architecture and design, asplavnic drove game direction and is building the game branch, and drongier covered avatar/profile and deployment infrastructure.

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

The backend requires a TLS certificate to serve HTTPS and WebTransport. For local development, generate a self-signed certificate with `mkcert`:

```sh
# Install mkcert CA into your system trust store (once)
mkcert -install

# Generate cert + key for localhost
mkcert -key-file backend/key.pem -cert-file backend/cert.pem localhost 127.0.0.1
```

Place `cert.pem` and `key.pem` in `backend/`. The backend looks for them there on startup.

### Running

**Development** (backend + frontend separately, with hot reload):

```sh
# Terminal 1 — backend
cd backend && cargo run

# Terminal 2 — frontend (proxies API to https://127.0.0.1:8443)
cd frontend && npm install && npm run dev
```

Access the app at `https://localhost:5173` (Vite dev server) or the backend directly at `https://127.0.0.1:8443`.

**Shortcut** (both in one command, from `frontend/`):

```sh
cd frontend && npm run all
```

**Production build** (frontend served as static files from the backend):

```sh
cd frontend && npm run build
cd backend && cargo run
```

The Rust binary serves the compiled `dist/` folder as well as all API routes.

**Backend tests:**

```sh
cd backend && cargo test
```

**Clean:**

```sh
cd frontend && rm -rf node_modules dist
cd backend && cargo clean
```

> **Note:** Docker deployment is planned but not yet implemented. See [docs/todo.md](docs/todo.md).

---

## Technical Stack

### Frontend

| Technology | Role | Why |
|------------|------|-----|
| React 18 | UI framework | Component model, large ecosystem, composable with 3D canvas |
| Vite + SWC | Build tool | Instant hot reload; SWC compiler is written in Rust |
| TypeScript | Language | Static types catch errors early, essential for complex auth + game state |
| Tailwind CSS | Styling | Utility-first, custom theme (stone + gold palette), no CSS file context-switching |
| Babylon.js | 3D engine | Browser-native WebGL game engine; handles scene, physics, camera, and assets |
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
| `data` | BLOB | AVIF image at 450x450 px, max 20 KB |
| `updated_at` | TIMESTAMP | |

### `avatars_small`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | INTEGER PK FK | References `users(id)` ON DELETE CASCADE |
| `data` | BLOB | AVIF image at 200x200 px, max 8 KB; LRU-cached in memory |
| `updated_at` | TIMESTAMP | |

### `notifications`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | INTEGER FK | References `users(id)` ON DELETE CASCADE |
| `data` | BLOB | CBOR-encoded `Notification` enum value |
| `created_at` | DATETIME | |

### Relationships summary

- One user has many sessions (cascade delete).
- One user has many recovery codes (cascade delete).
- One user has at most one large avatar and one small avatar (cascade delete).
- One user has many notifications (cascade delete).
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
| User description | kwurster (backend), drongier (frontend) | Free-text bio field on user profile. |

### Real-time & Game

| Feature | By | Description |
|---------|-----|-------------|
| WebTransport connection | kwurster | HTTP/3 persistent connection. `stream_manager` in backend manages per-session bidirectional streams. |
| CBOR codec | kwurster | `CompressedCborCodec.ts` on the frontend encodes/decodes binary messages with zstd compression. |
| Notifications | kwurster | Server push of `Notification` enum values over WebTransport. Initial `ServerHello` on connect. |
| Babylon.js scene | asplavnic | 3D rendering with scene setup, lighting, camera controls (game branch, not yet merged). |
| Entity system | asplavnic | Component-based entity model for characters and game objects (game branch). |
| Fighting game logic | asplavnic | 1v1 character-based combat with server-side validation (game branch). |

### UI/UX

| Feature | By | Description |
|---------|-----|-------------|
| Design system | lmeubrin | 11 reusable components (`Button`, `Card`, `Modal`, `Input`, `Alert`, `Badge`, `Dropdown`, `InfoBlock`, `ErrorBanner`, `LoadingSpinner`, `Layout`). Stone/gold/dungeon theme. |
| Landing page | lmeubrin | `LandingPage.tsx` with animated `LandingScene.tsx`. Entry point before auth. |
| Route guards | lmeubrin | `ProtectedRoute` / `PublicRoute` wrap all routes; unauthenticated users redirect to `/auth`, authenticated users redirect to `/home`. |
| Error banner | lmeubrin | Fixed-position auto-dismiss banner for cross-page error messages (stored in `localStorage` between redirects). |
| Privacy Policy | asplavnic | Accessible from footer; covers data collection, cookies, and user rights. |
| Terms of Service | asplavnic | Accessible from footer; covers acceptable use and account rules. |
| Sound system | drongier | In progress; not yet merged. |

---

## Modules

### Summary

| # | Module | Type | Points | Status |
|---|--------|------|--------|--------|
| 1 | Frontend + backend frameworks (React + Salvo) | Web Major | 2 | Done |
| 2 | Real-time features via WebTransport HTTP/3 | Web Major | 2 | Done |
| 3 | Advanced 3D graphics — Babylon.js | Gaming Major | 2 | In progress |
| 4 | Complete web-based game (1v1 fighter) | Gaming Major | 2 | In progress |
| 5 | Remote players | Gaming Major | 2 | Planned |
| 6 | User interaction — chat, friends, profiles | Web Major | 2 | Planned |
| 7 | ORM — Diesel + SQLite | Web Minor | 1 | Done |
| 8 | Two-Factor Authentication (TOTP) | User Mgmt Minor | 1 | Done |
| 9 | File upload/management — avatar system | Web Minor | 1 | Done |
| 10 | Custom: Session Management | Modules of choice Minor | 1 | Done |
| | **Confirmed (modules 1, 2, 7, 8, 9, 10)** | | **8** | |
| | **When modules 3–6 complete** | | **16** | Exceeds 14-point target |

---

### Module 1 — Frontend and backend frameworks

_Web Major (2 pts) — by lmeubrin (frontend) and kwurster (backend)_

The subject allows replacing the default vanilla JS frontend and the default backend with framework-based alternatives. We use **React** (with Vite, TypeScript, and Tailwind CSS) on the frontend and **Salvo** (a Rust async web framework) on the backend.

**Why React:** Component model maps naturally onto a game UI with distinct panels (auth, profile, game canvas, session management). React's virtual DOM and context API make state management across auth flows and JWT refresh tractable.

**Why Salvo:** Salvo is one of the few Rust web frameworks with first-class WebTransport support. Its "hoop" middleware model is composable and makes route-level authentication, rate limiting, and request enrichment declarative.

**Implementation:** The frontend lives in `frontend/` (React + Vite + TypeScript + Tailwind). The backend lives in `backend/` (Rust + Salvo + Diesel). The Vite dev proxy forwards `/api/*` to the backend during development; in production the backend serves the compiled `dist/` folder.

---

### Module 2 — Real-time features via WebTransport HTTP/3

_Web Major (2 pts) — by kwurster (backend) and asplavnic (game frontend)_

WebTransport (HTTP/3) replaces conventional WebSocket for all real-time game and notification traffic. Unlike WebSockets, WebTransport supports multiple independent bidirectional streams within one connection, does not have head-of-line blocking, and runs over QUIC.

**Why WebTransport over WebSocket:** Game events for different entities can be sent on independent streams; a dropped packet for one stream does not stall others. QUIC's connection migration also handles mobile network handoffs more gracefully.

**Implementation:** The Rust backend exposes `/api/wt` as a WebTransport endpoint (gated by `requires_user_login()`). The `stream_manager` module manages per-user stream lifecycle. The frontend `CompressedCborCodec.ts` encodes messages as CBOR with zstd compression before sending. On connect, the server sends a `ServerHello` notification to confirm the session is live.

---

### Module 3 — Advanced 3D graphics with Babylon.js

_Gaming Major (2 pts) — by asplavnic_

The game arena is rendered in 3D using **Babylon.js**, a full-featured browser game engine built on WebGL. Babylon handles the scene graph, lighting, camera, mesh loading, physics, and the render loop — allowing us to build a visually rich arena without writing raw WebGL.

**Why Babylon.js over Three.js:** Babylon.js is purpose-built for games (built-in physics, animation system, collision detection, asset manager) rather than general 3D visualisation. It also has strong TypeScript support.

**Implementation:** The Babylon scene is wrapped in a React component that uses `useRef` for the `<canvas>` element and `useEffect` for engine lifecycle. Per-frame updates stay inside Babylon's `requestAnimationFrame` loop to avoid triggering React re-renders on every frame. Scene, camera, lights, and entities are managed entirely within the Babylon context. (Game branch — pending merge.)

---

### Module 4 — Complete web-based game (1v1 fighter)

_Gaming Major (2 pts) — by asplavnic (game) and kwurster (WebTransport backend)_

The core deliverable is a fully playable 1v1 character-based fighting game running in the browser. Players pick a character, enter a match, and fight in real time. The server holds authoritative game state.

**Why a fighting game:** A fighting game is a natural fit for WebTransport's low-latency bidirectional streams. Client sends inputs; server validates, updates state, and broadcasts to all players in the match. This cleanly demonstrates the real-time module.

**Implementation:** Character selection, match lobby, combat logic, hit detection, and win conditions are all implemented on the game branch. Server-side validation ensures clients cannot cheat by sending fraudulent state. (Game branch — pending merge.)

---

### Module 5 — Remote players

_Gaming Major (2 pts) — by kwurster and asplavnic_

Both players connect from separate browsers and play over the network in real time, with the server acting as the authoritative relay and game state manager.

**Implementation:** Requires Module 4. The `stream_manager` already supports multiple concurrent WebTransport sessions. Match sessions are identified server-side; inputs from both players are processed each tick, and the updated game state is broadcast to both connections. (Planned — requires game branch merge.)

---

### Module 6 — User interaction (chat, friends, profiles)

_Web Major (2 pts) — planned_

A social layer alongside the game: user profile pages, a friends system (add/remove/block), direct messaging, and in-game match invitations.

**Implementation:** Planned. Will use existing user infrastructure (auth, avatars, WebTransport notifications). Profile pages will display avatar, nickname, description, and match history. Direct messages and presence updates will travel over the existing WebTransport connection.

---

### Module 7 — ORM with Diesel and SQLite

_Web Minor (1 pt) — by kwurster_

All database access goes through **Diesel**, a compile-time type-checked ORM for Rust. Diesel's schema macro generates Rust types from the SQL schema; query builder calls that do not type-check fail at compile time, not at runtime.

**Implementation:** Schema defined in `backend/src/schema.rs` (auto-generated by `diesel print-schema`). Migrations in `backend/migrations/` cover all six tables. Connection pooling via `r2d2`. No raw SQL in application code.

---

### Module 8 — Two-Factor Authentication (TOTP)

_User Management Minor (1 pt) — by kwurster (backend) and lmeubrin (frontend)_

Users can optionally enable TOTP-based 2FA. Once enabled, every login and session reauth requires a valid 6-digit TOTP code (or a single-use recovery code). 2FA protects the account even if the password is compromised.

**Implementation:** Enrollment is a two-step flow: `POST /api/user/2fa/start` (returns QR code and base32 secret), then `POST /api/user/2fa/confirm` (verifies a code and returns recovery codes once). The TOTP secret is AES-encrypted at rest (`TOTP_ENC_KEY` env var). Recovery codes are stored as BLAKE3 hashes and invalidated after use. The frontend `TwoFactorAuthModal` guides the user through enrollment; `TwoFactorLoginModal` handles the code prompt at login.

---

### Module 9 — File upload and management (avatar system)

_Web Minor (1 pt) — by drongier (full-stack)_

Users can upload a custom avatar. The system stores images in two sizes (450x450 for profile views, 200x200 for lists and game UI) in AVIF format. Client-side conversion and cropping means the backend never runs image processing code — eliminating an entire class of vulnerabilities (ImageMagick-style exploits).

**Implementation:** The frontend upload flow crops the source image to a square, resizes to both dimensions, converts to AVIF, strips the alpha channel, and sends both blobs to `POST /api/avatar`. The backend validates AVIF magic bytes, exact dimensions, size limits, no transparency, and no animation, then stores in `avatars_large` and `avatars_small`. Small avatars are cached in a 1000-entry LRU cache. Responses carry `ETag` headers for browser-level cache validation. Default avatars are embedded in the Rust binary via `include_bytes!`.

---

### Module 10 — Custom Minor: Session Management

_Modules of choice Minor (1 pt) — by lmeubrin (frontend) and kwurster (backend)_

In a competitive gaming platform, account security matters. This module gives users full visibility and control over their active sessions: where they are logged in, on what device, from what IP, and since when.

**Justification:** Session management is a recognised OWASP best practice (OWASP ASVS Session Management). It directly addresses unauthorized access threats — a compromised password is much less damaging if the victim can spot and kill the rogue session immediately. It also aligns with GDPR's principle of data subject control. No existing ft_transcendence module covers this.

**Implementation:** Password-gated access to session data (password is kept in a hidden ref to avoid re-prompting for each action). Three distinct revocation modes: deauth selected sessions, deauth all others, hard-delete records. All destructive operations additionally require the MFA code when 2FA is active. The frontend minimises user friction by not clearing the MFA field between operations so the user can reuse a valid TOTP code within its 30-second window. The backend enforces rolling (7-day) and absolute (30-day) reauth policies.

---

## Individual Contributions

### kwurster

- Entire Rust backend architecture: Salvo routing, middleware hoops, async request lifecycle
- Auth system: registration, login, two-token model (JWT + session token), BLAKE3 hashing, Argon2id passwords
- Session management backend: all endpoints, rolling/absolute reauth policy, deauth vs delete semantics
- Two-factor authentication backend: TOTP enrollment, encrypted secret storage, recovery code hashing
- Diesel ORM integration: schema, models, all six migration files
- Rate limiting: IP-based and user-based quota hoops on all public and authenticated routes
- WebTransport backend: `/api/wt` endpoint, `stream_manager`, per-user stream lifecycle
- Notification system: `notifications` table, CBOR-encoded `Notification` enum, `ServerHello`
- Frontend WebTransport codec: `CompressedCborCodec.ts` (CBOR + zstd)
- Backend CI/CD pipeline
- Full backend test infrastructure: mock server, `ApiClient`, `User` typestate, test conventions

### asplavnic

- Product ownership: game design, mechanic definitions, feature prioritisation
- Privacy Policy page (PR #105): content covering data collection, cookies, user rights
- Terms of Service page (PR #105): acceptable use policy, account rules
- Game branch (not yet merged):
  - Babylon.js scene setup: lighting, camera, mesh management
  - Entity system: component-based architecture for characters and game objects
  - Server-side game validation
  - Full 1v1 fighting game logic: character selection, combat, win conditions

### lmeubrin

- Frontend architecture: React Router setup, `AppRoutes.tsx`, `AuthContext.tsx`
- Route guards: `ProtectedRoute` and `PublicRoute` components
- JWT refresh: proactive (`useJwtRefresh` hook) and reactive (Axios interceptor) mechanisms
- Two-factor authentication frontend: `TwoFactorAuthModal`, `TwoFactorLoginModal`, `ReauthModal`
- Session management page: full UI over all session management backend endpoints
- Landing page: `LandingPage.tsx` and animated `LandingScene.tsx`
- Design system: 11 UI components (`Button`, `Card`, `Modal`, `Input`, `Alert`, `Badge`, `Dropdown`, `InfoBlock`, `ErrorBanner`, `LoadingSpinner`, `Layout`), stone/gold/dungeon theme, full Tailwind custom config
- Error system: `storeError` / `retrieveStoredError` pattern, `ErrorBanner` component
- Frontend CI/CD pipeline

### drongier

- Avatar system end-to-end:
  - Backend: AVIF validation, two-size storage, `quick_cache` LRU for small avatars, ETag caching, default avatar embedding
  - Frontend: image crop/resize/AVIF conversion, upload flow, avatar display components
- Profile editing: `EditUserModal` for nickname and description changes
- User description field: backend migration + frontend display/edit
- Sound system (in progress, not yet merged)

---

## Resources

### External references

| Resource | URL | Purpose |
|----------|-----|---------|
| Salvo documentation | https://salvo.rs/book | Rust web framework reference |
| Diesel ORM guide | https://diesel.rs/guides | ORM patterns and migration workflow |
| Babylon.js documentation | https://doc.babylonjs.com | 3D engine API reference |
| WebTransport API (MDN) | https://developer.mozilla.org/en-US/docs/Web/API/WebTransport | Browser WebTransport API |
| WebTransport spec (W3C) | https://www.w3.org/TR/webtransport/ | Protocol specification |
| OWASP Session Management | https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html | Security guidance for session design |
| Argon2 RFC | https://datatracker.ietf.org/doc/rfc9106/ | Password hashing specification |
| TOTP RFC 6238 | https://datatracker.ietf.org/doc/html/rfc6238 | Time-based OTP specification |
| AVIF spec | https://aomediacodec.github.io/av1-avif/ | Image format used for avatars |

### Internal documentation

| Document | Path | Contents |
|----------|------|----------|
| Backend auth | [docs/backend-auth.md](docs/backend-auth.md) | Full auth architecture, token model, endpoints, threat model |
| Avatar backend | [docs/avatar-backend.md](docs/avatar-backend.md) | Avatar system architecture, validation rules, caching strategy |
| Frontend | [docs/frontend.md](docs/frontend.md) | Frontend stack, design system, auth flow, JWT refresh |
| 2FA frontend | [docs/frontend-2fa.md](docs/frontend-2fa.md) | 2FA modal components and enrollment flow |
| Session management | [docs/session-management.md](docs/session-management.md) | Session management page design and backend contract |
| TODO | [docs/todo.md](docs/todo.md) | What still needs to be done before evaluation |

### AI usage

AI assistants (Claude) were used throughout the project for:

- **Code review and debugging** — understanding cryptic Rust compiler errors, reviewing auth middleware logic, and catching subtle JWT/cookie security issues before they reached production.
- **Documentation drafting** — initial drafts of `docs/backend-auth.md`, `docs/avatar-backend.md`, and this README were written with AI assistance and then reviewed and corrected by the team.
- **Design decisions** — discussing trade-offs for session token storage, avatar caching strategies, and WebTransport vs WebSocket.
- **Test infrastructure** — the backend mock server and typestate-based test helpers were developed with AI pair-programming.
- **Frontend patterns** — the proactive JWT refresh hook design and the ref-based sensitive-data pattern in 2FA modals were refined through AI discussion.

All AI-generated content was reviewed, corrected where wrong, and ultimately owned by the team member responsible for the area.
