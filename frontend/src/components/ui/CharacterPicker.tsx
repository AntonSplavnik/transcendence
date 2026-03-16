import ModelPreview from './ModelPreview';

export type CharacterChoice = 'knight' | 'rogue';

const MODEL_DIR='/scenes/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/';

interface CharacterOption {
	id: CharacterChoice;
	label: string;
	modelFile: string;
	bgColor: string;
}

const characters: CharacterOption[] = [
	{
		id: 'knight',
		label: 'Knight',
		modelFile: 'Knight.glb',
		bgColor: '#18a880',
	},
	{
		id: 'rogue',
		label: 'Rogue',
		modelFile: 'Rogue.glb',
		bgColor: '#582880',
	},
];

export interface CharacterPickerProps {
	value: CharacterChoice | null;
	onChange: (character: CharacterChoice) => void;
}

export default function CharacterPicker({ value, onChange }: CharacterPickerProps) {
	return (
		<section aria-label="Character selection" className="mb-4">
			<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
				Choose Your Champion
			</h2>
			<div className="flex gap-3">
				{characters.map((char) => (
					<button
						key={char.id}
						type="button"
						aria-label={`Select ${char.label}`}
						aria-pressed={value === char.id}
						className={`
							flex-1 flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all duration-200 cursor-pointer border-2 bg-stone-900/60
							${value === char.id
								? 'border-gold-400 shadow-[0_0_16px_2px_rgba(217,119,6,0.35)]'
								: 'border-stone-700 hover:border-stone-500'
							}
						`}
						onClick={() => onChange(char.id)}
					>
						<div className="w-full h-[140px] rounded overflow-hidden">
							<ModelPreview
								modelDir={MODEL_DIR}
								modelFile={char.modelFile}
								bgColor={char.bgColor}
							/>
						</div>
						<span className={`text-sm font-semibold tracking-wide transition-colors duration-200 ${
							value === char.id ? 'text-gold-400' : 'text-stone-400'
						}`}>
							{char.label}
						</span>
					</button>
				))}
			</div>
		</section>
	);
}
