# Frontend

## Frontend Stack

├── React (UI framework)
├── Vite (build tool)
├── Tailwind CSS (styling)
├── WebTransport, native Browser API (real-time connection to the Rust backend)
└── TypeScript (language)

### why we chose this stack

React: Popular, component-based UI library with a large ecosystem. Good for building interactive UIs. Especially good for our usecase since we wanted to combine 3D graphics with UI elements.

Vite: Modern build tool with fast dev server and optimized production builds. Works well with React and TypeScript.

Tailwind CSS: Utility-first CSS framework that allows rapid styling without writing custom CSS. Good for prototyping and consistent design.
Allows changing styles from inside components without having to go to a separate CSS file.
Nice for writing custom templates and themes.

TypeScript: Superset of JavaScript that adds static typing. Helps catch errors early and improves code maintainability.

### how to set up a project with react + vite

Create a new React + Vite project

```
npm create vite@latest my-game -- --template react
```

installed with:

> npx
> "create-vite" game

│
◇ Select a framework:
│ React
│
◇ Select a variant:
│ TypeScript + SWC
│
◇ Use rolldown-vite (Experimental)?:
│ No
│
◆ Install with npm and start now?
│ ● Yes / ○ No

framework using react for better ui
using typescript for better error catching
using SWC:
What it does:
-Compiles JSX → JavaScript faster
-Compiles TypeScript → JavaScript faster
For the game:
✅ Faster development (instant hot reload)
✅ Written in Rust (this is cool!)
⚠️ Occasionally has edge-case bugs
❌ Zero impact on game speed in production

Navigate to project

```
cd my-game
```

Install dependencies

```
npm install
```

Install Tailwind

```
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### how to run it

Start dev server (<http://localhost:5173>)

```
npm run dev
```

### Development and Testing with the Backend

i have set up a command that can be executed when inside frontend/:

```
npm run all
```

this runs the frontend on:
<http://localhost:5173/>
(access the dynamic frontend here to see changes immediately)

and the backend on
<https://127.0.0.1:8443/>
(access the backend api documentation here and the statically compiled website)

Development: Run Rust (cargo run) AND React (npm run dev) separately. The Proxy connects them.

```
cd backend && cargo run
cd frontend && npm run dev
```

or serve files locally with a static server

```
npm run build


