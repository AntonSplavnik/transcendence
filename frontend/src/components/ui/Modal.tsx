import { useEffect } from 'react';
import Card from './Card';

export interface ModalProps {
	onClose: () => void;
	title: string;
	icon?: React.ReactNode;
	maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
	children: React.ReactNode;
	footer?: React.ReactNode;
	closable?: boolean;
}

const widthMap: Record<string, string> = {
	sm: 'max-w-sm',
	md: 'max-w-md',
	lg: 'max-w-lg',
	xl: 'max-w-xl',
};

export default function Modal({
	onClose,
	title,
	icon,
	maxWidth = 'md',
	children,
	footer,
	closable = true,
}: ModalProps) {
	useEffect(() => {
		if (!closable) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [onClose, closable]);

	return (
		<div
			className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
			onClick={
				closable
					? (e) => {
							if (e.target === e.currentTarget) onClose();
						}
					: undefined
			}
		>
			<Card
				variant="elevated"
				className={`${widthMap[maxWidth]} w-full max-h-[90vh] overflow-y-auto`}
			>
				<div className="flex items-center justify-between mb-4">
					<h2
						id="modal-title"
						className="text-2xl font-bold text-stone-50 flex items-center gap-2"
					>
						{icon && <span aria-hidden="true">{icon}</span>}
						{title}
					</h2>
					{closable && (
						<button
							onClick={onClose}
							className="text-stone-400 hover:text-stone-100 text-xl leading-none p-1 rounded hover:bg-stone-700/50 transition-colors"
							aria-label="Close dialog"
						>
							×
						</button>
					)}
				</div>
				<div>{children}</div>
				{footer && (
					<div className="flex gap-3 mt-6 pt-4 border-t border-stone-700">{footer}</div>
				)}
			</Card>
		</div>
	);
}
