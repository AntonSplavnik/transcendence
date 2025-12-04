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

### how to run it:
Start dev server (http://localhost:5173)
```
npm run dev
```

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
