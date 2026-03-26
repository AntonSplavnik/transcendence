import { HashRouter } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { AuthProvider } from './contexts/AuthContext';
import { GameProvider } from './contexts/GameContext';
import { LobbyProvider } from './contexts/LobbyContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { FriendsProvider } from './contexts/FriendsContext';
import { StreamProvider } from './contexts/StreamContext';

function App() {
	return (
		<HashRouter>
			<AuthProvider>
				<StreamProvider>
					<NotificationProvider>
						<FriendsProvider>
							<LobbyProvider>
								<GameProvider>
									<AppRoutes />
								</GameProvider>
							</LobbyProvider>
						</FriendsProvider>
					</NotificationProvider>
				</StreamProvider>
			</AuthProvider>
		</HashRouter>
	);
}

export default App;
