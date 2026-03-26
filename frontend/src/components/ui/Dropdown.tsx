import React, { useState, useRef, useEffect, useCallback } from 'react';

/* ─── Dropdown ─── */

export interface DropdownProps {
	trigger: React.ReactNode;
	children: React.ReactNode;
	align?: 'left' | 'right';
	className?: string;
}

export function Dropdown({ trigger, children, align = 'right', className = '' }: DropdownProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	const close = useCallback(() => setOpen(false), []);

	useEffect(() => {
		if (!open) return;

		const handleKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
		};
		const handleClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) close();
		};

		document.addEventListener('keydown', handleKey);
		document.addEventListener('mousedown', handleClick);
		return () => {
			document.removeEventListener('keydown', handleKey);
			document.removeEventListener('mousedown', handleClick);
		};
	}, [open, close]);

	return (
		<div ref={ref} className={`relative ${className}`}>
			<button
				onClick={() => setOpen((prev) => !prev)}
				aria-expanded={open}
				aria-haspopup="menu"
				className="appearance-none bg-transparent p-0 border-none cursor-pointer"
			>
				{trigger}
			</button>
			{open && (
				<div
					role="menu"
					className={`
            absolute top-full mt-2 z-50 min-w-[200px]
            card-stone ring-1 ring-gold-400/10 py-1
            shadow-[0_8px_24px_rgba(0,0,0,0.4)]
            animate-[dropdown-enter_150ms_ease-out]
            ${align === 'right' ? 'right-0' : 'left-0'}
          `}
				>
					{React.Children.map(children, (child) =>
						React.isValidElement(child)
							? React.cloneElement(
									child as React.ReactElement<{ onClose?: () => void }>,
									{ onClose: close },
								)
							: child,
					)}
				</div>
			)}
		</div>
	);
}

/* ─── DropdownItem ─── */

export interface DropdownItemProps {
	icon?: React.ReactNode;
	children: React.ReactNode;
	onClick: () => void;
	variant?: 'default' | 'danger';
	suffix?: React.ReactNode;
	onClose?: () => void;
}

export function DropdownItem({
	icon,
	children,
	onClick,
	variant = 'default',
	suffix,
	onClose,
}: DropdownItemProps) {
	const handleClick = () => {
		onClick();
		onClose?.();
	};

	const variantClass =
		variant === 'danger'
			? 'text-danger-light hover:bg-danger-bg'
			: 'text-stone-200 hover:bg-stone-700/60';

	return (
		<button
			role="menuitem"
			onClick={handleClick}
			className={`
        w-full px-4 py-2.5 text-left text-sm flex items-center gap-3
        transition-colors duration-150 ${variantClass}
      `}
		>
			{icon && (
				<span className="flex-shrink-0 w-4 h-4" aria-hidden="true">
					{icon}
				</span>
			)}
			<span className="flex-1">{children}</span>
			{suffix && <span className="flex-shrink-0 text-xs text-stone-400">{suffix}</span>}
		</button>
	);
}

/* ─── DropdownSeparator ─── */

export function DropdownSeparator() {
	return (
		<div
			className="my-1 border-t border-stone-700"
			role="separator"
			aria-orientation="horizontal"
		/>
	);
}
