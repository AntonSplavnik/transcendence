# What still needs to be done

This document tracks everything that must land before the ft_transcendence evaluation.

---

## Critical — blocks evaluation

### Docker / containerisation (single-command deployment)

**No Docker files exist yet.** The subject requires the entire project to start with a single command using Docker, Podman, or an equivalent containerisation solution.

What is needed:
- `Dockerfile` for the backend (multi-stage: builder with Rust toolchain + minimal runtime image)
- `Dockerfile` for the frontend build step (or bake the frontend build into the backend Dockerfile)
- `docker-compose.yml` (or equivalent) that starts the full stack with one command: `docker compose up`
- TLS certificate handling in the container (either a mounted volume with certs, or a self-signed cert generated at container start)
- Environment variable injection via `docker-compose.yml` or a `.env` file at the project root
- The SQLite database file must persist across container restarts (bind mount or named volume)

**This is the highest-priority remaining item.**

### Complete the game (modules 4 and 5 — 4 pts)

The game branch (`asplavnic`) is not yet merged. Modules 4 (complete game) and 5 (remote players) are worth 4 points combined and are required to hit the 14-point target. The game branch contains:

- Babylon.js scene, lighting, and camera
- Entity system
- Server-side game validation
- Full 1v1 fighting game logic

Action: review, stabilise, and merge the game branch before evaluation.

---

## Module gap analysis

| # | Module | Type | Points | Status |
|---|--------|------|--------|--------|
| 1 | Frontend + backend frameworks | Web Major | 2 | Done |
| 2 | WebTransport HTTP/3 | Web Major | 2 | Done |
| 3 | Advanced 3D graphics (Babylon.js) | Gaming Major | 2 | In progress (game branch) |
| 4 | Complete web-based game (1v1 fighter) | Gaming Major | 2 | In progress (game branch) |
| 5 | Remote players | Gaming Major | 2 | Planned (needs module 4) |
| 6 | User interaction (chat, friends, profiles) | Web Major | 2 | Planned |
| 7 | ORM (Diesel + SQLite) | Web Minor | 1 | Done |
| 8 | Two-Factor Authentication (TOTP) | User Mgmt Minor | 1 | Done |
| 9 | File upload/management (avatar system) | Web Minor | 1 | Done |
| 10 | Custom: Session Management | Modules of choice Minor | 1 | Done |

**Confirmed points now: 8** (modules 1, 2, 7, 8, 9, 10 = 8 pts)
**Target: 14 points**
**Gap: 5 points**

For modules 3, 4, and 5 to be claimable:
- The game branch must be merged and the game must be fully playable in the browser.
- Module 5 requires at least two separate browser sessions fighting each other in real time.
- Module 3 requires the Babylon.js scene to be a meaningful 3D environment (not a placeholder canvas).

For module 6 to be claimable:
- Users must be able to view each other's profiles.
- There must be a friends system (add, remove, block).
- There must be direct messaging between users.
- In-game match invitations via the chat interface would additionally unlock module 11 (advanced chat, 1 pt).

---

## Mandatory checklist

Go through each item before the defence:

- [x] Frontend + backend + database
- [x] Git with meaningful commits from all team members
- [ ] **Docker deployment — single command** (missing — see Critical section above)
- [x] Google Chrome compatibility
- [ ] **No browser console errors** — run a full audit: open Chrome DevTools on every page (landing, auth, home, session management, profile, 2FA modal) and confirm zero errors and zero warnings
- [x] Privacy Policy page accessible from footer
- [x] Terms of Service page accessible from footer
- [x] Multi-user support (WebTransport handles concurrent sessions)
- [x] HTTPS everywhere (TLS via Salvo + Rustls, all cookies `Secure`)
- [x] User management: register/login, Argon2id hashed passwords
- [x] Form validation on frontend and backend
- [x] CSS framework (Tailwind CSS)
- [x] `.env.example` provided (`backend/.env.example`)
- [x] Database schema with clear relations (see README.md § Database Schema)

---

## Planned / next up

### 1. Merge the game branch

Highest-value work. Merging asplavnic's game branch unlocks modules 3, 4, and 5 (6 pts). Coordinate a review session to check:
- No regressions on auth, session management, or avatar pages
- WebTransport game stream integrates cleanly with the existing `stream_manager`
- Babylon.js canvas does not conflict with the existing landing page scene

### 2. User interaction module (chat + friends + profiles) — Major, 2 pts

Builds on top of the existing user infrastructure. Minimum scope to claim the module:
- Profile view page: avatar, nickname, description, (future) match history
- Friends system: send/accept/decline friend requests, view friends list, block users
- Direct messaging: real-time messages between friends over the existing WebTransport connection
- Presence indicators (online/offline)

### 3. Advanced chat features — Minor, 1 pt (stretch)

Requires module 6 (user interaction) to be in place first. Adds:
- Block users from chat
- Invite a friend to a game directly from the chat window
- Chat message history
- Typing indicators

### 4. Remote players — Major, 2 pts (requires game merge + module 4)

The `stream_manager` already handles multiple concurrent sessions. Remaining work:
- Match lobby: two players can find each other and agree to start
- Server tick loop: process inputs from both players on each game tick
- Broadcast updated game state to both connections

### 5. Browser console error audit

Before evaluation, open every page and modal in Chrome and check DevTools console:
- Landing page
- Auth page (register, login, 2FA login modal)
- Home / dashboard
- Session management page (list sessions, revoke, delete, change password)
- Profile / avatar upload flow
- Privacy Policy and Terms of Service pages

Fix all errors and warnings before the defence.

### 6. Notification system

Currently only `ServerHello` is sent on WebTransport connect. The `notifications` table exists and the CBOR codec is in place. A full notification system (friend requests, match invitations, game results) would support the user interaction and advanced chat modules. Not required as a standalone item, but needed as infrastructure for modules 6 and 11.

### 7. Sound system

drongier's sound system branch is in progress. Merge before evaluation for a more complete game feel.
