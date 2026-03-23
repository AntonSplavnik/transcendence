import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { uploadAvatar, deleteAvatar } from '../../api/avatar';
import { updateDescription } from '../../api/user';
import { validateAvatarFile, validateDescription } from '../../utils/validation';
import { getErrorMessage } from '../../api/error';
import { convertToAvatarAvif } from '../../utils/avatarConverter';
import type { AvatarVariants } from '../../utils/avatarConverter';
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

export default function EditUserModal({
	user,
	description,
	onClose,
	onAvatarChanged,
	onDescriptionChanged,
}: EditProfileProps) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [descriptionError, setDescriptionError] = useState<string | null>(null);
	const [descriptionValue, setDescriptionValue] = useState(description);
	// undefined = fetch from server, null = show default icon (pending delete), string = preview URL
	const [previewUrl, setPreviewUrl] = useState<string | null | undefined>(undefined);
	const [pendingAvatar, setPendingAvatar] = useState<AvatarVariants | null>(null);
	const [pendingDelete, setPendingDelete] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		return () => {
			if (previewUrl) URL.revokeObjectURL(previewUrl);
		};
	}, [previewUrl]);

	async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;

		const fileErr = validateAvatarFile(file);
		if (fileErr) {
			setError(fileErr);
			if (fileInputRef.current) fileInputRef.current.value = '';
			return;
		}

		setError(null);
		const result = await convertToAvatarAvif(file);
		if (!result.success) {
			setError(result.error.message);
			if (fileInputRef.current) fileInputRef.current.value = '';
			return;
		}

		setPendingDelete(false);
		setPendingAvatar(result.data);
		setPreviewUrl(URL.createObjectURL(result.data.large));
		if (fileInputRef.current) fileInputRef.current.value = '';
	}

	function handleDelete() {
		setPendingAvatar(null);
		setPendingDelete(true);
		setPreviewUrl(null);
		setError(null);
	}

	async function handleSave() {
		const validationErr = validateDescription(descriptionValue);
		if (validationErr) {
			setDescriptionError(validationErr);
			return;
		}

		const descriptionChanged = descriptionValue !== description;
		const hasAvatarChange = pendingAvatar !== null || pendingDelete;

		if (!descriptionChanged && !hasAvatarChange) {
			onClose();
			return;
		}

		setLoading(true);
		setError(null);
		try {
			// Collect callbacks so parent state is only updated after all operations succeed.
			let avatarCallback: (() => void) | null = null;

			if (pendingAvatar) {
				await uploadAvatar(pendingAvatar.large, pendingAvatar.small);
				const smallUrl = URL.createObjectURL(pendingAvatar.small);
				const largeUrl = URL.createObjectURL(pendingAvatar.large);
				avatarCallback = () => onAvatarChanged(smallUrl, largeUrl);
			} else if (pendingDelete) {
				await deleteAvatar();
				avatarCallback = () => onAvatarChanged(null, null);
			}

			if (descriptionChanged) {
				await updateDescription(descriptionValue);
				onDescriptionChanged(descriptionValue);
			}

			avatarCallback?.();
			onClose();
		} catch (err) {
			setError(getErrorMessage(err, 'Failed to save changes'));
		} finally {
			setLoading(false);
		}
	}

	return (
		<Modal
			onClose={onClose}
			title="Edit Profile"
			icon={<Pencil className="w-6 h-6" />}
			closable={!loading}
		>
			{/* Clickable Avatar */}
			<div className="flex flex-col items-center gap-1 mb-4">
				<button
					type="button"
					onClick={() => fileInputRef.current?.click()}
					disabled={loading}
					aria-label="Change avatar"
					className="relative group rounded-full disabled:opacity-50"
				>
					<AvatarDisplay
						userId={user.id}
						size="large"
						src={previewUrl}
						alt={`${user.nickname}'s avatar`}
						className="w-32 h-32 rounded-full"
					/>
					<div
						aria-hidden="true"
						className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
					>
						<span className="text-white text-sm font-medium">Edit</span>
					</div>
				</button>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					onChange={handleFileSelect}
					className="hidden"
					aria-hidden="true"
					tabIndex={-1}
				/>
				<button
					type="button"
					onClick={handleDelete}
					disabled={loading}
					aria-label="Delete current avatar"
					className="text-danger hover:text-danger-light text-xs italic disabled:opacity-50 transition-colors"
				>
					x delete
				</button>
			</div>

			{/* Description Section */}
			<div className="space-y-3">
				<div>
					<label htmlFor="description" className="block text-sm text-stone-300 mb-1">
						Description
					</label>
					<textarea
						id="description"
						value={descriptionValue}
						onChange={(e) => {
							setDescriptionValue(e.target.value);
							setDescriptionError(null);
						}}
						rows={2}
						aria-invalid={descriptionError ? 'true' : undefined}
						aria-describedby={
							descriptionError ? 'description-error' : 'description-count'
						}
						className={`w-full bg-stone-800 border rounded-lg px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:outline-none resize-none ${descriptionError ? 'border-red-500 focus:border-red-400' : 'border-stone-600 focus:border-stone-400'}`}
						placeholder="A few words about you…"
					/>
					<div className="flex justify-between items-center">
						{descriptionError ? (
							<p id="description-error" role="alert" className="text-xs text-red-400">
								{descriptionError}
							</p>
						) : (
							<span />
						)}
						<p
							id="description-count"
							aria-live="polite"
							className="text-xs text-stone-300"
						>
							{[...descriptionValue].length}/50
						</p>
					</div>
				</div>

				{error && (
					<Alert variant="error" dismissable onDismiss={() => setError(null)}>
						{error}
					</Alert>
				)}

				<Button onClick={handleSave} loading={loading} loadingText="Saving..." fullWidth>
					Save
				</Button>
			</div>
		</Modal>
	);
}
