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

### Silent Mode for Initial Auth Check

The initial auth check uses `getMe({ silent: true })` to avoid showing error messages when the app first loads and finds no valid session. This prevents confusing "session expired" messages on fresh visits.

```tsx
// AuthContext.tsx - initial check is silent
const data = await authApi.getMe({ silent: true });
```

Regular API calls (without `silent`) will store errors for display if they fail.

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
