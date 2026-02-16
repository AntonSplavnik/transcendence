# Frontend Test Suite

## Overview

This test suite provides comprehensive coverage for the Transcendence frontend application. The tests use **Vitest** as the test runner with **React Testing Library** for component testing and **MSW (Mock Service Worker)** for API mocking.

- **229 tests** across **16 test files**
- **85%+ coverage** across all metrics (statements, branches, functions, lines)

## Running Tests

```bash
# Run tests in watch mode (interactive development)
npm test

# Run tests once (CI mode)
npm run test:run

# Run tests with coverage report
npm run test:coverage

# Run tests with Vitest UI (browser-based test explorer)
npm run test:ui
```

## Directory Structure

```
tests/
├── __mocks__/                    # Module mocks
│   └── @bokuweb/
│       └── zstd-wasm.ts          # WASM compression mock
├── fixtures/                     # Test data factories
│   ├── users.ts                  # User, Session, AuthResponse factories
│   └── errors.ts                 # API error factories
├── helpers/                      # Test utilities
│   ├── render.tsx                # Custom render with providers
│   └── msw-handlers.ts           # API mock handlers
├── unit/                         # Unit tests (isolated logic)
│   ├── api/
│   │   ├── client.test.ts        # Axios client & interceptors
│   │   └── error.test.ts         # Error parsing & storage
│   └── stream/
│       └── CompressedCborCodec.test.ts  # CBOR + Zstd codec
└── integration/                  # Integration tests (components)
    ├── auth/
    │   ├── AuthContext.test.tsx  # Auth state management
    │   └── AuthPage.test.tsx     # Login/Register forms
    ├── home/
    │   └── Home.test.tsx         # Home page & sessions
    ├── modals/
    │   ├── ReauthModal.test.tsx
    │   ├── SessionDetailModal.test.tsx
    │   ├── TwoFactorAuthModal.test.tsx
    │   └── TwoFactorLoginModal.test.tsx
    ├── routes/
    │   └── AppRoutes.test.tsx    # Routing & navigation
    └── ui/
        ├── Button.test.tsx
        ├── Card.test.tsx
        ├── ErrorBanner.test.tsx
        ├── Layout.test.tsx
        └── Modal.test.tsx
```

## Test Infrastructure

### MSW Handlers (`helpers/msw-handlers.ts`)

The MSW server intercepts all API requests during tests. Default handlers cover:

- **Auth endpoints**: `/api/auth/login`, `/api/auth/register`, `/api/auth/session-management/*`
- **User endpoints**: `/api/user/me`, `/api/user/logout`, `/api/user/2fa/*`, `/api/user/sessions`
- **Public endpoints**: `/api/users/nickname-exists`

Helper functions for test-specific overrides:

```typescript
import { mockAuthenticatedUser, mockUnauthenticatedUser, mockLoginFailure, mockNetworkError } from './helpers/msw-handlers';

// Override for a specific test
mockUnauthenticatedUser();  // User not logged in
mockAuthenticatedUser({ nickname: 'CustomUser' });  // Custom user data
mockLoginFailure('TwoFactorRequired');  // Simulate 2FA required
mockNetworkError();  // Simulate network failure
```

### Mock Factories (`fixtures/`)

Create consistent test data with factory functions:

```typescript
import { createMockUser, createMockSession, createMockAuthResponse } from './fixtures/users';
import { createMockApiError, createMockAxiosError } from './fixtures/errors';

// Create with defaults
const user = createMockUser();

// Create with overrides
const mfaUser = createMockUser({ totp_enabled: true });
const expiredSession = createMockSession({ access_expiry: '2020-01-01T00:00:00Z' });

// Create errors
const error = createMockApiError({ code: 401, brief: 'InvalidCredentials' });
const axiosError = createMockAxiosError(401, { brief: 'TwoFactorRequired' });
```

### Custom Render (`helpers/render.tsx`)

Wraps components with required providers (Router, AuthContext):

```typescript
import { render, screen, userEvent } from './helpers/render';

// Default: includes MemoryRouter + AuthProvider
render(<MyComponent />);

// Custom options
render(<MyComponent />, {
  initialRoute: '/settings',  // Start at specific route
  withAuth: false,            // Skip AuthProvider
});

// userEvent is re-exported for convenience
const user = userEvent.setup();
await user.click(screen.getByRole('button'));
```

### WASM Mock (`__mocks__/@bokuweb/zstd-wasm.ts`)

Provides pass-through compression/decompression for testing the `CompressedCborCodec` without loading actual WASM binaries:

- `init()` - Simulates async initialization
- `compress()` - Prepends Zstd magic bytes
- `decompress()` - Strips magic bytes

### Global Setup (`../vitest.setup.ts`)

Runs before every test file. Handles:

- **MSW lifecycle**: starts server (`beforeAll`), resets handlers + cleans up DOM/localStorage (`afterEach`), closes server (`afterAll`)
- **`window.location.reload` mock**: jsdom marks `location.reload` as non-configurable, so `vi.spyOn(window.location, 'reload')` throws. We use `vi.stubGlobal` to replace the entire location object with a copy that has `reload` as a `vi.fn()`. The `unstubGlobals: true` option in `vitest.config.ts` ensures automatic restoration after each test.
- **`navigator.clipboard` mock**: Provides `writeText`/`readText` stubs for tests that copy to clipboard (e.g. recovery codes)

## Coverage Summary

Current coverage (enforced thresholds in `vitest.config.ts`):

| Metric     | Coverage | Threshold |
|------------|----------|-----------|
| Statements | 85.81%   | 70%       |
| Branches   | 86.60%   | 65%       |
| Functions  | 83.33%   | 70%       |
| Lines      | 86.29%   | 70%       |

Coverage excludes:
- `node_modules/`
- `tests/`
- `src/main.tsx`
- `src/**/*.d.ts`
- `src/components/GameBoard/**` (Babylon.js 3D components)
- `*.config.*`

## Writing New Tests

### 1. Create test file in appropriate directory

- `tests/unit/` - Pure functions, isolated logic
- `tests/integration/` - Components with user interactions

### 2. Follow naming convention

`ComponentName.test.tsx` or `module.test.ts`

### 3. Structure tests with describe/it

```typescript
import { render, screen, userEvent, waitFor } from '../helpers/render';
import { server } from '../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { MyComponent } from '../../src/components/MyComponent';

describe('MyComponent', () => {
  it('renders initial state', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const user = userEvent.setup();
    render(<MyComponent />);

    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Success')).toBeInTheDocument();
    });
  });

  it('handles API error', async () => {
    // Override handler for this test only
    server.use(
      http.post('/api/endpoint', () => {
        return HttpResponse.json({ error: { brief: 'SomeError' } }, { status: 400 });
      })
    );

    render(<MyComponent />);
    // ... test error handling
  });
});
```

### 4. Key testing patterns

- Use `screen.getByRole()` for accessible queries
- Use `waitFor()` for async state updates
- Use `server.use()` for test-specific API overrides (resets after each test)
- Prefer `userEvent` over `fireEvent` for realistic user interactions
