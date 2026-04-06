import { describe, it, expect } from 'vitest';
import { render, screen } from '../../helpers/render';
import PlayerAvatarRow from '../../../src/components/ui/PlayerAvatarRow';

const makePlayers = (entries: [number, { nickname: string; ready: boolean }][]) =>
	new Map(entries) as ReadonlyMap<number, { nickname: string; ready: boolean }>;

describe('PlayerAvatarRow', () => {
	it('renders initials for each player', () => {
		const players = makePlayers([
			[1, { nickname: 'Anton', ready: true }],
			[2, { nickname: 'Player2', ready: false }],
		]);
		render(<PlayerAvatarRow players={players} hostId={1} />, { withAuth: false });

		expect(screen.getByText('AN')).toBeInTheDocument();
		expect(screen.getByText('PL')).toBeInTheDocument();
	});

	it('shows player names below avatars', () => {
		const players = makePlayers([[1, { nickname: 'Anton', ready: true }]]);
		render(<PlayerAvatarRow players={players} hostId={1} />, { withAuth: false });

		expect(screen.getByText('Anton')).toBeInTheDocument();
	});

	it('shows ready count in header', () => {
		const players = makePlayers([
			[1, { nickname: 'A', ready: true }],
			[2, { nickname: 'B', ready: true }],
			[3, { nickname: 'C', ready: false }],
		]);
		render(<PlayerAvatarRow players={players} hostId={1} />, { withAuth: false });

		expect(screen.getByText(/2 ready/i)).toBeInTheDocument();
	});

	it('applies gold border to host avatar', () => {
		const players = makePlayers([[1, { nickname: 'Anton', ready: true }]]);
		const { container } = render(
			<PlayerAvatarRow players={players} hostId={1} />,
			{ withAuth: false }
		);

		const avatarDiv = container.querySelector('[data-testid="avatar-1"]');
		expect(avatarDiv).toHaveClass('border-gold-400');
	});

	it('applies success border to ready non-host player', () => {
		const players = makePlayers([[2, { nickname: 'Bob', ready: true }]]);
		const { container } = render(
			<PlayerAvatarRow players={players} hostId={1} />,
			{ withAuth: false }
		);

		const avatarDiv = container.querySelector('[data-testid="avatar-2"]');
		expect(avatarDiv).toHaveClass('border-success');
	});

	it('applies warning border to not-ready player', () => {
		const players = makePlayers([[2, { nickname: 'Bob', ready: false }]]);
		const { container } = render(
			<PlayerAvatarRow players={players} hostId={1} />,
			{ withAuth: false }
		);

		const avatarDiv = container.querySelector('[data-testid="avatar-2"]');
		expect(avatarDiv).toHaveClass('border-warning');
	});
});
