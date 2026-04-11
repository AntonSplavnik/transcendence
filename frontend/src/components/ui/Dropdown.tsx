import React, { useCallback, useEffect, useRef, useState } from 'react';

/* ─── Helpers ─── */

function getFocusableItems(container: HTMLElement | null): HTMLElement[] {
	if (!container) return [];
	return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
}

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
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const close = useCallback(() => {
		setOpen(false);
	}, []);

	// Tracks whether the menu was closed via Tab so focus is NOT restored to the
	// trigger — Tab should let focus proceed naturally to the next element.
	const closedByTabRef = useRef(false);

	// Focus management: open → focus first item; close → restore focus to trigger
	// (unless the menu was closed by Tab, in which case the browser handles it).
	useEffect(() => {
		if (!open) return;

		const items = getFocusableItems(menuRef.current);
		items[0]?.focus();

		// Capture ref value so cleanup uses the same node even if ref changes
		const trigger = triggerRef.current;
		return () => {
			if (!closedByTabRef.current) {
				trigger?.focus();
			}
			closedByTabRef.current = false;
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;

		const handleKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				close();
				return;
			}

			// Tab closes the menu and lets focus proceed to the next element naturally.
			// No preventDefault — the browser moves focus; we just close the menu.
			if (e.key === 'Tab') {
				closedByTabRef.current = true;
				close();
				return;
			}

			if (!menuRef.current) return;
			const items = getFocusableItems(menuRef.current);
			if (items.length === 0) return;

			const currentIndex = items.indexOf(document.activeElement as HTMLElement);

			// focus guard: only handle navigation when focus is within menu or on trigger
			if (currentIndex === -1 && document.activeElement !== triggerRef.current) return;

			if (e.key === 'ArrowDown') {
				e.preventDefault();
				const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
				items[next]?.focus();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
				items[prev]?.focus();
			} else if (e.key === 'Home') {
				e.preventDefault();
				items[0]?.focus();
			} else if (e.key === 'End') {
				e.preventDefault();
				items[items.length - 1]?.focus();
			}
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
				ref={triggerRef}
				onClick={() => setOpen((prev) => !prev)}
				aria-expanded={open}
				aria-haspopup="menu"
				className="appearance-none bg-transparent p-0 border-none cursor-pointer"
			>
				{trigger}
			</button>
			{open && (
				<div
					ref={menuRef}
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
			? 'text-danger-light hover:bg-danger-bg focus-visible:bg-danger-bg'
			: 'text-stone-200 hover:bg-stone-700/60 focus-visible:bg-stone-700/60';

	return (
		<button
			role="menuitem"
			tabIndex={-1}
			onClick={handleClick}
			className={`
        w-full px-4 py-2.5 text-left text-sm flex items-center gap-3
        transition-colors duration-150 outline-none ${variantClass}
      `}
		>
			{icon && (
				<span className="flex-shrink-0 w-4 h-4" aria-hidden="true">
					{icon}
				</span>
			)}
			<span className="flex-1">{children}</span>
			{suffix && <span className="flex-shrink-0 text-xs text-stone-300">{suffix}</span>}
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
