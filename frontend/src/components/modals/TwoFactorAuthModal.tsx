import { useState, useRef } from "react";
import { Shield, Copy, Check } from "lucide-react";
import { Button, Modal, Input, Alert, InfoBlock, Badge } from "../ui";
import * as userApi from "../../api/user";
import { getErrorMessage } from "../../api/error";
import { useAuth } from "../../contexts/AuthContext";
import type { User } from "../../api/types";

interface TwoFactorModalProps {
	user: User;
	onClose: () => void;
	onSuccess: () => void;
}

export default function TwoFactorModal({ user, onClose, onSuccess }: TwoFactorModalProps) {
	const { refreshUser } = useAuth();
	const [step, setStep] = useState<"confirm" | "qr" | "verify" | "recovery" | "disable">("confirm");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [qrCode, setQrCode] = useState<string | null>(null);
	const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
	const [copiedCodes, setCopiedCodes] = useState(false);

	const passwordRef = useRef<HTMLInputElement>(null);
	const mfaCodeRef = useRef<HTMLInputElement>(null);
	const verifyCodeRef = useRef<HTMLInputElement>(null);

	const handleConfirmAction = () => {
		if (user.totp_enabled) {
			setStep("disable");
		} else {
			setStep("qr");
		}
	};

	const handleStart2FA = async () => {
		const password = passwordRef.current?.value || "";

		if (!password) {
			setError("Password is required");
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			const response = await userApi.start2FA(password);
			setQrCode(response.qr_base64);
			setStep("verify");
		} catch (err) {
			setError(getErrorMessage(err, "Failed to start 2FA setup"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleConfirm2FA = async () => {
		const password = passwordRef.current?.value || "";
		const code = verifyCodeRef.current?.value || "";

		if (!password || !code) {
			setError("Password and verification code are required");
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			const response = await userApi.confirm2FA(password, code);
			await refreshUser();
			setRecoveryCodes(response.recovery_codes);
			setStep("recovery");
		} catch (err) {
			setError(getErrorMessage(err, "Invalid verification code"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleDisable2FA = async () => {
		const password = passwordRef.current?.value || "";
		const mfaCode = mfaCodeRef.current?.value || "";

		if (!password || !mfaCode) {
			setError("Password and 2FA code are required to disable 2FA");
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			await userApi.disable2FA(password, mfaCode);
			await refreshUser();
			onSuccess();
		} catch (err) {
			setError(getErrorMessage(err, "Failed to disable 2FA"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleCopyRecoveryCodes = async () => {
		const text = recoveryCodes.join("\n");
		try {
			await navigator.clipboard.writeText(text);
			setCopiedCodes(true);
		} catch (err) {
			console.error("Failed to copy recovery codes:", err);
		}
	};

	return (
		<Modal
			onClose={onClose}
			title="Two-Factor Authentication"
			icon={<Shield className="w-6 h-6" />}
			closable={step !== "recovery"}
		>
			{error && (
				<Alert variant="error" dismissable onDismiss={() => setError(null)} className="mb-4">
					{error}
				</Alert>
			)}

			{/* Step 1: Confirm Action */}
			{step === "confirm" && (
				<div className="space-y-4">
					<InfoBlock
						label="Current Status"
						value={
							<span className="text-lg font-semibold">
								{user.totp_enabled ? (
									<Badge variant="success" dot>Enabled</Badge>
								) : (
									<Badge variant="warning" dot>Disabled</Badge>
								)}
							</span>
						}
						sublabel={
							user.totp_confirmed_at
								? `Activated: ${new Date(user.totp_confirmed_at).toLocaleDateString()}`
								: undefined
						}
					/>

					<p className="text-sm text-stone-300">
						{user.totp_enabled
							? "Disabling 2FA will make your account less secure. You will only need your password to log in."
							: "Two-factor authentication adds an extra layer of security. You'll need a code from your authenticator app when logging in."}
					</p>

					<div className="flex gap-3">
						<Button
							onClick={handleConfirmAction}
							variant={user.totp_enabled ? "secondary" : "primary"}
							className="flex-1"
						>
							{user.totp_enabled ? "Disable 2FA" : "Enable 2FA"}
						</Button>
						<Button onClick={onClose} variant="secondary">
							Cancel
						</Button>
					</div>
				</div>
			)}

			{/* Password input - persists across qr and verify steps to preserve ref */}
			{(step === "qr" || step === "verify") && (
				<div className={step === "verify" ? "hidden" : ""}>
					<Input
						ref={passwordRef}
						label="Password"
						type="password"
						id="2fa-password"
						autoFocus
						autoComplete="current-password"
						placeholder="Enter your password"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !isLoading) handleStart2FA();
						}}
					/>
				</div>
			)}

			{/* Step 2: Enter Password & Get QR Code */}
			{step === "qr" && (
				<div className="space-y-4">
					<p className="text-sm text-stone-300">
						Enter your password to generate a QR code for your authenticator app.
					</p>

					<div className="flex gap-3">
						<Button
							onClick={handleStart2FA}
							loading={isLoading}
							loadingText="Generating..."
							className="flex-1"
						>
							Continue
						</Button>
						<Button onClick={() => setStep("confirm")} variant="secondary">
							Back
						</Button>
					</div>
				</div>
			)}

			{/* Step 3: Scan QR & Verify Code */}
			{step === "verify" && qrCode && (
				<div className="space-y-4">
					<p className="text-sm text-stone-300">
						Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
					</p>

					<div className="bg-white p-4 rounded-lg flex items-center justify-center">
						<img
							src={`data:image/png;base64,${qrCode}`}
							alt="QR code for two-factor authentication setup"
							className="max-w-full"
						/>
					</div>

					<p className="text-sm text-stone-300">
						Enter the 6-digit code from your authenticator app to confirm setup:
					</p>

					<Input
						ref={verifyCodeRef}
						label="Verification Code"
						variant="code"
						id="verify-code"
						autoFocus
						maxLength={6}
						autoComplete="one-time-code"
						placeholder="000000"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !isLoading) handleConfirm2FA();
						}}
					/>

					<div className="flex gap-3">
						<Button
							onClick={handleConfirm2FA}
							loading={isLoading}
							loadingText="Verifying..."
							className="flex-1"
						>
							Confirm
						</Button>
					</div>
				</div>
			)}

			{/* Disable 2FA */}
			{step === "disable" && (
				<div className="space-y-4">
					<p className="text-sm text-stone-300">
						Enter your password and current 2FA code to disable two-factor authentication.
					</p>

					<Input
						ref={passwordRef}
						label="Password"
						type="password"
						id="disable-password"
						autoFocus
						autoComplete="current-password"
						placeholder="Enter your password"
					/>

					<Input
						ref={mfaCodeRef}
						label="Authentication Code"
						variant="code"
						id="disable-mfa"
						autoComplete="one-time-code"
						placeholder="000000 or recovery code"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !isLoading) handleDisable2FA();
						}}
					/>

					<div className="flex gap-3">
						<Button
							onClick={handleDisable2FA}
							loading={isLoading}
							loadingText="Disabling..."
							className="flex-1"
						>
							Disable 2FA
						</Button>
						<Button onClick={() => setStep("confirm")} variant="secondary">
							Back
						</Button>
					</div>
				</div>
			)}

			{/* Step 4: Show Recovery Codes */}
			{step === "recovery" && (
				<div className="space-y-4">
					<Alert variant="warning">
						<p className="font-semibold mb-1">Save Your Recovery Codes</p>
						<p className="text-xs opacity-90">
							Store these codes in a safe place. You'll need them to access your account if you lose your authenticator device.
						</p>
					</Alert>

					<div className="bg-stone-900 rounded-lg p-4 border border-stone-700/40">
						<div className="flex items-center justify-between mb-2">
							<p className="text-sm font-medium text-stone-200">Recovery Codes</p>
							<button
								onClick={handleCopyRecoveryCodes}
								className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 transition-colors"
								aria-label={copiedCodes ? "Recovery codes copied" : "Copy recovery codes to clipboard"}
							>
								{copiedCodes ? (
									<>
										<Check className="w-4 h-4" aria-hidden="true" />
										Copied!
									</>
								) : (
									<>
										<Copy className="w-4 h-4" aria-hidden="true" />
										Copy
									</>
								)}
							</button>
						</div>
						<div className="space-y-1 font-mono text-sm text-stone-300" role="list" aria-label="Recovery codes">
							{recoveryCodes.map((code, index) => (
								<div key={index} className="bg-stone-800 px-2 py-1 rounded" role="listitem">
									{code}
								</div>
							))}
						</div>
					</div>

					<Button onClick={onSuccess} fullWidth>
						Done
					</Button>
				</div>
			)}
		</Modal>
	);
}
