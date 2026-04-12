import '@fontsource-variable/fredoka';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/nunito-sans';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
