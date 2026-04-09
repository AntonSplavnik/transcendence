import { Volume2, VolumeX } from 'lucide-react';
import { useState } from 'react';

import { useUIAudio } from '../../audio/AudioProvider';
import { loadAudioSettings, saveAudioSettings } from '../../audio/audioSettings';
import type { AudioSettings } from '../../audio/audioSettings';
import { Modal } from '../ui';

interface AudioSettingsModalProps {
	onClose: () => void;
}

/**
 * Audio preferences modal — music & UI volumes plus a global mute.
 *
 * Live preview: every slider change applies immediately via the AudioProvider
 * and is persisted to localStorage so the setting survives reloads.
 */
export default function AudioSettingsModal({ onClose }: AudioSettingsModalProps) {
	const audio = useUIAudio();
	const [settings, setSettings] = useState<AudioSettings>(() => loadAudioSettings());

	const update = (patch: Partial<AudioSettings>) => {
		const next = { ...settings, ...patch };
		setSettings(next);
		saveAudioSettings(next);

		if (patch.musicVolume !== undefined) {
			audio.setBusVolume('music', patch.musicVolume);
		}
		if (patch.uiVolume !== undefined) {
			audio.setBusVolume('ui', patch.uiVolume);
		}
		if (patch.muted !== undefined) {
			audio.setMuted(patch.muted);
		}
	};

	const disabled = settings.muted;

	return (
		<Modal onClose={onClose} title="Audio Settings" icon={<Volume2 className="w-6 h-6" />}>
			<div className="space-y-5">
				{/* Music slider */}
				<VolumeSlider
					id="music-volume"
					label="Music Volume"
					value={settings.musicVolume}
					disabled={disabled}
					onChange={(v) => update({ musicVolume: v })}
				/>

				{/* UI sounds slider */}
				<VolumeSlider
					id="ui-volume"
					label="UI Volume"
					value={settings.uiVolume}
					disabled={disabled}
					onChange={(v) => update({ uiVolume: v })}
				/>

				{/* Mute toggle */}
				<label className="flex items-center justify-between gap-3 rounded-lg bg-stone-800/60 border border-stone-700 px-4 py-3 cursor-pointer hover:border-stone-500 transition-colors">
					<span className="flex items-center gap-2 text-sm text-stone-200">
						{settings.muted ? (
							<VolumeX className="w-4 h-4 text-stone-400" aria-hidden="true" />
						) : (
							<Volume2 className="w-4 h-4 text-stone-400" aria-hidden="true" />
						)}
						Mute all sounds
					</span>
					<input
						type="checkbox"
						checked={settings.muted}
						onChange={(e) => update({ muted: e.target.checked })}
						className="w-4 h-4 accent-gold-400 cursor-pointer"
					/>
				</label>
			</div>
		</Modal>
	);
}

// ─── Slider sub-component ─────────────────────────────────────────────────────

interface VolumeSliderProps {
	id: string;
	label: string;
	value: number;
	disabled: boolean;
	onChange: (value: number) => void;
}

function VolumeSlider({ id, label, value, disabled, onChange }: VolumeSliderProps) {
	const percent = Math.round(value * 100);
	// Two-stop gradient driven by the current value — fills the track up to the thumb
	// with gold-400, then fades to stone-800. Works in WebKit & Firefox.
	const trackBackground = `linear-gradient(to right, #e0a030 0%, #e0a030 ${percent}%, #292524 ${percent}%, #292524 100%)`;

	return (
		<div>
			<div className="flex justify-between items-center mb-1.5">
				<label htmlFor={id} className="text-sm text-stone-300">
					{label}
				</label>
				<span className="text-xs text-stone-400 tabular-nums">{percent}%</span>
			</div>
			<input
				id={id}
				type="range"
				min={0}
				max={100}
				step={1}
				value={percent}
				disabled={disabled}
				onChange={(e) => onChange(Number(e.target.value) / 100)}
				aria-valuetext={`${percent} percent`}
				style={{ background: trackBackground }}
				className={`volume-slider w-full h-2 rounded-lg appearance-none cursor-pointer ${
					disabled ? 'opacity-40 cursor-not-allowed' : ''
				}`}
			/>
		</div>
	);
}
