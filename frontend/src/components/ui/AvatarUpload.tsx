import { useState } from 'react';
import { uploadAvatar, deleteAvatar } from '../../api/avatar';
import { convertToAvatarAvif } from '../../utils/avatarConverter';
import type { User } from '../../api/types';

interface EditProfileProps {
	user: User;
	onClose: () => void;
}

export default function AvatarUpload({ user, onClose}: EditProfileProps) {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string  | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string  | null>(null);

    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
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
            onClose();
        } catch (error) {
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
            onClose();    
        } catch (error) {
            setError("Failed to delete avatar");
        } finally {
            setLoading(false);
        }
    }
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-wood-800 border-2 border-wood-600 rounded-lg p-6 max-w-md w-full">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-bold text-wood-100">
                        Edit Profil
                    </h2>
                    <button onClick={onClose} className="text-wood-400 hover:text-wood-200 text-2xl leading-none">
                        ×
                    </button>
                </div>
            </div>

        </div>
    );
}

