import React from 'react';

export interface InfoBlockProps {
	label: string;
	value: React.ReactNode;
	sublabel?: string;
	mono?: boolean;
	className?: string;
}

export default function InfoBlock({
	label,
	value,
	sublabel,
	mono = false,
	className = '',
}: InfoBlockProps) {
	return (
		<div
			className={`
        bg-stone-900 rounded-lg p-4 border border-stone-700/40
        shadow-[inset_0_1px_0_rgba(248,240,224,0.02)]
        ${className}
      `}
		>
			<p className="text-xs text-stone-300 mb-1">{label}</p>
			<p className={`text-sm text-stone-100 break-words ${mono ? 'font-mono' : ''}`}>
				{value}
			</p>
			{sublabel && <p className="text-xs text-stone-300 mt-1.5">{sublabel}</p>}
		</div>
	);
}
