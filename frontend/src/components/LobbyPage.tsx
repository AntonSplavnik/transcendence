import { Check, ChevronLeft, Copy, LogOut, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import type { LobbySettings } from '../contexts/LobbyContext';
import { useLobby } from '../contexts/LobbyContext';
import { DEFAULT_CHARACTER } from '@/game/characterConfigs';
import type { CharacterChoice } from '../components/ui';
import {
	Badge,
	Button,
	CharacterSelector,
	Input,
	PlayerAvatarRow,
} from './ui';

// ─── Game modes ───────────────────────────────────────────────────────────────

const GAME_MODES = [
	{ id: 'Deathmatch', label: 'Deathmatch' },
	{ id: 'LastStanding', label: 'Last Standing' },
	{ id: 'WaveSurvival', label: 'Wave Survival' },
	{ id: 'TeamDeathmatch', label: 'Team Deathmatch' },
] as const;

// ─── Settings Edit Form ───────────────────────────────────────────────────────

interface SettingsFormProps {
	settings: LobbySettings;
	onSave(patch: Partial<LobbySettings>): Promise<void>;
	onCancel(): void;
}

function SettingsForm({ settings, onSave, onCancel }: SettingsFormProps) {
	const [name, setName] = useState(settings.name);
	// Settings only shown for private lobbies; user may promote to public (one-way).
	const [makePublic, setMakePublic] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSave = async () => {
		const patch: Partial<LobbySettings> = {};
		if (name.trim() && name.trim() !== settings.name) patch.name = name.trim();
		if (makePublic) patch.public = true;

		if (Object.keys(patch).length === 0) {
			onCancel();
			return;
		}

		setIsSaving(true);
		setError(null);
		try {
			await onSave(patch);
			onCancel();
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : 'Failed to save settings.');
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="space-y-3">
			{error && (
				<p className="text-sm text-danger-light rounded bg-danger/10 px-3 py-2" role="alert">
					{error}
				</p>
			)}
			<Input
				label="Lobby name"
				value={name}
				onChange={(e) => setName(e.target.value)}
				maxLength={32}
			/>
			<label className="flex items-start gap-3 cursor-pointer select-none group">
				<input
					type="checkbox"
					checked={makePublic}
					onChange={(e) => setMakePublic(e.target.checked)}
					className="w-4 h-4 mt-0.5 accent-gold-400 shrink-0"
				/>
				<span className="text-sm text-stone-300 group-hover:text-stone-100 transition-colors">
					Make lobby public{' '}
					<span className="text-xs text-stone-500">(cannot be undone)</span>
				</span>
			</label>
			<div className="flex gap-2 pt-1">
				<Button variant="secondary" size="sm" onClick={onCancel} disabled={isSaving}>
					<X className="w-3.5 h-3.5" />
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={() => void handleSave()}
					loading={isSaving}
				>
					Save
				</Button>
			</div>
		</div>
	);
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LobbyPage() {
	const { lobbyState, setReady, setCharacter, updateSettings, leave } = useLobby();
	const { user } = useAuth();

	const codeCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
	const [isLeaving, setIsLeaving] = useState(false);
	const [isTogglingReady, setIsTogglingReady] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [codeCopied, setCodeCopied] = useState(false);
	const [selectedCharacter, setSelectedCharacter] = useState<CharacterChoice>(
		() => (localStorage.getItem('selectedCharacter') as CharacterChoice) ?? DEFAULT_CHARACTER,
	);

	const handleCharacterChange = (char: CharacterChoice) => {
		setSelectedCharacter(char);
		localStorage.setItem('selectedCharacter', char);
		void setCharacter(char);
	};

	useEffect(() => {
		if (lobbyState.status !== 'active' || lobbyState.gameActive) return;
		if (user && !lobbyState.players.has(user.id)) return;
		void setCharacter(selectedCharacter);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Countdown timer — primitive dep avoids interval reset on unrelated updates.
	const countdownMs =
		lobbyState.status === 'active' ? (lobbyState.countdown?.startAt.getTime() ?? null) : null;

	useEffect(() => {
		if (intervalRef.current !== null) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		if (countdownMs === null) {
			setSecondsLeft(null);
			return;
		}
		const tick = () =>
			setSecondsLeft(Math.max(0, Math.ceil((countdownMs - Date.now()) / 1000)));
		tick();
		intervalRef.current = setInterval(tick, 200);
		return () => {
			if (intervalRef.current !== null) clearInterval(intervalRef.current);
		};
	}, [countdownMs]);

	if (lobbyState.status === 'idle') {
		return <Navigate to="/home" replace />;
	}

	const { lobbyId, hostId, settings, players, spectators, gameActive } = lobbyState;
	const myPlayer = user ? players.get(user.id) : undefined;
	const isPlayer = myPlayer !== undefined;
	const isHost = user?.id === hostId;
	const canEditSettings = isHost && !settings.public && !gameActive;

	const handleToggleReady = async () => {
		if (!myPlayer) return;
		setIsTogglingReady(true);
		try {
			await setReady(!myPlayer.ready);
		} finally {
			setIsTogglingReady(false);
		}
	};

	const handleLeave = async () => {
		setIsLeaving(true);
		try {
			await leave();
		} finally {
			setIsLeaving(false);
		}
	};

	const copyCode = () => {
		void navigator.clipboard.writeText(lobbyId);
		setCodeCopied(true);
		if (codeCopiedTimerRef.current !== null) clearTimeout(codeCopiedTimerRef.current);
		codeCopiedTimerRef.current = setTimeout(() => {
			setCodeCopied(false);
			codeCopiedTimerRef.current = null;
		}, 2500);
	};

	const SUFFIX_LEN = 4;
	const DISPLAY_LEN = 12;
	const maskedCode = '•'.repeat(DISPLAY_LEN - SUFFIX_LEN) + lobbyId.slice(-SUFFIX_LEN);

	return (
		<>
		<Link
			to="/home"
			className="fixed top-3 left-3 z-50 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-200 transition-colors"
		>
			<ChevronLeft className="w-4 h-4" aria-hidden="true" />
			Home
		</Link>
		<main className="max-w-screen-xl mx-auto w-full flex flex-col gap-4 pt-4 px-4" style={{ height: 'calc(100vh / 1.12)', zoom: 1.12, overflow: 'hidden' }}>
			{/* ── Top bar ──────────────────────────────────────────────────── */}
			<div className="flex items-center justify-between gap-6 px-4 py-3 bg-stone-900 rounded-2xl">
				{/* Left: name + code (aligned with panel below) */}
				<div className="flex flex-col gap-1.5 min-w-0 shrink-0">
					<div className="flex items-center gap-2">
						<h1 className="text-xl font-bold text-stone-50 truncate">{settings.name}</h1>
						{canEditSettings && (
							<button
								onClick={() => setShowSettings((s) => !s)}
								className="shrink-0 p-1 rounded text-stone-400 hover:text-stone-200 hover:bg-stone-700/50 transition-colors"
								aria-label={showSettings ? 'Cancel editing settings' : 'Edit lobby settings'}
							>
								<Pencil className="w-4 h-4" aria-hidden="true" />
							</button>
						)}
						{settings.public ? (
							<Badge variant="info" size="sm">Public</Badge>
						) : (
							<Badge variant="neutral" size="sm">Private</Badge>
						)}
						{gameActive && (
							<Badge variant="success" dot>Game in progress</Badge>
						)}
					</div>
					<div className="flex items-center gap-1">
						<span className="font-mono text-sm text-stone-600 tracking-wider select-none" aria-label={`Lobby code ending in ${lobbyId.slice(-SUFFIX_LEN)}`}>
							{maskedCode}
						</span>
						<button
							onClick={copyCode}
							className="p-0.5 rounded text-stone-600 hover:text-stone-300 transition-colors"
							aria-label={codeCopied ? 'Lobby code copied' : 'Copy full lobby code'}
						>
							{codeCopied ? (
								<Check className="w-3.5 h-3.5 text-success" aria-hidden="true" />
							) : (
								<Copy className="w-3.5 h-3.5" aria-hidden="true" />
							)}
						</button>
						{codeCopied && (
							<span className="text-sm text-success" aria-live="polite">Copied!</span>
						)}
					</div>
				</div>

				{/* Center: countdown when all ready, otherwise player avatars */}
				<div className="flex-1 flex justify-center items-center">
					{secondsLeft !== null ? (
						<div className="flex flex-col items-center gap-1">
							<span className="text-[8px] text-amber-700 uppercase tracking-widest">
								{players.size} / {players.size} players ready
							</span>
							<div className="flex items-baseline gap-1.5">
								<span className="text-2xl font-black text-gold-400 tabular-nums leading-none">
									{secondsLeft}s
								</span>
								<span className="text-[9px] text-stone-600 tracking-wide">until game starts</span>
							</div>
						</div>
					) : players.size > 0 ? (
						<PlayerAvatarRow players={players} hostId={hostId} />
					) : (
						<span className="text-sm text-stone-500 italic">No players yet.</span>
					)}
					{spectators.size > 0 && secondsLeft === null && (
						<span className="text-xs text-stone-500 ml-4 self-center">
							+{spectators.size} spectator{spectators.size !== 1 ? 's' : ''}
						</span>
					)}
				</div>

				{/* Right: actions */}
				<div className="flex gap-2 shrink-0">
					{isPlayer && !gameActive && (
						<Button
							variant={myPlayer.ready ? 'secondary' : 'success'}
							onClick={() => void handleToggleReady()}
							loading={isTogglingReady}
						>
							{myPlayer.ready ? 'Unready' : 'Ready Up'}
						</Button>
					)}
					<Button
						variant="ghost"
						onClick={() => void handleLeave()}
						loading={isLeaving}
						icon={<LogOut className="w-5 h-5" aria-hidden="true" />}
					>
						Leave
					</Button>
				</div>
			</div>

			{/* Settings editor (host only) */}
			{showSettings && canEditSettings && (
				<div className="px-6 py-3 bg-stone-900/50 border-b border-stone-800">
					<SettingsForm
						settings={settings}
						onSave={updateSettings}
						onCancel={() => setShowSettings(false)}
					/>
				</div>
			)}

			{/* ── Game mode row ─────────────────────────────────────────────── */}
			{!gameActive && (
				<div className="flex items-center gap-4 px-4 py-3 bg-stone-950 rounded-2xl border border-stone-800">
					<span className="text-xs text-stone-500 uppercase tracking-widest shrink-0">
						Game Mode
					</span>
					<div className="flex gap-2 flex-wrap">
						{GAME_MODES.map((mode) => {
							const active = settings.gamemode === mode.id;
							return (
								<button
									key={mode.id}
									type="button"
									disabled={!isHost}
									onClick={() => {
										if (isHost) void updateSettings({ gamemode: mode.id });
									}}
									className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all duration-150 ${
										active
											? 'border-gold-400 bg-gold-400/10 text-gold-400'
											: isHost
												? 'border-stone-700 text-stone-500 hover:border-stone-500 hover:text-stone-300 cursor-pointer'
												: 'border-stone-800 text-stone-600 cursor-default'
									}`}
								>
									{mode.label}
								</button>
							);
						})}
					</div>
				</div>
			)}

			{/* ── Character selector ────────────────────────────────────────── */}
			{isPlayer && !gameActive && (
				<div className="flex min-h-0 rounded-2xl overflow-hidden mt-3" style={{ maxHeight: '480px' }}>
					<CharacterSelector
						value={selectedCharacter}
						onChange={handleCharacterChange}
					/>
				</div>
			)}
		</main>
		</>
	);
}
