/*
 * GenericErrorBoundary — silent class-based error boundary.
 *
 * Wraps any subtree. On uncaught render error: logs to console,
 * renders nothing (null), so the rest of the app continues unaffected.
 *
 * Usage:
 *   <GenericErrorBoundary>
 *     <ChatOverlay />
 *   </GenericErrorBoundary>
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
}

export class GenericErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(_error: unknown): State {
		return { hasError: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('[ErrorBoundary] caught error:', error, info.componentStack);
	}

	render(): ReactNode {
		if (this.state.hasError) {
			return null;
		}
		return this.props.children;
	}
}
