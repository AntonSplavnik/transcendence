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

	it('applies stone-900 background', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.bg-stone-900');
		expect(layoutRoot).toBeInTheDocument();
	});

	it('applies stone-200 text color', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.text-stone-200');
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

	it('applies font-body', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.font-body');
		expect(layoutRoot).toBeInTheDocument();
	});

	it('has selection styling', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		const layoutRoot = screen.getByTestId('content').closest('.bg-stone-900');
		expect(layoutRoot).toHaveClass('selection:bg-gold-400/30');
	});

	it('renders children directly inside the root container', () => {
		render(
			<Layout>
				<span data-testid="content">Content</span>
			</Layout>,
			{ withAuth: false }
		);

		// Layout renders children directly in the root div (flex-grow is provided by
		// the caller, e.g. the <main> wrapper in AppRoutes)
		const root = screen.getByTestId('content').closest('.bg-stone-900');
		expect(root).toBeInTheDocument();
		expect(root).toHaveClass('flex');
		expect(root).toHaveClass('flex-col');
	});
});
