import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { uploadAvatar, deleteAvatar } from '../../api/avatar';
import { convertToAvatarAvif } from '../../utils/avatarConverter';
import type { User } from '../../api/types';
import AvatarDisplay from '../ui/AvatarDisplay';
import { Button, Modal, Alert } from '../ui';

interface EditProfileProps {
	user: User;
	onClose: () => void;
	onAvatarChanged: (smallUrl: string | null, largeUrl: string | null) => void;
}

export default function AvatarUploadModal({ user, onClose, onAvatarChanged }: EditProfileProps) {
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [loading, setLoading] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		return () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}
		};
	}, [previewUrl]);

	function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
		}
		setSelectedFile(file);
		setPreviewUrl(URL.createObjectURL(file));
		setError(null);
	}

	async function handleUpload() {
		if (!selectedFile) return;
		setLoading(true);
		setError(null);
		try {
			const result = await convertToAvatarAvif(selectedFile);
			if (!result.success) {
				setError(result.error.message);
				return;
			}
			await uploadAvatar(result.data.large, result.data.small);
			onAvatarChanged(
				URL.createObjectURL(result.data.small),
				URL.createObjectURL(result.data.large),
			);
			onClose();
		} catch {
			setError("Failed to upload avatar");
		} finally {
			setLoading(false);
		}
	}

	async function handleDelete() {
		setLoading(true);
		setError(null);
		try {
			await deleteAvatar();
			onAvatarChanged(null, null);
			onClose();
		} catch {
			setError("Failed to delete avatar");
		} finally {
			setLoading(false);
		}
	}

	return (
		<Modal
			onClose={onClose}
			title="Edit Profile"
			icon={<Pencil className="w-6 h-6" />}
		>
			<div className="flex flex-col items-center gap-1 mb-4">
				{previewUrl ? (
					<img src={previewUrl} alt="preview" className="w-32 h-32 rounded-full object-cover" />
				) : (
					<AvatarDisplay userId={user.id} size="large" className="w-32 h-32 rounded-full" />
				)}
				<button
					onClick={handleDelete}
					disabled={loading}
					className="text-danger hover:text-danger-light text-xs italic disabled:opacity-50 transition-colors"
				>
					x delete
				</button>
			</div>

			<div className="space-y-4">
				<input
					type="file"
					accept="image/*"
					onChange={handleFileSelect}
					className="w-full text-sm text-stone-300"
				/>

				{error && (
					<Alert variant="error" dismissable onDismiss={() => setError(null)}>
						{error}
					</Alert>
				)}

				<div className="flex gap-3">
					<Button
						onClick={handleUpload}
						disabled={!selectedFile || loading}
						loading={loading}
						loadingText="Uploading..."
						className="flex-1"
					>
						Upload
					</Button>
					<Button onClick={onClose} variant="secondary">
						Cancel
					</Button>
				</div>
			</div>
		</Modal>
	);
}
