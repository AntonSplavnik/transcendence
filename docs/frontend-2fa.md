# Two-Factor Authentication (Frontend)

## Overview

The frontend implements a complete TOTP-based two-factor authentication system with four main components:

| Component             | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `TwoFactorAuthModal`  | Setup/disable 2FA from user dashboard                   |
| `TwoFactorLoginModal` | Verify 2FA code during login                            |
| `ReauthModal`         | Re-authenticate expiring sessions (with 2FA if enabled) |
| `AuthPage` / `Home`   | Integration points for the modals                       |

---

## User Flows

### Setting Up 2FA (Home → TwoFactorAuthModal)

```
Home.tsx → User Menu → "Two-Factor Authentication"
    ↓
TwoFactorAuthModal (step: 'confirm')
    ↓ Click "Enable 2FA"
(step: 'qr') → Enter password → POST /user/2fa/start
    ↓ Receive QR code (base64 PNG)
(step: 'verify') → Scan QR + Enter 6-digit code → POST /user/2fa/confirm
    ↓ Receive recovery codes
(step: 'recovery') → Display codes + Copy button → Done
```

**Implementation Notes:**

- Password input persists across `qr` and `verify` steps using a `ref`
- QR code displayed as inline base64: `data:image/png;base64,${qrCode}`
- Recovery codes shown in monospace font with clipboard copy functionality

### Login with 2FA (AuthPage → TwoFactorLoginModal)

```
AuthPage.tsx → Submit login form
    ↓
POST /auth/login (without mfa_code)
    ↓ Error: 'TwoFactorRequired'
TwoFactorLoginModal opens
    ↓ Enter 6-digit code or recovery code
POST /auth/login (with mfa_code)
    ↓ Success
Navigate to Home
```

**Implementation Notes:**

- Password stored in `ref` on AuthPage, accessed via `getPassword()` callback
- `getErrorBrief()` checks for `'TwoFactorRequired'` to trigger modal
- Supports both TOTP codes and recovery codes

### Disabling 2FA (TwoFactorAuthModal)

```
TwoFactorAuthModal (step: 'confirm') → Click "Disable 2FA"
    ↓
handleDisable2FA() → Requires password + current 2FA code
    ↓
POST /user/2fa/disable
    ↓ Success
Modal closes, user.totp_enabled = false
```

### Session Re-authentication (Home → ReauthModal)

```
Home.tsx → handlePlayGame()
    ↓
Check: JWT expires within 30 minutes?
    ↓ Yes
ReauthModal opens
    ↓
Enter password + 2FA (if user.totp_enabled) → POST /auth/session-management/reauth
    ↓ Success
Proceed to game
```

---

## API Endpoints

| Endpoint                          | Method | Purpose                                   | Auth Required  |
| --------------------------------- | ------ | ----------------------------------------- | -------------- |
| `/user/2fa/start`                 | POST   | Generate QR code for setup                | JWT            |
| `/user/2fa/confirm`               | POST   | Confirm 2FA with code, get recovery codes | JWT            |
| `/user/2fa/disable`               | POST   | Disable 2FA (requires password + code)    | JWT            |
| `/auth/login`                     | POST   | Login with optional `mfa_code`            | None           |
| `/auth/session-management/reauth` | POST   | Refresh session (optional `mfa_code`)     | Session cookie |

---

## Component Files

| File                                            | Purpose                                           |
| ----------------------------------------------- | ------------------------------------------------- |
| `src/components/modals/TwoFactorAuthModal.tsx`  | 4-step modal for enabling/disabling 2FA           |
| `src/components/modals/TwoFactorLoginModal.tsx` | Modal for 2FA code entry during login             |
| `src/components/modals/ReauthModal.tsx`         | Modal for session re-authentication               |
| `src/api/user.ts`                               | API calls: `start2FA`, `confirm2FA`, `disable2FA` |
| `src/api/auth.ts`                               | API calls: `login` (with mfa), `reauth`           |

---

## State Management

All modals use React refs for sensitive inputs (passwords, codes) rather than state:

```typescript
const passwordRef = useRef<HTMLInputElement>(null);
const mfaCodeRef = useRef<HTMLInputElement>(null);
```

**Rationale:** Refs avoid keeping sensitive data in the React state tree, reducing exposure in dev tools and accidental serialization.

---

## Security Practices

### Password Handling

- Passwords stored in refs, not React state
- Cleared after successful operations
- `type="password"` for browser masking
- `autoComplete="current-password"` for proper autofill

### 2FA Code Handling

- `autoComplete="one-time-code"` enables OTP autofill on mobile
- `maxLength={6}` prevents overly long input
- Auto-focus on mount for quick entry

### Error Handling

- Generic error messages via `getErrorMessage()` - no sensitive data leaked
- Specific error briefs (`TwoFactorRequired`, `TwoFactorInvalid`) for flow control
- Form `e.preventDefault()` prevents accidental submission

---

## User Object Fields

```typescript
interface User {
  totp_enabled: boolean; // Is 2FA currently active?
  totp_confirmed_at: string | null; // ISO date when 2FA was enabled
  // ... other fields
}
```

These fields determine:

- Whether 2FA code field appears in ReauthModal
- Status indicator in user menu ("✓ Active")
- Whether TwoFactorLoginModal is triggered on login
