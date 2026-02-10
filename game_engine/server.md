How to Start/Stop Servers

  Current Status:

  You have 2 background processes running:
  - Mock Server (task ID: bc5045f) - on port 8080
  - Vite Dev Server (task ID: be8fe70) - on port 5173

  To Check Running Tasks:

  /tasks

  To Stop a Task:

  # Stop mock server
  kill bc5045f

  # Stop dev server
  kill be8fe70

  To Start Fresh:

  Terminal 1 - Start Mock Server:
  cd /Users/antonsplavnik/Documents/Programming/42/Core/6/Transcendence/game_engine/client_example
  npm run server

  Terminal 2 - Start Client Dev Server:
  cd /Users/antonsplavnik/Documents/Programming/42/Core/6/Transcendence/game_engine/client_example
  npm run dev

  Then open: http://localhost:5173/play.html

  ---
  Test Movement Now:

  Refresh your browser and try pressing WASD keys.

  Open the browser console (Cmd+Option+I) and you should see messages like:
  - "W pressed - moving forward"
  - "A pressed - moving left"

  If you don't see these messages, the keyboard isn't being captured. This might be because the canvas doesn't have focus. Try clicking on the arena first, then pressing WASD.

  Let me know:
  1. Do you see the console messages when pressing WASD?
  2. Does the blue sphere move when you press the keys?
