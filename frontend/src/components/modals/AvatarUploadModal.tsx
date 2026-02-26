import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { uploadAvatar, deleteAvatar } from '../../api/avatar';
import { updateDescription } from '../../api/user';
import { validateAvatarFile, validateDescription } from '../../utils/validation';
import { convertToAvatarAvif } from '../../utils/avatarConverter';
import type { User } from '../../api/types';
import AvatarDisplay from '../ui/AvatarDisplay';
import { Button, Modal, Alert } from '../ui';

interface EditProfileProps {
	user: User;
	description: string;
	onClose: () => void;
	onAvatarChanged: (smallUrl: string | null, largeUrl: string | null) => void;
	onDescriptionChanged: (description: string) => void;
}

export default function AvatarUploadModal({ user, description, onClose, onAvatarChanged, onDescriptionChanged }: EditProfileProps) {
	const [avatarLoading, setAvatarLoading] = useState(false);
	const [descriptionLoading, setDescriptionLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [descriptionError, setDescriptionError] = useState<string | null>(null);
	const [descriptionValue, setDescriptionValue] = useState(description);
	const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
	const fileInputRef = useRef<HTMLInputElement>(null);

	async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;

		const fileErr = validateAvatarFile(file);
		if (fileErr) {
			setError(fileErr);
			if (fileInputRef.current) fileInputRef.current.value = '';
			return;
		}

		setAvatarLoading(true);
		setError(null);
		try {
			const result = await convertToAvatarAvif(file);
			if (!result.success) {
				setError(result.error.message);
				return;
			}
			await uploadAvatar(result.data.large, result.data.small);
			const smallUrl = URL.createObjectURL(result.data.small);
			const largeUrl = URL.createObjectURL(result.data.large);
			setPreviewUrl(largeUrl);
			onAvatarChanged(smallUrl, largeUrl);
		} catch {
			setError("Failed to upload avatar");
		} finally {
			setAvatarLoading(false);
			if (fileInputRef.current) fileInputRef.current.value = '';
		}
	}

	async function handleDelete() {
		setAvatarLoading(true);
		setError(null);
		try {
			await deleteAvatar();
			setPreviewUrl(undefined);
			onAvatarChanged(null, null);
		} catch {
			setError("Failed to delete avatar");
		} finally {
			setAvatarLoading(false);
		}
	}

	async function handleSave() {
		const validationErr = validateDescription(descriptionValue);
		if (validationErr) {
			setDescriptionError(validationErr);
			return;
		}

		const descriptionChanged = descriptionValue !== description;
		if (descriptionChanged) {
			setDescriptionLoading(true);
			setError(null);
			try {
				await updateDescription(descriptionValue);
				onDescriptionChanged(descriptionValue);
			} catch {
				setError("Failed to update description");
				setDescriptionLoading(false);
				return;
			}
		}
		onClose();
	}

	return (
		<Modal
			onClose={onClose}
			title="Edit Profile"
			icon={<Pencil className="w-6 h-6" />}
		>
			{/* Clickable Avatar */}
			<div className="flex flex-col items-center gap-1 mb-4">
				<button
					type="button"
					onClick={() => fileInputRef.current?.click()}
					disabled={avatarLoading}
					className="relative group rounded-full disabled:opacity-50"
				>
					<AvatarDisplay userId={user.id} size="large" src={previewUrl} className="w-32 h-32 rounded-full" />
					<div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
						<span className="text-white text-sm font-medium">Edit</span>
					</div>
				</button>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					onChange={handleFileSelect}
					className="hidden"
				/>
				<button
					onClick={handleDelete}
					disabled={avatarLoading}
					className="text-danger hover:text-danger-light text-xs italic disabled:opacity-50 transition-colors"
				>
					x delete
				</button>
			</div>

			{/* Description Section */}
			<div className="space-y-3">
				<div>
					<label htmlFor="description" className="block text-sm text-stone-300 mb-1">Description</label>
					<textarea
						id="description"
						value={descriptionValue}
						onChange={(e) => { setDescriptionValue(e.target.value); setDescriptionError(null); }}
						rows={2}
						className={`w-full bg-stone-800 border rounded-lg px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:outline-none resize-none ${descriptionError ? 'border-red-500 focus:border-red-400' : 'border-stone-600 focus:border-stone-400'}`}
						placeholder="Pineapple on pizza ?"
					/>
					<div className="flex justify-between items-center">
						{descriptionError
							? <p className="text-xs text-red-400">{descriptionError}</p>
							: <span />
						}
						<p className="text-xs text-stone-500">{[...descriptionValue].length}/50</p>
					</div>
				</div>

				{error && (
					<Alert variant="error" dismissable onDismiss={() => setError(null)}>
						{error}
					</Alert>
				)}

				<Button
					onClick={handleSave}
					disabled={descriptionLoading}
					loading={descriptionLoading}
					loadingText="Saving..."
					fullWidth
				>
					Save
				</Button>
			</div>
		</Modal>
	);
}
