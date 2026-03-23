# WCAG 2.1 AA Accessibility Compliance Plan

## Overview

This document outlines the plan to achieve **WCAG 2.1 Level AA** compliance for the Transcendence project. The non-game UI (auth, profiles, settings, navigation, lobby, chat, scoreboard) must be fully compliant. The 3D game canvas qualifies for WCAG's **sensory experience exemption** and requires only a descriptive text alternative.

---

## Current Compliance State (~65-70%)

### What's already in place

| Area | Implementation | Files |
|------|---------------|-------|
| **Semantic HTML** | `lang="en"`, `<main>`, `<header>`, `<footer role="contentinfo">`, heading hierarchy | `index.html`, `AppRoutes.tsx` |
| **Form accessibility** | `useId()`, `htmlFor`/`id` pairing, `aria-invalid`, `aria-describedby` for errors/hints, `role="alert"` on error messages | `ui/Input.tsx` |
| **Dialog accessibility** | `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Escape to close | `ui/Modal.tsx` |
| **Live regions** | `aria-live="assertive"` on errors, `aria-live="polite"` on status updates | `ui/ErrorBanner.tsx`, `ui/ConnectionStatusBanner.tsx`, `ui/NotificationToast.tsx` |
| **Focus visibility** | Gold `focus-visible` ring (2px solid) via `index.css`, good contrast on dark background | `index.css` |
| **Icon handling** | `aria-hidden="true"` on all decorative icons (15+ instances) | All UI components |
| **Menu structure** | `aria-expanded`, `aria-haspopup="menu"`, `role="menu"`, `role="menuitem"`, `role="separator"` | `ui/Dropdown.tsx` |

---

## Critical Gaps

These must be fixed to claim WCAG 2.1 AA compliance.

### 1. Dropdown keyboard navigation

**WCAG Criterion:** 2.1.1 Keyboard
**File:** `frontend/src/components/ui/Dropdown.tsx`
**Issue:** Only Escape and click-outside work. No arrow key navigation, no focus management.

**Required changes:**
- Arrow Up/Down to traverse menu items
- Home/End to jump to first/last item
- Enter/Space to activate focused item
- Return focus to trigger button on menu close
- Optional: typeahead (first-letter) navigation

### 2. Reduced motion support

**WCAG Criterion:** 2.3.3 Animation from Interactions
**Files:** `frontend/src/index.css`, `frontend/tailwind.config.js`
**Issue:** No `prefers-reduced-motion` media query anywhere in the codebase. All animations run regardless of user OS setting.

**Affected animations:**
- Dropdown enter: `dropdown-enter 150ms ease-out`
- Toast slide: `animate-toast-in`, `animate-toast-out`
- Button active: `active:translate-y-1`
- Loading spinner: `animate-spin`
- Hover transitions: `transition-all`, `transition-colors` (~200ms)

**Required changes:**
- Add `@media (prefers-reduced-motion: reduce)` block in `index.css` to disable/shorten all animations
- Consider a `useReducedMotion()` hook for JS-driven animations

### 3. Modal focus trap

**WCAG Criterion:** 2.4.3 Focus Order
**File:** `frontend/src/components/ui/Modal.tsx`
**Issue:** Tab key can escape the modal to the page body behind it.

**Required changes:**
- Trap Tab/Shift+Tab within modal boundaries
- Auto-focus first focusable element on open
- Return focus to the element that triggered the modal on close

### 4. Skip-to-main-content link

**WCAG Criterion:** 2.4.1 Bypass Blocks
**File:** `frontend/src/index.html` or `AppRoutes.tsx`
**Issue:** No skip link exists for keyboard users to bypass navigation.

**Required changes:**
- Add visually-hidden skip link as first focusable element
- Link to `#main-content` with corresponding `id` on the `<main>` element

### 5. Focus return on dropdown close

**WCAG Criterion:** 2.4.3 Focus Order
**File:** `frontend/src/components/ui/Dropdown.tsx`
**Issue:** When dropdown closes, focus is lost instead of returning to the trigger button.

**Required changes:** (included in Dropdown keyboard navigation work above)

---

## High-Priority Improvements

These improve compliance and should be addressed alongside critical gaps.

