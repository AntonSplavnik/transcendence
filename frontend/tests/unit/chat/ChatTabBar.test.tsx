import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatTabBar from '../../../src/components/chat/ChatTabBar';
import type { ChatRoomState } from '../../../src/chat/types';

// ─── Mock ChatContext ────────────────────────────────────────────────────────

const mockSetActiveRoomId = vi.fn();

let mockRooms: Map<string, Partial<ChatRoomState>>;
let mockOrderedRoomIds: string[];
let mockActiveRoomId: string | null;

vi.mock('../../../src/contexts/ChatContext', () => ({
	useChat: vi.fn(() => ({
		rooms: mockRooms,
		orderedRoomIds: mockOrderedRoomIds,
		activeRoomId: mockActiveRoomId,
		setActiveRoomId: mockSetActiveRoomId,
	})),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRoom(overrides: Partial<ChatRoomState> = {}): Partial<ChatRoomState> {
	return {
		chatType: 'Global',
		name: null,
		members: null,
		nicks: new Map(),
		messages: [],
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ChatTabBar', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRooms = new Map();
		mockOrderedRoomIds = [];
		mockActiveRoomId = null;
	});

	it('renders nothing when no rooms exist', () => {
		const { container } = render(<ChatTabBar currentUserId={1} />);
		expect(container.firstChild).toBeNull();
	});

	it('renders tabs with correct ARIA attributes', () => {
		mockRooms.set('r1', makeRoom({ chatType: 'Global' }));
		mockRooms.set('r2', makeRoom({ chatType: 'GameLobby', name: 'Arena' }));
		mockOrderedRoomIds = ['r1', 'r2'];
		mockActiveRoomId = 'r1';

		render(<ChatTabBar currentUserId={1} />);

		const tablist = screen.getByRole('tablist', { name: 'Chat rooms' });
		expect(tablist).toBeInTheDocument();

		const tabs = screen.getAllByRole('tab');
		expect(tabs).toHaveLength(2);
		expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
		expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
	});

	it('renders "Global" label for Global rooms', () => {
		mockRooms.set('r1', makeRoom({ chatType: 'Global' }));
		mockOrderedRoomIds = ['r1'];
		mockActiveRoomId = 'r1';

		render(<ChatTabBar currentUserId={1} />);
		expect(screen.getByText('Global')).toBeInTheDocument();
	});

	it('renders DM tab with other user nickname', () => {
		mockRooms.set('dm1', makeRoom({
			chatType: 'Dm',
			members: [{ user_id: 1, last_read_message_id: null, joined_at: '' }, { user_id: 2, last_read_message_id: null, joined_at: '' }],
			nicks: new Map([[2, 'Bob']]),
		}));
		mockOrderedRoomIds = ['dm1'];
		mockActiveRoomId = 'dm1';

		render(<ChatTabBar currentUserId={1} />);
		expect(screen.getByText('@Bob')).toBeInTheDocument();
	});

	it('clicking a tab calls setActiveRoomId', async () => {
		const user = userEvent.setup();
		mockRooms.set('r1', makeRoom({ chatType: 'Global' }));
		mockRooms.set('r2', makeRoom({ chatType: 'GameLobby', name: 'Arena' }));
		mockOrderedRoomIds = ['r1', 'r2'];
		mockActiveRoomId = 'r1';

		render(<ChatTabBar currentUserId={1} />);

		const lobbyTab = screen.getByRole('tab', { name: /Arena/ });
		await user.click(lobbyTab);

		expect(mockSetActiveRoomId).toHaveBeenCalledWith('r2');
	});

	describe('overflow chevrons', () => {
		it('shows chevrons when more than 4 tabs', () => {
			for (let i = 0; i < 6; i++) {
				mockRooms.set(`r${i}`, makeRoom({ chatType: 'InviteOnly', name: `Room${i}` }));
			}
			mockOrderedRoomIds = [...mockRooms.keys()];
			mockActiveRoomId = 'r0';

			render(<ChatTabBar currentUserId={1} />);

			// Only 4 visible tabs.
			expect(screen.getAllByRole('tab')).toHaveLength(4);
			// Right chevron visible.
			expect(screen.getByRole('button', { name: 'Show next tabs' })).toBeInTheDocument();
		});

		it('clicking right chevron reveals next tab', async () => {
			const user = userEvent.setup();
			for (let i = 0; i < 6; i++) {
				mockRooms.set(`r${i}`, makeRoom({ chatType: 'InviteOnly', name: `Room${i}` }));
			}
			mockOrderedRoomIds = [...mockRooms.keys()];
			mockActiveRoomId = 'r0';

			render(<ChatTabBar currentUserId={1} />);

			// Room4 is not visible initially (indices 0-3 shown).
			expect(screen.queryByText('Room4')).not.toBeInTheDocument();

			await user.click(screen.getByRole('button', { name: 'Show next tabs' }));
			expect(screen.getByText('Room4')).toBeInTheDocument();
		});
	});

	describe('truncation', () => {
		it('truncates long room names', () => {
			mockRooms.set('r1', makeRoom({ chatType: 'InviteOnly', name: 'VeryLongRoomName' }));
			mockOrderedRoomIds = ['r1'];
			mockActiveRoomId = 'r1';

			render(<ChatTabBar currentUserId={1} />);
			expect(screen.getByText('VeryLon…')).toBeInTheDocument();
		});
	});
});
