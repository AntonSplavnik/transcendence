import { Check, ChevronLeft, Clock, Copy, Crown, LogOut, Pencil, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import type { LobbySettings } from '../contexts/LobbyContext';
import { useLobby } from '../contexts/LobbyContext';
import { DEFAULT_CHARACTER } from '@/game/characterConfigs';
import type { CharacterChoice } from './ui';
import { Badge, Button, Card, CharacterPicker, Input } from './ui';

// ─── Settings Edit Form ───────────────────────────────────────────────────────

interface SettingsFormProps {
	settings: LobbySettings;
	onSave(patch: Partial<LobbySettings>): Promise<void>;
	onCancel(): void;
}

function SettingsForm({ settings, onSave, onCancel }: SettingsFormProps) {
	const [name, setName] = useState(settings.name);
	const [gamemode, setGamemode] = useState(settings.gamemode);
	// Settings only shown for private lobbies; user may promote to public (one-way).
	const [makePublic, setMakePublic] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSave = async () => {
		const patch: Partial<LobbySettings> = {};
		if (name.trim() && name.trim() !== settings.name) patch.name = name.trim();
		if (gamemode.trim() && gamemode.trim() !== settings.gamemode)
			patch.gamemode = gamemode.trim();
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
				<p
					className="text-sm text-danger-light rounded bg-danger/10 px-3 py-2"
					role="alert"
				>
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
					<span className="text-xs text-stone-500">
						(visible in lobby list — cannot be undone)
					</span>
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
	const { lobbyState, setReady, updateSettings, leave } = useLobby();
	const { user } = useAuth();

	const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const codeCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
	};

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

	// Show last 4 chars of the 26-char ULID; pad with bullets to total 12 display chars.
	const SUFFIX_LEN = 4;
	const DISPLAY_LEN = 12;
	const maskedCode = '•'.repeat(DISPLAY_LEN - SUFFIX_LEN) + lobbyId.slice(-SUFFIX_LEN);

	return (
		<main className="p-6 max-w-2xl mx-auto w-full">
			{/* Back navigation — goes to /home without leaving the lobby */}
			<div className="mb-4">
				<Link
					to="/home"
					className="inline-flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200 transition-colors"
				>
					<ChevronLeft className="w-4 h-4" aria-hidden="true" />
					Back to home
				</Link>
			</div>

			<Card variant="elevated">
				{/* Header */}
				<div className="flex items-start justify-between mb-6">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<h1 className="text-2xl font-bold text-stone-50 truncate">
								{settings.name}
							</h1>
							{canEditSettings && (
								<button
									onClick={() => setShowSettings((s) => !s)}
									className="shrink-0 p-1 rounded text-stone-400 hover:text-stone-200 hover:bg-stone-700/50 transition-colors"
									aria-label={
										showSettings
											? 'Cancel editing settings'
											: 'Edit lobby settings'
									}
									title={showSettings ? 'Cancel edit' : 'Edit settings'}
								>
									<Pencil className="w-4 h-4" aria-hidden="true" />
								</button>
							)}
						</div>

						<p className="text-stone-400 text-sm mt-0.5">
							{settings.gamemode}
							<span className="mx-1.5 text-stone-600">·</span>
							{settings.public ? (
								<Badge variant="info" size="sm">
									Public
								</Badge>
							) : (
								<Badge variant="neutral" size="sm">
									Private
								</Badge>
							)}
						</p>

						{/* Masked lobby code with copy button */}
						<div className="mt-1.5 flex items-center gap-1">
							<span
								className="font-mono text-xs text-stone-500 tracking-wider select-none"
								title="Click the copy icon to copy the full lobby code"
								aria-label={`Lobby code ending in ${lobbyId.slice(-SUFFIX_LEN)}`}
							>
								{maskedCode}
							</span>
							<button
								onClick={copyCode}
								className="p-0.5 rounded text-stone-500 hover:text-stone-300 transition-colors"
								aria-label={
									codeCopied ? 'Lobby code copied' : 'Copy full lobby code'
								}
								title={codeCopied ? 'Copied!' : 'Copy lobby code'}
							>
								{codeCopied ? (
									<Check
										className="w-3.5 h-3.5 text-success"
										aria-hidden="true"
									/>
								) : (
									<Copy className="w-3.5 h-3.5" aria-hidden="true" />
								)}
							</button>
							{codeCopied && (
								<span className="text-xs text-success" aria-live="polite">
									Copied!
								</span>
							)}
						</div>
					</div>

					<div className="flex flex-col items-end gap-2 shrink-0 ml-4">
						{gameActive && (
							<Badge variant="success" dot>
								Game in progress
							</Badge>
						)}
						{!gameActive && secondsLeft !== null && (
							<div
								className="flex items-center gap-1 text-gold-400"
								aria-label={`Game starts in ${secondsLeft} seconds`}
							>
								<Clock className="w-4 h-4" aria-hidden="true" />
								<span className="text-lg font-bold tabular-nums">
									{secondsLeft}s
								</span>
							</div>
						)}
					</div>
				</div>

				{/* Settings editor (host only, private lobby only) */}
				{showSettings && canEditSettings && (
					<div className="mb-5 rounded-lg border border-stone-700 bg-stone-900/50 p-4">
						<h2 className="text-sm font-semibold text-stone-300 mb-3">Edit Settings</h2>
						<SettingsForm
							settings={settings}
							onSave={updateSettings}
							onCancel={() => setShowSettings(false)}
						/>
					</div>
				)}

				{/* Player list */}
				<section aria-label="Players" className="mb-4">
					<h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">
						<Users className="w-3.5 h-3.5" aria-hidden="true" />
						Players ({players.size})
					</h2>
					{players.size === 0 ? (
						<p className="text-sm text-stone-500 italic">No players yet.</p>
					) : (
						<ul className="space-y-1.5">
							{[...players.entries()].map(([uid, p]) => (
								<li
									key={uid}
									className="flex items-center justify-between rounded-lg bg-stone-800/50 px-3 py-2"
								>
									<span className="flex items-center gap-2 text-sm text-stone-200">
										{uid === hostId && (
											<Crown
												className="w-3.5 h-3.5 text-gold-400 shrink-0"
												aria-label="Host"
											/>
										)}
										{p.nickname}
										{user && uid === user.id && (
											<span className="text-xs text-stone-500">(you)</span>
										)}
									</span>
									{!gameActive && (
										<Badge variant={p.ready ? 'success' : 'warning'} size="sm">
											{p.ready ? 'Ready' : 'Not ready'}
										</Badge>
									)}
								</li>
							))}
						</ul>
					)}
				</section>

				{/* Spectators */}
				{spectators.size > 0 && (
					<p className="mb-4 text-sm text-stone-400">
						{spectators.size} spectator{spectators.size !== 1 ? 's' : ''} watching
					</p>
				)}

				{/* Character selection */}
				{isPlayer && !gameActive && (
					<CharacterPicker value={selectedCharacter} onChange={handleCharacterChange} />
				)}

				{/* Actions */}
				<div className="flex gap-3 border-t border-stone-700 pt-4">
					{isPlayer && !gameActive && (
						<Button
							variant={myPlayer.ready ? 'secondary' : 'primary'}
							onClick={() => void handleToggleReady()}
							loading={isTogglingReady}
							fullWidth
						>
							{myPlayer.ready ? 'Unready' : 'Ready Up'}
						</Button>
					)}
					<Button
						variant="danger"
						onClick={() => void handleLeave()}
						loading={isLeaving}
						icon={<LogOut className="w-4 h-4" aria-hidden="true" />}
						fullWidth={!isPlayer || gameActive}
					>
						Leave
					</Button>
				</div>
			</Card>
		</main>
	);
}