cd backend && cargo run
```

serve the dist/ folder
means no dynamic reloading, but good for testing production build

### Deployment

Build optimized files for deployment

```
npm run build
```

This creates a 'dist/' folder with:

- Minified JavaScript
- Optimized CSS
- Compressed assets

then comes Deployment:
Upload the dist/ folder to:
Netlify (easiest)
Vercel
GitHub Pages
Your own server

## explaining vite for folder structure

-index.html is the static HTML file Vite serves. It usually contains a root node like <div id="root"></div>. Vite injects the built JS into this file for production; during dev it serves it and the dev server handles hot reload.
-main.tsx is the JavaScript/TypeScript entrypoint that the bundler runs. Typical responsibilities:
-Import global CSS (Tailwind entry file).
-Create and mount the React app into the DOM: createRoot(document.getElementById("root")).render(<App />).
-Configure top-level things (e.g., performance reporting).
-App.tsx is the top-level React component. It composes providers and top-level UI, routes or view switching, and nothing more. It is not the same as the server entrypoint — it’s the client root component.
-The bundler (Vite) starts from main.tsx, builds the graph of imports, applies TS/JS transforms, and injects output into index.html in production.

so:
index.html is pure HTML/CSS entry — browsers load that.
main.tsx is where React/JS runtime starts and attaches to the DOM.
App.tsx is your app UI/logic composer, written as a React component.

## Design System (`src/components/ui/`)

All reusable UI components live in `src/components/ui/` and are exported from `ui/index.ts`. Import via:

```tsx
import { Button, Card, Input, Alert, Badge, Modal } from "./ui";
// or from modals:
import { Button, Input, Alert } from "../ui";
```

### Component Reference

| Component | When to use | Key props |
|-----------|-------------|-----------|
| **Button** | Any clickable action | `variant` (primary/secondary/danger/ghost), `size` (sm/md/lg), `loading` + `loadingText`, `icon`, `fullWidth` |
| **Card** | Container for grouped content | `variant` (default/elevated/inset), `accent` (gold/danger/success/info), `hoverable`, `padding` |
| **Modal** | Dialog overlay | `title`, `icon`, `footer` (button row), `closable`, `maxWidth` |
| **Input** | Text input fields | `label`, `icon`, `error`, `hint`, `validation` (inline status), `variant` (default/code) |
| **Alert** | Inline feedback messages | `variant` (error/warning/info/success), `dismissable`, `onDismiss` |
| **Badge** | Status indicators | `variant` (success/warning/danger/info/neutral), `dot`, `size` |
| **Dropdown** | Menu triggered by a button | `trigger`, `align` (left/right). Children: `DropdownItem`, `DropdownSeparator` |
| **InfoBlock** | Label + value display | `label`, `value`, `sublabel`, `mono` |
| **ErrorBanner** | Fixed-position auto-dismiss banner | `error` (StoredError), `onDismiss`, `duration`, `variant` |
| **LoadingSpinner** | Loading indicator | `size` (sm/md/lg), `color` (gold/white/stone) |
| **Layout** | Page wrapper | `variant` (default/centered/game) |

### When to use what

- **Inline error after a form action** → `<Alert variant="error">`
- **Global error after navigation/redirect** → `<ErrorBanner>` (used once in AppRoutes)
- **Status text (e.g. "2FA: Enabled")** → `<Badge variant="success" dot>`
- **Key-value info (e.g. session details)** → `<InfoBlock label="..." value="..." />`
- **Form input with label and icon** → `<Input label="Email" icon={<Mail />} />`
- **OTP / recovery code input** → `<Input variant="code" />`
- **Button with loading state** → `<Button loading loadingText="Saving...">`
- **Menu dropdown** → `<Dropdown trigger={...}><DropdownItem /></Dropdown>`

### Color Palette

Colors are derived from KayKit dungeon/forest textures. Defined in `tailwind.config.js`.

- **Neutrals**: `stone-50` (cream) through `stone-950` (near-black)
- **Primary**: `gold-50` through `gold-900` (default: `gold-400`)
- **Semantic**: `danger`, `success`, `warning`, `info` (each has DEFAULT, light, dark, bg)
- **Accents**: `accent-purple`, `accent-magenta`, `accent-cyan`, `accent-teal`, `accent-coral`

### Typography

- **Headings**: `font-display` (Fredoka) — use `<h1>`, `<h2>`, `<h3>` or `className="font-display"`
- **Body**: `font-body` (Nunito Sans) — default for all text
- **Code**: `font-mono` (JetBrains Mono) — for session IDs, recovery codes, etc.
- **Swap fonts**: Edit `--font-display`, `--font-body`, `--font-mono` in `src/index.css`

---

## Console Logging

`console.log` and `console.debug` are stripped from production builds via Vite's `esbuild.pure` option. Use `console.error` or `console.warn` for messages that should appear in production (real errors, unexpected failures). Use `console.log` for debug/development output.

## Libraries

### overview

| Package     | Type         | What it does                    |
| ----------- | ------------ | ------------------------------- |
| Vite        | Build tool   | Compiles & serves your code     |
| React       | UI framework | Builds your interface           |
| TypeScript  | Language     | Adds types to JavaScript        |
| BabylonJS   | Game engine  | Renders 3D graphics             |
| TailwindCSS | Styling      | Makes CSS easier                |
| Axios       | HTTP client  | Makes API calls (if you add it) |
| ESLint      | Linter       | Finds code issues               |

### Babylon.js (3D engine)

Babylon.js is a powerful, open-source 3D engine for building games and interactive experiences in the browser using WebGL.
We use it to simplify writing our game’s graphics, the physics engine, camera controls, lighting, and asset management.
to display it I can manually wrap it in a react component. There is also the option of downloading react-bablylonjs, but that adds another layer. The other way is more responsive, although integration with react state management is more work.

Babylon needs an HTMLCanvasElement to create a WebGL context and render.
In React you create a <canvas ref={canvasRef} />, then in useEffect create Engine(canvas, ...), Scene(engine), set up camera/light/meshes, run render loop, and clean up on unmount.
Keep per-frame updates inside Babylon (requestAnimationFrame) and avoid re-rendering React on every frame.

### Axios (HTTP client)

Axios is a popular HTTP client library for making requests from the browser. It supports promises, interceptors, and automatic JSON parsing.

In my case I use it to make my code prettier since it makes intercepting fetch easier. fetch is the vanilla way to make http requests, but axios makes it easier to handle things like headers, timeouts, and response parsing.
So for my case I wanted an easy way to retry on 401 errors, and axios interceptors made that easy.

## React event handling

official react website on the topic: <https://react.dev/learn/responding-to-events>

react uses a synthetic event system that wraps native browser events to provide consistent behavior across different browsers.

## Authentication on the frontend

We get a jwt token when registering or logging in. this has to be sent with every request.

```typescript
const apiClient = axios.create({
  baseURL: "/api",
  withCredentials: true,
});
```

no need to write withCredentials on any other api call

This needs to be refreshed every 15 minutes.

## JWT Refresh

The JWT has a 15-minute expiry. Two complementary mechanisms keep the user authenticated:

### Why proactive refresh is needed

The Axios interceptor (reactive refresh) catches 401 responses and retries the request after refreshing the JWT. This works for regular HTTP calls, but **not for WebTransport**. WebTransport is a persistent connection — the backend disconnects it when `access_expiry` passes, and there is no HTTP request to intercept. By the time we notice, the connection is already dead. Proactive refresh solves this by refreshing the JWT _before_ it expires, so the WebTransport session never sees an invalid token.

### Reactive refresh (`api/client.ts`)

The Axios response interceptor is a safety net for normal API calls:

1. A request returns 401 with `InvalidJwt` or `MissingJwtCookie` (browser drops expired JWT cookies entirely).
2. The interceptor calls `refreshJWT()` to get a new token.
3. It retries the original request automatically.
4. If the refresh fails, `authFailureCallback` (wired to `clearAuth()` in `AuthContext`) resets auth state. ProtectedRoute then redirects to `/auth`.

**Error storage in the refresh catch block** follows a simple rule: the refresh response itself goes through this same interceptor, so 401 failures are already classified (silent for `MissingSessionCookie`/`SessionNotFound`, stored for `NeedReauth`/`InvalidSessionToken`). The catch block only stores errors for non-401 server failures (e.g. 429 rate limit, 500) that the interceptor doesn't handle.

**Other 401 classification** (when JWT refresh is not applicable):

| Brief | Action |
| --- | --- |
| `MissingSessionCookie`, `SessionNotFound` | Silent — user is not logged in, ProtectedRoute redirects |
| `InvalidSessionToken`, `SessionMismatch` | Store `dead_session` — session is corrupted |
| `NeedReauth` | Store `needReauth` — rolling inactivity exceeded |
| `InvalidCredentials`, `TwoFactorRequired`, `TwoFactorInvalid` | Pass through — component handles |
| `DidLogout` | Pass through |
| Unknown | Store `unauthorized` |

### Proactive refresh (`hooks/useJwtRefresh.ts`)

A timer-based hook that fires **1 minute before** `access_expiry`:

- **Dynamic scheduling** — `computeDelay()` calculates the timeout from `session.access_expiry`, capped at 14 minutes and floored at 5 seconds.
- **Visibility handler** — when a backgrounded tab becomes visible again, the hook checks whether the JWT is about to expire. If remaining time is less than the 1-minute buffer, it refreshes immediately (browsers throttle `setTimeout` in background tabs).
- **Error handling** — any 401 from the refresh endpoint is terminal (session is gone) and calls `onAuthLost()`. Named terminal briefs (`NeedReauth`, `InvalidSessionToken`, `SessionNotFound`, `MissingSessionCookie`) are also matched explicitly. Network or unknown errors retry with exponential backoff (5 s, 10 s, 20 s, … up to 60 s).
- **Rescheduling** — on success, the hook calls `onSessionUpdate()` which updates `session` state in `AuthContext`. Because the effect depends on `session`, it re-runs and schedules the next refresh automatically.

### Integration

`AuthContext` wires the hook into the auth state:

```tsx
useJwtRefresh({
    session,
    onSessionUpdate: handleSessionUpdate,
    onAuthLost: clearAuth,
});
```

`handleSessionUpdate` sets the new session in state. `clearAuth` resets user/session to `null`, which triggers route guards to redirect to the login page.

### Key files

| File | Role |
| --- | --- |
| `api/client.ts` | Axios interceptor — reactive 401 retry |
| `hooks/useJwtRefresh.ts` | Proactive timer-based refresh hook |
| `contexts/AuthContext.tsx` | Calls `useJwtRefresh`, owns session state |
| `api/auth.ts` | `refreshJWT()` function (HTTP call) |

## Navigation Architecture

Navigation and error handling have **separate responsibilities**:

| System                           | Responsibility                                  |
| -------------------------------- | ----------------------------------------------- |
| **ProtectedRoute / PublicRoute** | Controls where users can go based on auth state |
| **ErrorBanner**                  | Displays messages explaining what happened      |

### Route Guards (AppRoutes.tsx)

```tsx
// Redirects unauthenticated users to /auth
function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

