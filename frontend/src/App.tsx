import { useState, useCallback } from 'react';
import LandingPage from "./components/LandingPage";
import GameBoard from "./components/GameBoard";
import AuthPage from "./components/AuthPage";
// import Dashboard from "./components/Dashboard";
import Layout from "./components/ui/Layout";
import './App.css'

type View = "landing" | "login" | "signup" | "game-local" | "game-online" | "dashboard";

function App() {
  const [view, setView] = useState<View>("landing");
  const goHome = useCallback(() => setView("landing"), []);
  const goLogin = useCallback(() => setView("login"), []);
  // const goSignup = useCallback(() => setView("signup"), []);
  const goGameLocal = useCallback(() => setView("game-local"), []);
  const goDashboard = useCallback(() => setView("dashboard"), []);
  // const goGameOnline = useCallback(() => setView("game-online"), []);

  return (
    <Layout>
      {view === "landing" && <LandingPage onLogin={goLogin} onLocal={goGameLocal} />}
      {(view === "game-local" || view === "game-online") && (<GameBoard mode={view === "game-local" ? "local" : "online"} onLeave={goHome} />)}
      {view === "login" && <AuthPage onBack={goHome} onSubmit={goDashboard} />}
    </Layout>
  )
}

// {view} === "landing" && <LandingPage onLogin={goLogin} onSignup={goSignup} onGameLocal={goGameLocal} onGameOnline={goGameOnline} />
// {view} === "login" && <div>Login Page - <button onClick={goHome}>Go Home</button></div>
// {view} === "signup" && <div>Signup Page - <button onClick={goHome}>Go Home</button></div>
// {(view === "game-local" || view === "game-online") && (<GameBoard mode={view === "game-local" ? "local" : "online"} onLeave={goHome} />
// )}

export { App }
export default App
