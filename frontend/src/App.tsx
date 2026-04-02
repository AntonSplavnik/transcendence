import { HashRouter } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { AuthProvider } from './contexts/AuthContext';
import { FriendsProvider } from './contexts/FriendsContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { StreamProvider } from './contexts/StreamContext';

function App() {
	return (
		<HashRouter>
			<AuthProvider>
				<StreamProvider>
					<NotificationProvider>
						<FriendsProvider>
							<AppRoutes />
						</FriendsProvider>
					</NotificationProvider>
				</StreamProvider>
			</AuthProvider>
		</HashRouter>
	);
}

export default App;
