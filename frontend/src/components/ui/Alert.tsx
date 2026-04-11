import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import React from 'react';

export interface AlertProps {
	variant: 'error' | 'warning' | 'info' | 'success';
	children: React.ReactNode;
	icon?: React.ReactNode;
	dismissable?: boolean;
	onDismiss?: () => void;
	className?: string;
}

const defaultIcons: Record<string, React.ReactNode> = {
	error: <AlertCircle size={18} />,
	warning: <AlertTriangle size={18} />,
	info: <Info size={18} />,
	success: <CheckCircle size={18} />,
};

const variantStyles: Record<string, string> = {
	error: 'bg-danger-bg border-danger text-danger-light shadow-[inset_0_0_12px_rgba(200,32,48,0.08)]',
	warning:
		'bg-warning-bg border-warning text-warning-light shadow-[inset_0_0_12px_rgba(240,128,56,0.08)]',
	info: 'bg-info-bg border-info text-info-light shadow-[inset_0_0_12px_rgba(64,144,224,0.08)]',
	success:
		'bg-success-bg border-success text-success-light shadow-[inset_0_0_12px_rgba(32,176,112,0.08)]',
};

export default function Alert({
	variant,
	children,
	icon,
	dismissable = false,
	onDismiss,
	className = '',
}: AlertProps) {
	const displayIcon = icon ?? defaultIcons[variant];

	return (
		<div
			role="alert"
			className={`
        rounded-lg border p-3 text-sm flex items-start gap-2.5
        ${variantStyles[variant]} ${className}
      `}
		>
			{displayIcon && (
				<span className="flex-shrink-0 mt-0.5" aria-hidden="true">
					{displayIcon}
				</span>
			)}
			<div className="flex-1 min-w-0">{children}</div>
			{dismissable && onDismiss && (
				<button
					onClick={onDismiss}
					className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
					aria-label="Dismiss alert"
				>
					<X size={16} />
				</button>
			)}
		</div>
	);
}
