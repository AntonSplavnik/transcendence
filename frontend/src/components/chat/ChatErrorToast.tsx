/*
 * ChatErrorToast — inline stream error display, shown above the input.
 *
 * Only surfaces user-visible errors. Client logic bugs (InvalidMessageId,
 * CantUnreadText) are handled in ChatContext via console.warn and never shown.
 */

import { useChat } from '../../contexts/ChatContext';

const ERROR_MESSAGES: Record<string, string> = {
	RateLimitExceeded: 'Slow down!',
	MessageTooLong: 'Message too long.',
};

export default function ChatErrorToast() {
	const { chatError } = useChat();

	if (!chatError) return null;

	const message = ERROR_MESSAGES[chatError.error];
	if (!message) return null;

	return (
		<div
			role="alert"
			aria-live="assertive"
			className="px-3 py-1.5 mb-1 text-xs text-danger-light bg-danger-bg border border-danger-light/30 rounded animate-chat-enter pointer-events-none"
		>
			{message}
		</div>
	);
}