| Issue | WCAG Criterion | File | Detail |
|-------|---------------|------|--------|
| **Color contrast on semantic backgrounds** | 1.4.3 Contrast (Minimum) | `ui/Alert.tsx`, `tailwind.config.js` | `danger-light` (#f06078) and `info-light` (#30c8d0) on transparent `*-bg` backgrounds may fail 4.5:1 ratio. Needs browser-rendered contrast audit. |
| **EditUserModal textarea** | 1.3.1 Info & Relationships | `modals/EditUserModal.tsx` | Missing `<label>` association, `aria-invalid`, and `role="alert"` on error messages for the description textarea. |
| **SessionManagement checkbox labels** | 1.3.1 Info & Relationships | `SessionManagement.tsx` | Checkboxes for selecting sessions need more descriptive `aria-label` text. |
| **Password strength announcements** | 4.1.3 Status Messages | `AuthPage.tsx` | No `aria-live` announcement for real-time password validation feedback. |
| **Ghost button contrast** | 1.4.3 Contrast (Minimum) | `ui/Button.tsx` | `text-stone-300` on hover `bg-stone-800` — verify meets 4.5:1 for normal text. |
| **Disabled button contrast** | 1.4.3 Contrast (Minimum) | `ui/Button.tsx` | `opacity-60` may push text below 4.5:1. Consider using explicit disabled colors instead of opacity. |

---

## Game Canvas — Sensory Experience Exemption

### WCAG basis

WCAG 2.1 Success Criterion 1.1.1 (Non-text Content) states:

> **Sensory:** If non-text content is primarily intended to create a specific sensory experience, then text alternatives at minimum describe the non-text content with a descriptive identification.

The Transcendence game is a **real-time 3D multiplayer arena game** rendered via Babylon.js, requiring:
- Visual-spatial awareness (3D isometric camera, character positions)
- Real-time reaction (60 Hz game state updates, combat timing)
- Complex simultaneous inputs (movement + abilities + dodging)

This qualifies as a sensory experience. Making it playable via screen reader would fundamentally transform the game into something else entirely.

### Required for compliance

1. **Descriptive `aria-label`** on the game canvas element:
   ```html
   <canvas aria-label="Real-time 3D multiplayer arena game — requires visual interaction and keyboard input to play"></canvas>
   ```
2. **All surrounding game UI must be fully accessible:** lobby/matchmaking, scoreboard, chat, settings, post-match results
3. **Any HTML HUD overlays** on the canvas (health bars, ability indicators, etc.) must have appropriate ARIA attributes

### Accessibility statement

Include in the site (e.g., footer link or `/accessibility` page):

> This site conforms to WCAG 2.1 Level AA. The real-time 3D game component is a sensory experience (per WCAG SC 1.1.1) and cannot be fully operated via screen reader or keyboard alone. All non-game features — including account management, matchmaking, chat, and scoreboards — are fully accessible.

---

## Implementation Checklist

### Critical (blocks compliance)

- [ ] Dropdown: arrow key navigation (Up/Down, Home/End, Enter/Space)
- [ ] Dropdown: return focus to trigger on close
- [ ] Modal: focus trap (Tab/Shift+Tab cycling)
- [ ] Modal: auto-focus first element on open, restore focus on close
- [ ] Add `@media (prefers-reduced-motion: reduce)` to `index.css`
- [ ] Add skip-to-main-content link
- [ ] Add `aria-label` on game canvas

### High priority

- [ ] Contrast audit: verify all color pairs meet 4.5:1 (normal text) / 3:1 (large text)
- [ ] EditUserModal: add label and aria-invalid to textarea
- [ ] SessionManagement: improve checkbox aria-labels
- [ ] AuthPage: add aria-live to password validation feedback
- [ ] Button: verify ghost variant and disabled state contrast

---

## Verification

| Method | What it checks |
|--------|---------------|
| **axe DevTools / Lighthouse** | Automated WCAG checks on every page |
| **Keyboard-only walkthrough** | Tab through entire app without mouse — every interactive element must be reachable and operable |
| **Screen reader test** (NVDA / Orca) | All non-game flows announce correctly: forms, errors, navigation, modals, notifications |
| **`prefers-reduced-motion` emulation** | Toggle in browser DevTools → verify all animations stop/reduce |
| **WebAIM Contrast Checker** | Test every foreground/background color pair in the design system |
| **Manual focus indicator check** | Verify gold focus ring is visible on every interactive element |

---

## Effort Estimate

| Area | Effort |
|------|--------|
| Dropdown keyboard + focus | ~2-3 hours |
| Modal focus trap | ~2 hours |
| Reduced motion | ~1 hour |
| Skip link | ~30 minutes |
| Form fixes (EditUserModal, SessionManagement, AuthPage) | ~2 hours |
| Contrast audit + fixes | ~1-2 hours |
| Game canvas aria-label | ~15 minutes |
| Verification & testing | ~3-4 hours |
| **Total** | **~2-3 days** |
