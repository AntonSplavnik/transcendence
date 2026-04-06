import { describe, it, expect, vi } from 'vitest';
import { render, screen, userEvent } from '../../helpers/render';
import ChampionGrid from '../../../src/components/ui/ChampionGrid';

describe('ChampionGrid', () => {
	it('renders a button for each character', () => {
		render(<ChampionGrid value={null} onChange={() => {}} />, { withAuth: false });

		expect(screen.getByRole('button', { name: /select knight/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /select rogue/i })).toBeInTheDocument();
	});

	it('marks the selected character as pressed', () => {
		render(<ChampionGrid value="Knight" onChange={() => {}} />, { withAuth: false });

		expect(screen.getByRole('button', { name: /select knight/i })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(screen.getByRole('button', { name: /select rogue/i })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	});

	it('calls onChange with the clicked character id', async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(<ChampionGrid value="Knight" onChange={onChange} />, { withAuth: false });

		await user.click(screen.getByRole('button', { name: /select rogue/i }));

		expect(onChange).toHaveBeenCalledOnce();
		expect(onChange).toHaveBeenCalledWith('Rogue');
	});

	it('applies gold border class to selected character', () => {
		render(<ChampionGrid value="Rogue" onChange={() => {}} />, { withAuth: false });

		const rogueBtn = screen.getByRole('button', { name: /select rogue/i });
		expect(rogueBtn).toHaveClass('border-gold-400');
	});

	it('applies dimmed class to unselected character', () => {
		render(<ChampionGrid value="Knight" onChange={() => {}} />, { withAuth: false });

		const rogueBtn = screen.getByRole('button', { name: /select rogue/i });
		expect(rogueBtn).toHaveClass('opacity-60');
	});
});
