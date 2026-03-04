import { useState } from 'react';
import { HashRouter } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import DisplacedModal from './components/modals/DisplacedModal';
import ConnectionStatusBanner from './components/ui/ConnectionStatusBanner';
import NotificationToast from './components/ui/NotificationToast';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { StreamProvider, useStream } from './contexts/StreamContext';

function AppContent() {
	const { connectionState } = useStream();
	const [displacedDismissed, setDisplacedDismissed] = useState(false);

	// The dismissed flag is not reset when leaving the 'displaced' state.
	// In practice this is fine: the only way to reconnect after displacement
	// is "Reconnect here" which triggers a full page reload, resetting all
	// component state including this flag.
	const showDisplacedModal =
		connectionState.status === 'displaced' && !displacedDismissed;

	// Show the persistent banner whenever the connection is not healthy.
	const isConnected = connectionState.status === 'connected';

	return (
		<NotificationProvider>
			{!isConnected && <ConnectionStatusBanner state={connectionState} />}
			<AppRoutes />
			<NotificationToast />
			{showDisplacedModal && (
				<DisplacedModal onDismiss={() => setDisplacedDismissed(true)} />
			)}
		</NotificationProvider>
	);
}

function App() {
	return (
		<HashRouter>
			<AuthProvider>
				<StreamProvider>
					<AppContent />
				</StreamProvider>
			</AuthProvider>
		</HashRouter>
	);
}

export default App;
