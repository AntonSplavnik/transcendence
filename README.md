_This project has been created as part of the 42 curriculum by kwurster, asplavnic, drongier, lmeubrin_

# Transcendence

## Description

section that clearly presents the project, including its goal and a brief overview
section should also contain a clear name for the project and its
key features.

A real-time multiplayer web-based fighting game built with React, Node.js, and WebTransport. Players can create accounts, join matches, and compete against each other in a fast-paced arena.

## Instructions

section containing any relevant information about compilation,
installation, and/or execution
section should mention all the needed prerequisites (software,
tools, versions, configuration like .env setup, etc.), and step-by-step instructions to run the project

## Resources

section listing classic references related to the topic (documen-
tation, articles, tutorials, etc.), as well as a description of how AI was used —
specifying for which tasks and which parts of the project.

additional sections examples:
usage, examples, feature list, technical choices, etc

## Team information

asplavnic - @AntonSplavnic : Product Owner and Game Developer

- in charge of defining the game mechanics and ensuring a smooth gaming experience for players.
  lmeubrin - @Moat423 : Project Manager and Frontend Developer
- in charge of coordinating the project, managing timelines, and developing the user interface for the website.
  kwurster - @kjzl : Tech Lead and Backend Developer
- responsible for overseeing the technical aspects of the project, designing the backend architecture, and implementing the server-side logic.
  drongier - @drongier : Developer and DevOps
- responsible for contributing to both frontend and backend development, as well as managing the deployment and infrastructure of the project.

## other sections to still add

• Project Management:
◦ How the team organized the work (task distribution, meetings, etc.).
◦ Tools used for project management (GitHub Issues, Trello, etc.).
◦ Communication channels used (Discord, Slack, etc.).
• Technical Stack:
◦ Frontend technologies and frameworks used.
◦ Backend technologies and frameworks used.
◦ Database system and why it was chosen.
◦ Any other significant technologies or libraries.
◦ Justification for major technical choices.
• Database Schema:
◦ Visual representation or description of the database structure.
◦ Tables/collections and their relationships.
◦ Key fields and data types.
• Features List:
◦ Complete list of implemented features.
◦ Which team member(s) worked on each feature.
◦ Brief description of each feature’s functionality.
• Modules:
◦ List of all chosen modules (Major and Minor).
◦ Point calculation (Major = 2pts, Minor = 1pt).
◦ Justification for each module choice, especially for custom "Modules of
choice".
◦ How each module was implemented.
◦ Which team member(s) worked on each module.
• Individual Contributions:
◦ Detailed breakdown of what each team member contributed.
◦ Specific features, modules, or components implemented by each person.
◦ Any challenges faced and how they were overcome.

Any other useful or relevant information is welcome (usage documentation, known
limitations, license, credits, etc.)

## Backend authentication

See docs/backend-auth.md

## Frontend documentation

See docs/frontend.md

## Modules

_What this section is about:_
Modules:
◦ List of all chosen modules (Major and Minor).
◦ Point calculation (Major = 2pts, Minor = 1pt).
◦ Justification for each module choice, especially for custom "Modules of
choice".
◦ How each module was implemented.
◦ Which team member(s) worked on each module.

This project needs to implement modules equivalent to at least 14 points. A major module is worth 2 points, while a minor module is worth 1 point.

### _Minor_ custom module of choice: Session Management

_by lmeubrin and kwurster_

In a competitive gaming platform, account security is critical. This module provides enterprise-grade session management, allowing users to:

- View all active sessions with device/IP information
- Log out suspicious sessions remotely
- Change passwords with optional session preservation
- Perform all actions with MFA re-verification

This is important, because the user can detect and mitigate unauthorized access to their account, which is especially important in a gaming platform.

**Technical Implementation**:

- Password-gated access to sensitive session data
- Three distinct session invalidation patterns (selective, bulk, deletion)
- JWT/session expiry calculations
- Integrated MFA verification for all destructive operations
- Optimistic UI with comprehensive error handling

The challenge on the frontend with this module was to make it work with the 2 factor authentification. Since that value constantly changes, we can not save it like the password. I tried minimizing the ammount of times the user has to type in things to confirm actions by keeping the field with the password ref hidden but in scope of the session management component, so that it can be used for all operations without asking the user to type in their password multiple times. That greatly improves the user experience, but for the mfa key, the user still has to type it in every single time. So even there I tried to minimize the number of times the user has to type it in by not clearing the field every time, so if the user is fast, he can reuse the mfa code. In addition to that, every field has to work with the mfa code and the recovery code.

But I believe it is worth it as it empowers users to audit and control their account security, addressing OWASP session management best practices and building trust in the platform's security posture.
It also aligns with data protection principles (GDPR, etc.) by giving users visibility and control over their authentication sessions.

### Module 11 — Custom Minor: Sound System

Modules of choice Minor (1 pt) — by drongier

In a competitive multiplayer fighting game, audio is not cosmetic: it is core gameplay feedback. This module introduces a dedicated sound system that covers local responsiveness, remote synchronization, and 3D spatial perception. Players hear immediate feedback for their own actions, positional cues for opponents, and consistent mix behavior across UI, menu, and in-game contexts.

Justification: Real-time game audio design follows established middleware principles (FMOD/Wwise): event-driven playback, sound banks, mixer buses, and separation between gameplay state and audio rendering. This module addresses practical gameplay risks (audio spam, repetitive fatigue, desynced feedback) while improving accessibility and game readability. No standard module in ft_transcendence provides this end-to-end architecture.

Implementation: The frontend uses a shared Babylon `AudioEngineV2` stack with routed buses (`master`, `sfx`, `music`, `music_ingame`, `ambient`, `ui`), a preloaded `SoundBank`, and declarative trigger tables for local input, remote snapshot deltas, and server events. Audio settings are persisted in local storage with validation and legacy migration support. Local jump/attack spam was mitigated by moving critical triggers away from raw key presses to animation/gameplay events, ensuring one-shot playback at the right moment. The backend integration relies on authoritative game events and stream delivery so every client receives consistent combat/audio outcomes while preserving immediate local feedback where needed.
