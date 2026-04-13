import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResourceBar from '@/components/GameBoard/hud/ResourceBar';

describe('ResourceBar', () => {
	describe('health', () => {
		it('renders with correct fill width', () => {
			render(<ResourceBar type="health" current={75} max={100} />);
			const fill = screen.getByTestId('resource-fill');
			expect(fill.style.width).toBe('75%');
		});

		it('renders heart icon', () => {
			render(<ResourceBar type="health" current={100} max={100} />);
			expect(screen.getByText('❤️')).toBeInTheDocument();
		});

		it('uses green fill color', () => {
			render(<ResourceBar type="health" current={50} max={100} />);
			const fill = screen.getByTestId('resource-fill');
			expect(fill.style.backgroundColor).toBe('#2ecc71');
		});
	});

	describe('stamina', () => {
		it('renders with correct fill width', () => {
			render(<ResourceBar type="stamina" current={60} max={100} />);
			const fill = screen.getByTestId('resource-fill');
			expect(fill.style.width).toBe('60%');
		});

		it('renders lightning icon', () => {
			render(<ResourceBar type="stamina" current={100} max={100} />);
			expect(screen.getByText('⚡')).toBeInTheDocument();
		});

		it('uses gold fill when above 20%', () => {
			render(<ResourceBar type="stamina" current={50} max={100} />);
			const fill = screen.getByTestId('resource-fill');
			expect(fill.style.backgroundColor).toBe('#e0a030');
		});

		it('uses amber fill when below 20%', () => {
			render(<ResourceBar type="stamina" current={15} max={100} />);
			const fill = screen.getByTestId('resource-fill');
			expect(fill.style.backgroundColor).toBe('#d35400');
		});

		it('applies exhaustion class when exhausted', () => {
			render(<ResourceBar type="stamina" current={0} max={100} exhausted />);
			const bar = screen.getByTestId('resource-bar');
			expect(bar).toHaveClass('hud-stamina-exhausted');
		});

		it('dims icon when exhausted', () => {
			render(<ResourceBar type="stamina" current={0} max={100} exhausted />);
			const icon = screen.getByTestId('resource-icon');
			expect(icon.style.opacity).toBe('0.4');
		});

		it('does not apply exhaustion class when not exhausted', () => {
			render(<ResourceBar type="stamina" current={50} max={100} />);
			const bar = screen.getByTestId('resource-bar');
			expect(bar).not.toHaveClass('hud-stamina-exhausted');
		});
	});

	it('clamps fill to 0% when current is negative', () => {
		render(<ResourceBar type="health" current={-10} max={100} />);
		const fill = screen.getByTestId('resource-fill');
		expect(fill.style.width).toBe('0%');
	});

	it('clamps fill to 100% when current exceeds max', () => {
		render(<ResourceBar type="health" current={150} max={100} />);
		const fill = screen.getByTestId('resource-fill');
		expect(fill.style.width).toBe('100%');
	});

	it('renders 0% fill when max is 0', () => {
		render(<ResourceBar type="health" current={0} max={0} />);
		const fill = screen.getByTestId('resource-fill');
		expect(fill.style.width).toBe('0%');
	});
});
