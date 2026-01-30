import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppRoutes from './AppRoutes';

function App() {
	return (
		<HashRouter>
			<AuthProvider>
				<AppRoutes />
			</AuthProvider>
		</HashRouter>
	);
}

export default App;
