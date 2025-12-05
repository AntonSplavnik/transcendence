import { useState, useCallback } from 'react';
import LandingPage from "./components/LandingPage";
import GameBoard from "./components/GameBoard";
import AuthPage from "./components/AuthPage";
import './App.css'

type View = "landing" | "login" | "signup" | "game-local" | "game-online";

function App() {
  const [view, setView] = useState<View>("landing");
  const goHome = useCallback(() => setView("landing"), []);
  const goLogin = useCallback(() => setView("login"), []);
  const goSignup = useCallback(() => setView("signup"), []);
  const goGameLocal = useCallback(() => setView("game-local"), []);
  const goGameOnline = useCallback(() => setView("game-online"), []);

  return (
    <div>
      {view} === "landing" && <LandingPage onLogin={goLogin} onSignup={goSignup} onGameLocal={goGameLocal} onGameOnline={goGameOnline} />
      {view} === "login" && <div>Login Page - <button onClick={goHome}>Go Home</button></div>
      {view} === "signup" && <div>Signup Page - <button onClick={goHome}>Go Home</button></div>
      {(view === "game-local" || view === "game-online") && (<GameBoard mode={view === "game-local" ? "local" : "online"} onLeave={goHome} />
      )}
    </div>
  )
}

export { App }
export default App