// Redirects authenticated users to /home
function PublicRoute({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/home" replace />;
  return <>{children}</>;
}
```

**Usage:**

```tsx
<Route
  path="/home"
  element={
    <ProtectedRoute>
      <Home />
    </ProtectedRoute>
  }
/>
```

### Error System (api/error.ts, ErrorBanner)

The error system **only displays messages** - it does NOT control navigation.

- Explains _why_ the user was redirected
- Only shows for mid-use failures (not initial auth checks)

- `storeError()` - saves error to localStorage for display after redirect
- `retrieveStoredError()` - retrieves and clears stored error
- `ErrorBanner` - displays the error message with dismiss button

### What does protected route solve?

**ProtectedRoute handles navigation because:**

- Works for direct URL access (user bookmarks `/home`)
- Works for page refresh with expired session
- Declarative - routes define their own requirements
- Standard React pattern

## Add api calls

in frontend/src/api/ create a new file for your resource, e.g., users.ts and add the functions there (e.g nicknameExists)
then import and use them in your components.
if they need authentication, make sure to call them from within AuthContext or pass the jwt token from there.
That means either wrap them in AuthContext functions usually.

## React Router

We use `react-router-dom` for client-side routing.

**Why:** Hash navigation support (for backend redirection), URL history, and industry-standard patterns.

**AuthContext** holds user state and auth functions (login, logout, register). It wraps the API calls from `api/auth.ts`.

## Authentication Flow

### Responsibility Boundaries

| Component               | Responsibility                                      |
| ----------------------- | --------------------------------------------------- |
| **`AuthContext`**       | Manages _authentication state_ (user, session)      |
| **`authApi` (auth.ts)** | Makes _HTTP calls_ to backend                       |
| **`AppRoutes`**         | Handles _navigation_ after auth events              |
| **`AuthPage`**          | Handles user _input_, coordinates auth + navigation |

### Login Flow

```
User submits form
    ↓
AuthPage.handleSubmit()
    ↓
useAuth().login(email, password)
    ├─ Calls authApi.login() (HTTP request)
    ├─ Receives { user, session }
    └─ Calls setAuthData() (updates state)
    ↓
onAuthSuccess() callback
    ↓
AppRoutes.handleAuthSuccess()
    └─ navigate('/home')
```

This would make it easier to test the context because there is no Router dependency in context.
It's also about separation of concerns, navigation and auth state do not need to live in the same file.
But them not living in the same file necessitates passing callbacks around like so:

```
// AuthPage.tsx
const { login } = useAuth();

const handleSubmit = async () => {
  await login(email, password);  // ← Sets auth state
  onAuthSuccess();                // ← Triggers navigation
};
```

### how to expand the codebase

```
// ✅ Use AuthContext
const { user, session, login, register, logout } = useAuth();

// ✅ Use API functions (wrapped by context)
await login(email, password);
await logout();

// ✅ Use navigation callbacks
onLogout();  // From AppRoutes
navigate('/home');

// ✅ Global error handling
// ErrorBanner only in AppRoutes
```

## Two-Factor Authentication

The frontend supports TOTP-based two-factor authentication. Users can enable 2FA from their dashboard, and will be prompted for a code during login if enabled.

**See [frontend-2fa.md](frontend-2fa.md) for detailed documentation.**

### Components

| Component             | Location                         | Purpose                       |
| --------------------- | -------------------------------- | ----------------------------- |
| `TwoFactorAuthModal`  | `modals/TwoFactorAuthModal.tsx`  | Enable/disable 2FA            |
| `TwoFactorLoginModal` | `modals/TwoFactorLoginModal.tsx` | 2FA verification during login |
| `ReauthModal`         | `modals/ReauthModal.tsx`         | Session re-authentication     |

### API Endpoints

| Endpoint                               | Purpose                               |
| -------------------------------------- | ------------------------------------- |
| `POST /user/2fa/start`                 | Get QR code for setup                 |
| `POST /user/2fa/confirm`               | Confirm setup, get recovery codes     |
| `POST /user/2fa/disable`               | Disable 2FA                           |
| `POST /auth/login`                     | Login (accepts optional `mfa_code`)   |
| `POST /auth/session-management/reauth` | Refresh session (optional `mfa_code`) |

### Key Pattern: Refs for Sensitive Data

All 2FA modals use `useRef` instead of `useState` for passwords and codes to avoid keeping sensitive data in the React state tree.
