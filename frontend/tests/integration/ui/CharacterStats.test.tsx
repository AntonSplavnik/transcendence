import { describe, it, expect } from 'vitest';
import { render, screen } from '../../helpers/render';
import CharacterStats from '../../../src/components/ui/CharacterStats';

describe('CharacterStats', () => {
	it('shows a prompt when no character selected', () => {
		render(<CharacterStats character={null} />, { withAuth: false });

		expect(screen.getByText(/select a champion/i)).toBeInTheDocument();
	});

	it('renders knight name and class', () => {
		render(<CharacterStats character="Knight" />, { withAuth: false });

		expect(screen.getByText('Knight')).toBeInTheDocument();
		expect(screen.getByText('Warrior')).toBeInTheDocument();
	});

	it('renders rogue name and class', () => {
		render(<CharacterStats character="Rogue" />, { withAuth: false });

		expect(screen.getByText('Rogue')).toBeInTheDocument();
		expect(screen.getByText('Assassin')).toBeInTheDocument();
	});

	it('renders all four stat labels', () => {
		render(<CharacterStats character="Knight" />, { withAuth: false });

		expect(screen.getByText(/attack/i)).toBeInTheDocument();
		expect(screen.getByText(/defense/i)).toBeInTheDocument();
		expect(screen.getByText(/speed/i)).toBeInTheDocument();
		expect(screen.getByText(/health/i)).toBeInTheDocument();
	});

	it('renders weapon names for knight', () => {
		render(<CharacterStats character="Knight" />, { withAuth: false });

		expect(screen.getByText('Sword')).toBeInTheDocument();
		expect(screen.getByText('Shield')).toBeInTheDocument();
	});

	it('renders weapon names for rogue', () => {
		render(<CharacterStats character="Rogue" />, { withAuth: false });

		expect(screen.getByText('Dagger (R)')).toBeInTheDocument();
		expect(screen.getByText('Dagger (L)')).toBeInTheDocument();
	});

	it('renders the character description', () => {
		render(<CharacterStats character="Knight" />, { withAuth: false });

		expect(
			screen.getByText('Durable front-liner. High armor, slow movement.')
		).toBeInTheDocument();
	});
});
