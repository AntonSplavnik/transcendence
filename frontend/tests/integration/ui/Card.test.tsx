import { describe, it, expect } from 'vitest';
import { render, screen } from '../../helpers/render';
import Card from '../../../src/components/ui/Card';

describe('Card', () => {
	it('renders children', () => {
		render(
			<Card>
				<p>Card content</p>
			</Card>,
			{ withAuth: false }
		);

		expect(screen.getByText('Card content')).toBeInTheDocument();
	});

	it('renders multiple children', () => {
		render(
			<Card>
				<h2>Title</h2>
				<p>Description</p>
				<button>Action</button>
			</Card>,
			{ withAuth: false }
		);

		expect(screen.getByText('Title')).toBeInTheDocument();
		expect(screen.getByText('Description')).toBeInTheDocument();
		expect(screen.getByRole('button')).toBeInTheDocument();
	});

	it('applies base styles', () => {
		render(
			<Card>
				<span data-testid="content">Content</span>
			</Card>,
			{ withAuth: false }
		);

		const card = screen.getByTestId('content').parentElement;
		expect(card).toHaveClass('bg-wood-800');
		expect(card).toHaveClass('border-2');
		expect(card).toHaveClass('border-wood-700');
		expect(card).toHaveClass('rounded-lg');
		expect(card).toHaveClass('shadow-xl');
		expect(card).toHaveClass('p-6');
	});

	it('applies additional className', () => {
		render(
			<Card className="custom-class">
				<span data-testid="content">Content</span>
			</Card>,
			{ withAuth: false }
		);

		const card = screen.getByTestId('content').parentElement;
		expect(card).toHaveClass('custom-class');
	});

	it('preserves base styles when className provided', () => {
		render(
			<Card className="extra-padding">
				<span data-testid="content">Content</span>
			</Card>,
			{ withAuth: false }
		);

		const card = screen.getByTestId('content').parentElement;
		expect(card).toHaveClass('bg-wood-800');
		expect(card).toHaveClass('extra-padding');
	});

	it('handles empty className', () => {
		render(
			<Card className="">
				<span data-testid="content">Content</span>
			</Card>,
			{ withAuth: false }
		);

		const card = screen.getByTestId('content').parentElement;
		expect(card).toHaveClass('bg-wood-800');
	});

	it('renders as div element', () => {
		render(
			<Card>
				<span data-testid="content">Content</span>
			</Card>,
			{ withAuth: false }
		);

		const card = screen.getByTestId('content').parentElement;
		expect(card?.tagName).toBe('DIV');
	});
});
