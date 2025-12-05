import React, { useState } from 'react';
import { User, Shield, Zap, ArrowLeft, LogIn, Swords } from 'lucide-react';

// --- DESIGN SYSTEM & THEME CONFIGURATION ---
// Change these utility class strings to alter the look of your entire app.
// We use Tailwind colors here (Slate, Blue, Emerald, etc.)
const theme = {
  layout: {
    main: "min-h-screen bg-slate-950 text-slate-200 font-sans flex flex-col items-center justify-center p-4",
    card: "bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-8 w-full max-w-md",
  },
  typography: {
    heading: "text-3xl font-bold text-white mb-6 text-center tracking-tight",
    subheading: "text-xl font-semibold text-slate-300 mb-4",
    label: "block text-sm font-medium text-slate-400 mb-1",
  },
  components: {
    // Primary button (Login, Main actions)
    buttonPrimary: "w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-lg transition-all transform active:scale-95 shadow-lg shadow-blue-900/20",
    // Secondary button (Local Play, Back)
    buttonSecondary: "w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 px-4 rounded-lg border border-slate-700 transition-all active:scale-95",
    // Input fields
    input: "w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all",
  }
};

// --- REUSABLE UI COMPONENTS ---
// We build these once using our theme so we don't have to copy-paste Tailwind classes everywhere.

const Button = ({ onClick, variant = 'primary', children, type = 'button' }) => (
  <button
    onClick={onClick}
    type={type}
    className={variant === 'primary' ? theme.components.buttonPrimary : theme.components.buttonSecondary}
  >
    {children}
  </button>
);

const InputField = ({ label, type, placeholder }) => (
  <div className="mb-4">
    <label className={theme.typography.label}>{label}</label>
    <input type={type} placeholder={placeholder} className={theme.components.input} />
  </div>
);

// --- PAGE COMPONENTS ---

// 1. Landing Page
const LandingPage = ({ onLogin, onLocalPlay }) => (
  <div className={theme.layout.card}>
    <div className="flex justify-center mb-6">
      <Swords size={64} className="text-blue-500" />
    </div>
    <h1 className={theme.typography.heading}>Galactic Arena</h1>
    <div className="space-y-4">
      <Button onClick={onLogin} variant="primary">
        <LogIn size={20} /> Login Online
      </Button>
      <div className="relative flex py-2 items-center">
        <div className="flex-grow border-t border-slate-800"></div>
        <span className="flex-shrink mx-4 text-slate-600 text-xs uppercase tracking-widest">Or</span>
        <div className="flex-grow border-t border-slate-800"></div>
      </div>
      <Button onClick={onLocalPlay} variant="secondary">
        <Zap size={20} /> Local Play
      </Button>
    </div>
  </div>
);

// 2. Authentication Page
const AuthPage = ({ onBack, onSubmit }) => (
  <div className={theme.layout.card}>
    <div className="flex items-center mb-6">
      <button onClick={onBack} className="text-slate-500 hover:text-white transition-colors">
        <ArrowLeft size={24} />
      </button>
      <h2 className="text-2xl font-bold ml-4 text-white">Pilot Login</h2>
    </div>

    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <InputField label="Username" type="text" placeholder="Enter your callsign..." />
      <InputField label="Password" type="password" placeholder="••••••••" />

      <div className="mt-8">
        <Button type="submit" variant="primary">
          Initialize System
        </Button>
      </div>
    </form>
  </div>
);

// 3. Game/Arena Placeholder
const GameBoard = ({ mode, onLeave }) => (
  <div className="w-full max-w-4xl flex flex-col h-[80vh]">
    {/* Header / HUD */}
    <div className="flex justify-between items-center bg-slate-900 p-4 rounded-t-xl border-b border-slate-800">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-900/50">
          <User size={20} className="text-white" />
        </div>
        <div>
          <p className="font-bold text-white">Player 1</p>
          <p className="text-xs text-blue-400">Ready</p>
        </div>
      </div>

      <div className="text-xl font-mono text-slate-500 tracking-widest">
        00 : 00
      </div>

      <div className="flex items-center gap-3 flex-row-reverse">
        <div className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center shadow-lg shadow-emerald-900/50">
          {mode === 'local' ? <User size={20} className="text-white" /> : <Shield size={20} className="text-white" />}
        </div>
        <div className="text-right">
          <p className="font-bold text-white">{mode === 'local' ? 'Player 2' : 'Opponent'}</p>
          <p className="text-xs text-emerald-400">Waiting...</p>
        </div>
      </div>
    </div>

    {/* The Arena (Canvas Placeholder) */}
    <div className="flex-1 bg-slate-950 relative border-x border-slate-800 overflow-hidden flex items-center justify-center">
      {/* Grid Background Effect */}
      <div className="absolute inset-0 opacity-10"
        style={{ backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
      </div>

      <div className="text-center space-y-4 z-10 p-8 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-xl">
        <Swords size={48} className="mx-auto text-slate-500 mb-4" />
        <h3 className="text-xl font-bold text-white">Arena Ready</h3>
        <p className="text-slate-400 max-w-sm">
          This is where the canvas/WebGL game will be rendered.
          <br />
          Mode: <span className="text-blue-400 font-mono uppercase">{mode}</span>
        </p>
      </div>
    </div>

    {/* Controls / Footer */}
    <div className="bg-slate-900 p-4 rounded-b-xl border-t border-slate-800 flex justify-between items-center">
      <button
        onClick={onLeave}
        className="flex items-center gap-2 text-slate-400 hover:text-red-400 transition-colors text-sm font-bold uppercase tracking-wider"
      >
        <ArrowLeft size={16} /> Abort Mission
      </button>

      <div className="text-slate-600 text-xs">
        System Status: Normal
      </div>
    </div>
  </div>
);

// --- MAIN APP COMPONENT ---

export default function App() {
  // STATE MANAGEMENT
  // 'view' controls which page is shown: 'landing', 'login', 'game-local', 'game-online'
  const [view, setView] = useState('landing');

  // Simple navigation functions
  const goHome = () => setView('landing');
  const goLogin = () => setView('login');
  const goLocalGame = () => setView('game-local');
  const goOnlineGame = () => setView('game-online');

  // Render logic based on state
  return (
    <div className={theme.layout.main}>
      {view === 'landing' && (
        <LandingPage
          onLogin={goLogin}
          onLocalPlay={goLocalGame}
        />
      )}

      {view === 'login' && (
        <AuthPage
          onBack={goHome}
          onSubmit={goOnlineGame}
        />
      )}

      {(view === 'game-local' || view === 'game-online') && (
        <GameBoard
          mode={view === 'game-local' ? 'local' : 'online'}
          onLeave={goHome}
        />
      )}
    </div>
  );
}
