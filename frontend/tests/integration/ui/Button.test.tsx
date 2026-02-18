import { describe, it, expect, vi } from 'vitest';
import { render, screen, userEvent } from '../../helpers/render';
import Button from '../../../src/components/ui/Button';

describe('Button', () => {
	it('renders children', () => {
		render(<Button>Click me</Button>, { withAuth: false });

		expect(screen.getByText('Click me')).toBeInTheDocument();
	});

	it('applies primary variant by default', () => {
		render(<Button>Primary</Button>, { withAuth: false });

		const button = screen.getByRole('button');
		expect(button).toHaveClass('bg-gold-400');
		expect(button).toHaveClass('hover:bg-gold-500');
	});

	it('applies secondary variant classes', () => {
		render(<Button variant="secondary">Secondary</Button>, { withAuth: false });

		const button = screen.getByRole('button');
		expect(button).toHaveClass('bg-stone-700');
		expect(button).toHaveClass('hover:bg-stone-600');
	});

	it('applies danger variant classes', () => {
		render(<Button variant="danger">Danger</Button>, { withAuth: false });

		const button = screen.getByRole('button');
		expect(button).toHaveClass('bg-danger');
		expect(button).toHaveClass('hover:bg-danger/90');
	});

	it('applies base styles', () => {
		render(<Button>Styled</Button>, { withAuth: false });

		const button = screen.getByRole('button');
		expect(button).toHaveClass('px-4');
		expect(button).toHaveClass('py-2');
		expect(button).toHaveClass('rounded-md');
		expect(button).toHaveClass('font-semibold');
		expect(button).toHaveClass('transition-all');
	});

	it('passes through additional className', () => {
		render(<Button className="custom-class">Custom</Button>, { withAuth: false });

		const button = screen.getByRole('button');
		expect(button).toHaveClass('custom-class');
	});

	it('passes through HTML button attributes', () => {
		render(
			<Button type="submit" disabled data-testid="test-button">
				Submit
			</Button>,
			{ withAuth: false }
		);

		const button = screen.getByRole('button');
		expect(button).toHaveAttribute('type', 'submit');
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute('data-testid', 'test-button');
	});

	it('handles click events', async () => {
		const handleClick = vi.fn();
		const user = userEvent.setup();

		render(<Button onClick={handleClick}>Click</Button>, { withAuth: false });

		await user.click(screen.getByRole('button'));

		expect(handleClick).toHaveBeenCalledTimes(1);
	});

	it('does not trigger click when disabled', async () => {
		const handleClick = vi.fn();
		const user = userEvent.setup();

		render(
			<Button onClick={handleClick} disabled>
				Disabled
			</Button>,
			{ withAuth: false }
		);

		await user.click(screen.getByRole('button'));

		expect(handleClick).not.toHaveBeenCalled();
	});

	it('renders as button element', () => {
		render(<Button>Button</Button>, { withAuth: false });

		const button = screen.getByRole('button');
		expect(button.tagName).toBe('BUTTON');
	});
});
