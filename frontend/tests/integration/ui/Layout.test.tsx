import { describe, it, expect } from 'vitest';
import { render, screen } from '../../helpers/render';
import Layout from '../../../src/components/ui/Layout';

describe('Layout', () => {
	it('renders children', () => {
		render(
			<Layout>
				<p>Child content</p>
			</Layout>,
			{ withAuth: false }
		);

		expect(screen.getByText('Child content')).toBeInTheDocument();
	});

	it('renders multiple children', () => {
		render(
			<Layout>
				<header>Header</header>
				<main>Main content</main>
				<footer>Footer</footer>
			</Layout>,
			{ withAuth: false }
		);

		expect(screen.getByText('Header')).toBeInTheDocument();
		expect(screen.getByText('Main content')).toBeInTheDocument();
		expect(screen.getByText('Footer')).toBeInTheDocument();
	});

	it('applies base styles for full-height layout', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.min-h-screen');
		expect(layoutRoot).toBeInTheDocument();
	});

	it('applies wood-900 background', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.bg-wood-900');
		expect(layoutRoot).toBeInTheDocument();
	});

	it('applies wood-100 text color', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.text-wood-100');
		expect(layoutRoot).toBeInTheDocument();
	});

	it('uses flexbox column layout', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.flex');
		expect(layoutRoot).toHaveClass('flex-col');
	});

	it('applies font-sans', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.font-sans');
		expect(layoutRoot).toBeInTheDocument();
	});

	it('has selection styling', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.selection\\:bg-primary');
		expect(layoutRoot).toBeInTheDocument();
	});

	it('has nested flex-grow container for children', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const innerContainer = screen.getByTestId('content').closest('.flex-grow');
		expect(innerContainer).toBeInTheDocument();
		expect(innerContainer).toHaveClass('flex');
		expect(innerContainer).toHaveClass('flex-col');
	});
});
