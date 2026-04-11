import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, userEvent } from '../../helpers/render';
import AudioSettingsModal from '../../../src/components/modals/AudioSettingsModal';

// Stub out the audio engine — the modal only needs the handle's setters,
// which we spy on to verify live preview dispatch.
const setBusVolume = vi.fn();
const setMuted = vi.fn();

vi.mock('../../../src/audio/AudioProvider', () => ({
	useUIAudio: () => ({
		isReady: true,
		playSound: vi.fn(),
		playMusic: vi.fn(),
		stopMusic: vi.fn(),
		playAmbient: vi.fn(),
		stopAmbient: vi.fn(),
		setBusVolume,
		setMuted,
	}),
}));

const STORAGE_KEY = 'transcendence.audio_settings';

describe('AudioSettingsModal', () => {
	const onClose = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	const renderModal = () => render(<AudioSettingsModal onClose={onClose} />);

	// ─── Render ────────────────────────────────────────────────────────────────

	it('renders with the "Audio Settings" title', () => {
		renderModal();
		expect(screen.getByRole('heading', { name: /audio settings/i })).toBeInTheDocument();
	});

	it('renders Music, UI and Game Volume sliders with associated labels', () => {
		renderModal();
		const music = screen.getByLabelText('Music Volume');
		const ui = screen.getByLabelText('UI Volume');
		const game = screen.getByLabelText('Game Volume');
		expect(music).toHaveAttribute('type', 'range');
		expect(ui).toHaveAttribute('type', 'range');
		expect(game).toHaveAttribute('type', 'range');
	});

	it('groups sliders into Menu and In-Game sections', () => {
		renderModal();
		// Region grouping via aria-labelledby
		expect(screen.getByRole('heading', { name: /^menu$/i })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: /^in-game$/i })).toBeInTheDocument();
	});

	it('renders the mute checkbox', () => {
		renderModal();
		expect(screen.getByRole('checkbox', { name: /mute all sounds/i })).toBeInTheDocument();
	});

	// ─── Defaults ──────────────────────────────────────────────────────────────

	it('shows default values when nothing is stored', () => {
		renderModal();
		// Defaults: music 0.5 → 50%, ui 0.7 → 70%, inGame 1.0 → 100%
		expect(screen.getByLabelText('Music Volume')).toHaveValue('50');
		expect(screen.getByLabelText('UI Volume')).toHaveValue('70');
		expect(screen.getByLabelText('Game Volume')).toHaveValue('100');
		expect(screen.getByRole('checkbox', { name: /mute all sounds/i })).not.toBeChecked();
	});

	it('loads persisted settings on mount', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				musicVolume: 0.1,
				uiVolume: 0.9,
				inGameVolume: 0.35,
				muted: true,
			}),
		);
		renderModal();
		expect(screen.getByLabelText('Music Volume')).toHaveValue('10');
		expect(screen.getByLabelText('UI Volume')).toHaveValue('90');
		expect(screen.getByLabelText('Game Volume')).toHaveValue('35');
		expect(screen.getByRole('checkbox', { name: /mute all sounds/i })).toBeChecked();
	});

	// ─── Live preview + persistence ────────────────────────────────────────────

	it('dispatches and persists music volume changes', () => {
		renderModal();
		fireEvent.change(screen.getByLabelText('Music Volume'), { target: { value: '25' } });

		expect(setBusVolume).toHaveBeenCalledWith('music', 0.25);
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(stored.musicVolume).toBe(0.25);
	});

	it('dispatches and persists UI volume changes', () => {
		renderModal();
		fireEvent.change(screen.getByLabelText('UI Volume'), { target: { value: '80' } });

		expect(setBusVolume).toHaveBeenCalledWith('ui', 0.8);
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(stored.uiVolume).toBe(0.8);
	});

	it('dispatches in-game volume to BOTH sfx and ambient buses and persists', () => {
		renderModal();
		fireEvent.change(screen.getByLabelText('Game Volume'), { target: { value: '40' } });

		expect(setBusVolume).toHaveBeenCalledWith('sfx', 0.4);
		expect(setBusVolume).toHaveBeenCalledWith('ambient', 0.4);
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(stored.inGameVolume).toBe(0.4);
	});

	it('dispatches and persists mute toggle', async () => {
		const user = userEvent.setup();
		renderModal();
		const mute = screen.getByRole('checkbox', { name: /mute all sounds/i });

		await user.click(mute);
		expect(setMuted).toHaveBeenCalledWith(true);
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).muted).toBe(true);

		await user.click(mute);
		expect(setMuted).toHaveBeenLastCalledWith(false);
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).muted).toBe(false);
	});

	// ─── Disabled state while muted ────────────────────────────────────────────

	it('disables all sliders while muted', async () => {
		const user = userEvent.setup();
		renderModal();
		await user.click(screen.getByRole('checkbox', { name: /mute all sounds/i }));

		expect(screen.getByLabelText('Music Volume')).toBeDisabled();
		expect(screen.getByLabelText('UI Volume')).toBeDisabled();
		expect(screen.getByLabelText('Game Volume')).toBeDisabled();
	});

	// ─── Close behaviour ───────────────────────────────────────────────────────

	it('calls onClose when the close button is clicked', async () => {
		const user = userEvent.setup();
		renderModal();
		await user.click(screen.getByRole('button', { name: /close dialog/i }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('calls onClose when Escape is pressed', () => {
		renderModal();
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).toHaveBeenCalled();
	});

	// ─── Accessibility ─────────────────────────────────────────────────────────

	it('exposes the dialog role with aria-modal', () => {
		renderModal();
		const dialog = screen.getByRole('dialog');
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
	});

	it('exposes aria-valuetext reflecting the current slider percentage', () => {
		renderModal();
		// Defaults: 50% / 70%
		expect(screen.getByLabelText('Music Volume')).toHaveAttribute(
			'aria-valuetext',
			'50 percent',
		);
		expect(screen.getByLabelText('UI Volume')).toHaveAttribute('aria-valuetext', '70 percent');
	});

	it('updates aria-valuetext as the slider moves', () => {
		renderModal();
		fireEvent.change(screen.getByLabelText('Music Volume'), { target: { value: '0' } });
		expect(screen.getByLabelText('Music Volume')).toHaveAttribute(
			'aria-valuetext',
			'0 percent',
		);
	});

	it('exposes accessible percent text next to each slider', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ musicVolume: 0.3, uiVolume: 0.6, muted: false }),
		);
		renderModal();
		expect(screen.getByText('30%')).toBeInTheDocument();
		expect(screen.getByText('60%')).toBeInTheDocument();
	});
});
