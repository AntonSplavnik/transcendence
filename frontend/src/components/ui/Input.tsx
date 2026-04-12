import React, { forwardRef, useId } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	label?: string;
	icon?: React.ReactNode;
	error?: string;
	hint?: string;
	validation?: React.ReactNode;
	variant?: 'default' | 'code';
	fullWidth?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
	{
		label,
		icon,
		error,
		hint,
		validation,
		variant = 'default',
		fullWidth = true,
		className = '',
		id,
		...props
	},
	ref,
) {
	const autoId = useId();
	const inputId = id || autoId;
	const errorId = error ? `${inputId}-error` : undefined;
	const hintId = hint ? `${inputId}-hint` : undefined;

	const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

	const baseInput = `
    bg-stone-900 border rounded-lg text-stone-100
    placeholder-stone-500 transition-all duration-200
    focus:outline-none focus:border-gold-400
    focus:shadow-[0_0_0_2px_rgba(224,160,48,0.15),inset_0_0_12px_rgba(224,160,48,0.05)]
  `;

	const errorBorder = error ? 'border-danger' : 'border-stone-700';

	const variantStyles =
		variant === 'code'
			? 'px-4 py-3 text-center text-2xl tracking-[0.3em] font-mono'
			: `px-4 py-2.5 ${icon ? 'pl-10' : ''}`;

	return (
		<div className={fullWidth ? 'w-full' : ''}>
			{(label || validation) && (
				<div className="flex items-center justify-between mb-1.5">
					{label && (
						<label
							htmlFor={inputId}
							className="block text-sm font-medium text-stone-300"
						>
							{label}
						</label>
					)}
					{validation && (
						<span className="text-xs" role="status" aria-live="polite">
							{validation}
						</span>
					)}
				</div>
			)}
			<div className="relative">
				{icon && variant !== 'code' && (
					<span
						className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
						aria-hidden="true"
					>
						{icon}
					</span>
				)}
				<input
					ref={ref}
					id={inputId}
					className={`
            ${baseInput} ${errorBorder} ${variantStyles}
            ${fullWidth ? 'w-full' : ''} ${className}
          `}
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={describedBy}
					{...props}
				/>
			</div>
			{error && (
				<p id={errorId} className="text-danger-light text-xs mt-1.5" role="alert">
					{error}
				</p>
			)}
			{hint && !error && (
				<p id={hintId} className="text-stone-400 text-xs mt-1.5">
					{hint}
				</p>
			)}
		</div>
	);
});

export default Input;
