# Frontend

Frontend Stack:
├── React (UI framework)
├── Vite (build tool)
├── Tailwind CSS (styling)
├── WebSocket/Socket.io (connection to Rust backend)
└── TypeScript (language)

### how to set up a project with react + vite

Create a new React + Vite project

```
npm create vite@latest my-game -- --template react
```

installed with:
> npx
> "create-vite" game

│
◇  Select a framework:
│  React
│
◇  Select a variant:
│  TypeScript + SWC
│
◇  Use rolldown-vite (Experimental)?:
│  No
│
◆  Install with npm and start now?
│  ● Yes / ○ No

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

Development: Run Rust (cargo run) AND React (npm run dev) separately. The Proxy connects them.

or serve files locally with a static server

```
npm run build
```

serve the dist/ folder

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

## Bablylon.js (3D engine)

TODO: wrap it manually in a react component. ther eis also the option of downloading react-bablylonjs, but that adds another layer. the other way is more responsive, although integration with react state management is more work.

Babylon needs an HTMLCanvasElement to create a WebGL context and render.
In React you create a <canvas ref={canvasRef} />, then in useEffect create Engine(canvas, ...), Scene(engine), set up camera/light/meshes, run render loop, and clean up on unmount.
Keep per-frame updates inside Babylon (requestAnimationFrame) and avoid re-rendering React on every frame.
