import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AbilitySlot from '@/components/GameBoard/hud/AbilitySlot';

describe('AbilitySlot', () => {
	it('renders the icon', () => {
		render(
			<AbilitySlot icon="💠" label="Q" timer={0} cooldown={5} color="rgba(52,152,219,0.2)" />,
		);
		expect(screen.getByText('💠')).toBeInTheDocument();
	});

	it('renders the key label', () => {
		render(
			<AbilitySlot icon="💠" label="Q" timer={0} cooldown={5} color="rgba(52,152,219,0.2)" />,
		);
		expect(screen.getByText('Q')).toBeInTheDocument();
	});

	it('shows no cooldown fill when timer is 0 (ready)', () => {
		render(
			<AbilitySlot icon="💠" label="Q" timer={0} cooldown={5} color="rgba(52,152,219,0.2)" />,
		);
		expect(screen.queryByTestId('cooldown-fill')).not.toBeInTheDocument();
	});

	it('shows cooldown fill at correct height when on cooldown', () => {
		render(
			<AbilitySlot icon="🔮" label="E" timer={4} cooldown={8} color="rgba(155,89,182,0.2)" />,
		);
		const fill = screen.getByTestId('cooldown-fill');
		expect(fill.style.height).toBe('50%');
	});

	it('shows 100% fill when timer equals cooldown', () => {
		render(
			<AbilitySlot icon="💠" label="Q" timer={5} cooldown={5} color="rgba(52,152,219,0.2)" />,
		);
		const fill = screen.getByTestId('cooldown-fill');
		expect(fill.style.height).toBe('100%');
	});

	it('shows no fill when cooldown is 0', () => {
		render(
			<AbilitySlot icon="💠" label="Q" timer={0} cooldown={0} color="rgba(52,152,219,0.2)" />,
		);
		expect(screen.queryByTestId('cooldown-fill')).not.toBeInTheDocument();
	});
});
