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
		expect(card).toHaveClass('card-stone');
		expect(card).toHaveClass('p-5');
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
		expect(card).toHaveClass('card-stone');
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
		expect(card).toHaveClass('card-stone');
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
