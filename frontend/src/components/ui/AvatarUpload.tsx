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

    }
    return (<div></div>);
}

