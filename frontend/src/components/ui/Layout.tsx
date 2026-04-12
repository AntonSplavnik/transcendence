import React from 'react';

export interface LayoutProps {
	children: React.ReactNode;
	variant?: 'default' | 'centered' | 'game';
	className?: string;
}

const variantStyles: Record<string, string> = {
	default: 'min-h-screen flex flex-col',
	centered: 'min-h-screen flex flex-col items-center justify-center',
	game: 'h-screen flex flex-col overflow-hidden',
};

export default function Layout({ children, variant = 'default', className = '' }: LayoutProps) {
	return (
		<div
			className={`
        bg-stone-900 text-stone-200 font-body
        selection:bg-gold-400/30 selection:text-stone-50
        ${variantStyles[variant]} ${className}
      `}
		>
			{children}
		</div>
	);
}
