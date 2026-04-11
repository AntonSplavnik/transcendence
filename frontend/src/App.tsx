import { HashRouter } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { AudioProvider } from './audio/AudioProvider';
import MusicController from './audio/MusicController';
import { AuthProvider } from './contexts/AuthContext';
import { GameProvider } from './contexts/GameContext';
import { LobbyProvider } from './contexts/LobbyContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { StreamProvider } from './contexts/StreamContext';

function App() {
	return (
		<HashRouter>
			<AudioProvider>
				<AuthProvider>
					<StreamProvider>
						<NotificationProvider>
							<LobbyProvider>
								<GameProvider>
									<MusicController />
									<AppRoutes />
								</GameProvider>
							</LobbyProvider>
						</NotificationProvider>
					</StreamProvider>
				</AuthProvider>
			</AudioProvider>
		</HashRouter>
	);
}

export default App;
