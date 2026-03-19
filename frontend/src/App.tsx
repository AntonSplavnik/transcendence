import { HashRouter } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { AuthProvider } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { StreamProvider } from './contexts/StreamContext';

function App() {
	return (
		<HashRouter>
			<AuthProvider>
				<StreamProvider>
					<NotificationProvider>
						<ChatProvider>
							<AppRoutes />
						</ChatProvider>
					</NotificationProvider>
				</StreamProvider>
			</AuthProvider>
		</HashRouter>
	);
}

export default App;
