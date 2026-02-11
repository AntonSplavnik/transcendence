import { useEffect } from 'react';
import Card from './Card';

interface ModalProps {
	onClose: () => void;
	title: string;
	icon?: React.ReactNode;
	maxWidth?: 'md' | 'lg';
	children: React.ReactNode;
}

export default function Modal({ onClose, title, icon, maxWidth = 'md', children }: ModalProps) {
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [onClose]);

	const widthClass = maxWidth === 'lg' ? 'max-w-lg' : 'max-w-md';

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
			<Card className={`${widthClass} w-full max-h-[90vh] overflow-y-auto`}>
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-2xl font-bold text-wood-100 flex items-center gap-2">
						{icon}
						{title}
					</h2>
					<button
						onClick={onClose}
						className="text-wood-400 hover:text-wood-200 text-2xl leading-none"
					>
						×
					</button>
				</div>
				{children}
			</Card>
		</div>
	);
}
