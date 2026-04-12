import React from 'react';
import LoadingSpinner from './LoadingSpinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
	size?: 'sm' | 'md' | 'lg';
	loading?: boolean;
	loadingText?: string;
	icon?: React.ReactNode;
	iconPosition?: 'left' | 'right';
	fullWidth?: boolean;
}

const sizeStyles = {
	sm: 'px-3 py-1.5 text-sm rounded',
	md: 'px-4 py-2 text-base rounded-md',
	lg: 'px-6 py-3 text-lg rounded-lg',
};

const variantStyles = {
	primary:
		'bg-gold-400 hover:bg-gold-500 text-stone-900 shadow-[0_4px_0_#7a4820,0_0_12px_rgba(224,160,48,0.2)] hover:shadow-[0_4px_0_#7a4820,0_0_20px_rgba(224,160,48,0.35)] active:shadow-[0_0px_0_#7a4820,0_0_12px_rgba(224,160,48,0.2)]',
	secondary:
		'bg-stone-700 hover:bg-stone-600 text-stone-100 shadow-[0_4px_0_#1a1a1e] active:shadow-[0_0px_0_#1a1a1e]',
	danger: 'bg-danger hover:bg-danger/90 text-white shadow-[0_4px_0_#8a1520] hover:shadow-[0_4px_0_#8a1520,0_0_12px_rgba(200,32,48,0.25)] active:shadow-[0_0px_0_#8a1520]',
	ghost: 'bg-transparent hover:bg-stone-800 text-stone-300 hover:text-stone-100',
	success:
		'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_4px_0_#14532d,0_0_12px_rgba(16,185,129,0.2)] hover:shadow-[0_4px_0_#14532d,0_0_20px_rgba(16,185,129,0.35)] active:shadow-[0_0px_0_#14532d,0_0_12px_rgba(16,185,129,0.2)]',
};

export default function Button({
	children,
	variant = 'primary',
	size = 'md',
	loading = false,
	loadingText,
	icon,
	iconPosition = 'left',
	fullWidth = false,
	className = '',
	disabled,
	...props
}: ButtonProps) {
	const isDisabled = disabled || loading;

	return (
		<button
			className={`
        font-semibold transition-all duration-200 inline-flex items-center justify-center gap-2
        ${sizeStyles[size]}
        ${variantStyles[variant]}
        ${fullWidth ? 'w-full' : ''}
        ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''}
        ${className}
      `}
			disabled={isDisabled}
			{...props}
		>
			{loading && (
				<LoadingSpinner size="sm" color={variant === 'primary' ? 'dark' : 'stone'} />
			)}
			{!loading && icon && iconPosition === 'left' && icon}
			{loading && loadingText ? loadingText : children}
			{!loading && icon && iconPosition === 'right' && icon}
		</button>
	);
}
