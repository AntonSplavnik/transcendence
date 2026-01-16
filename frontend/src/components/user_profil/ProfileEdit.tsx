import React, { useState } from "react";
import Button from "./../ui/Button";
import Avatar from "./../ui/Avatar";

interface ProfileEditProps {
	user: {
		id: number;
		nickname: string;
		email: string;
		avatar_url?: string | null;
	};
	onClose: () => void; // Callback to close the modal
	onSuccess: () => void; // Callback after success (to refresh data)
}

/**
 * Modal to edit user profile
 * 
 * Allows to:
 * - Change nickname
 * - Upload a new avatar (with preview)
 */
export default function ProfileEdit({ user, onClose, onSuccess }: ProfileEditProps) {
	const [nickname, setNickname] = useState(user.nickname);
	const [avatarFile, setAvatarFile] = useState<File | null>(null);
	const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	/**
	 * Handles image file selection
	 * Creates a local preview before upload
	 */
	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		// Validate file type
		if (!file.type.startsWith("image/")) {
			setError("Please select an image file (JPEG, PNG, or WebP)");
			return;
		}

		// Validate size (max 2MB)
		if (file.size > 2 * 1024 * 1024) {
			setError("Image must be less than 2MB");
			return;
		}

		// Create local preview (temporary blob URL)
		const reader = new FileReader();
		reader.onloadend = () => {
			setAvatarPreview(reader.result as string);
		};
		reader.readAsDataURL(file);

		setAvatarFile(file);
		setError("");
	};

	/**
	 * Saves modifications (nickname + avatar)
	 */
	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError("");

		try {
			// 1. Upload avatar if a file was selected
			if (avatarFile) {
				const formData = new FormData();
				formData.append("avatar", avatarFile);

				const avatarResponse = await fetch("/api/profile/avatar", {
					method: "POST",
					credentials: "include",
					body: formData,
				});

				if (!avatarResponse.ok) {
					const errorData = await avatarResponse.json().catch(() => ({}));
					throw new Error(errorData.message || "Failed to upload avatar");
				}
			}

			// 2. Update nickname if changed
			if (nickname !== user.nickname) {
				const profileResponse = await fetch("/api/profile/update", {
					method: "PUT",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ nickname }),
				});

				if (!profileResponse.ok) {
					const errorData = await profileResponse.json().catch(() => ({}));
					throw new Error(errorData.message || "Failed to update nickname");
				}
			}

			// 3. Success! Close modal and refresh data
			onSuccess();
			onClose();
		} catch (err: any) {
			console.error("Profile update error:", err);
			setError(err.message || "Failed to update profile. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		// Dark overlay covering the entire screen
		<div
			className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
			onClick={onClose}  // Click outside closes the modal
		>
			{/* Modal content */}
			<div
				className="bg-wood-800 rounded-lg border-2 border-wood-700 p-6 w-full max-w-md"
				onClick={(e) => e.stopPropagation()}  // Prevent closing when clicking inside
			>
				<h2 className="text-2xl font-bold text-wood-100 mb-6">Edit Profile</h2>

				<form onSubmit={handleSubmit} className="space-y-6">
					{/* Avatar preview + file input */}
					<div className="flex flex-col items-center gap-4">
						<Avatar
							src={avatarPreview || user.avatar_url}
							nickname={nickname}
							size="lg"
						/>
						<label className="cursor-pointer">
							<input
								type="file"
								accept="image/jpeg,image/png,image/webp"
								onChange={handleFileChange}
								className="hidden"
							/>
							<span className="text-sm text-primary hover:text-primary-light underline">
								{avatarFile ? "Change image" : "Upload new avatar"}
							</span>
						</label>
						<p className="text-xs text-wood-400">Max 2MB • JPEG, PNG, or WebP</p>
					</div>

					{/* Nickname input */}
					<div>
						<label htmlFor="nickname" className="block text-sm font-medium text-wood-300 mb-2">
							Nickname
						</label>
						<input
							id="nickname"
							type="text"
							value={nickname}
							onChange={(e) => setNickname(e.target.value)}
							minLength={3}
							maxLength={20}
							required
							className="w-full px-4 py-2 bg-wood-900 border border-wood-700 rounded text-wood-100 focus:outline-none focus:border-primary"
						/>
						<p className="text-xs text-wood-400 mt-1">3-20 characters</p>
					</div>

					{/* Error message */}
					{error && (
						<div className="bg-red-900/20 border border-red-500 text-red-200 px-4 py-2 rounded text-sm">
							{error}
						</div>
					)}

					{/* Buttons */}
					<div className="flex gap-3">
						<Button
							type="submit"
							disabled={isLoading}
							className="flex-1"
						>
							{isLoading ? "Saving..." : "Save Changes"}
						</Button>
						<Button
							type="button"
							variant="secondary"
							onClick={onClose}
							disabled={isLoading}
							className="flex-1"
						>
							Cancel
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
