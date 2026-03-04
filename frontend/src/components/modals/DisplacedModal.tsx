import { AlertTriangle } from 'lucide-react';

import { Button, Modal } from '../ui';

interface DisplacedModalProps {
	/** Called when the user dismisses the modal. */
	onDismiss: () => void;
}

/**
 * Modal shown when the server closes the WebTransport session because the
 * same account connected from another tab or device.
 *
 * Dismissible — the user can close the modal and continue browsing without
 * realtime streaming.  A persistent {@link ConnectionStatusBanner} remains
 * visible to indicate the degraded state.
 */
export default function DisplacedModal({ onDismiss }: DisplacedModalProps) {
	return (
		<Modal
			title="Connection displaced"
			closable
			onClose={onDismiss}
			icon={<AlertTriangle className="w-6 h-6 text-warning" />}
			footer={
				<div className="flex gap-3 w-full">
					<Button variant="secondary" fullWidth onClick={onDismiss}>
						Dismiss
					</Button>
					<Button
						variant="primary"
						fullWidth
						onClick={() => window.location.reload()}
					>
						Reconnect here
					</Button>
				</div>
			}
		>
			<p className="text-stone-300">
				Your account was logged in from another location (a different
				tab, browser, or device). Only one active connection per
				account is allowed.
			</p>
			<p className="text-stone-400 text-sm mt-3">
				You can dismiss this and continue browsing, but realtime
				features (notifications, live game updates) will be
				unavailable until you reconnect.
			</p>
		</Modal>
	);
}
