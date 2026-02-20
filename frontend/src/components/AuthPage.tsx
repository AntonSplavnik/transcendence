import React, { useState, useRef, useEffect } from "react";
import { Swords, User, Lock, Mail } from "lucide-react";
import { Button, Card, Input, Alert } from "./ui";
import { useAuth } from "../contexts/AuthContext";
import * as usersApi from "../api/users";
import { getErrorMessage, getErrorBrief } from "../api/error";
import TwoFactorLoginModal from "./modals/TwoFactorLoginModal";

export default function AuthPage({ onBack, onAuthSuccess }: { onBack: () => void; onAuthSuccess: () => void }) {
	const { login, register } = useAuth();
	const [isLogin, setIsLogin] = useState(true);
	const [isLoading, setIsLoading] = useState(false);
	const [email, setEmail] = useState("");
	const [username, setUsername] = useState("");
	const [error, setError] = useState("");
	const [nicknameValidation, setNicknameValidation] = useState("");
	const [isCheckingNickname, setIsCheckingNickname] = useState(false);
	const [showMfaModal, setShowMfaModal] = useState(false);
	const [pendingEmail, setPendingEmail] = useState<string | null>(null);
	const passwordRef = useRef<HTMLInputElement>(null);
	const emailRef = useRef<HTMLInputElement>(null);
	const nicknameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!isLogin && username.trim().length > 0) {
			if (nicknameTimeoutRef.current) {
				clearTimeout(nicknameTimeoutRef.current);
			}
			setIsCheckingNickname(true);
			nicknameTimeoutRef.current = setTimeout(async () => {
				const result = await usersApi.nicknameExists(username);
				setNicknameValidation(result);
				setIsCheckingNickname(false);
			}, 500);
		} else {
			setNicknameValidation("");
			setIsCheckingNickname(false);
		}
		return () => {
			if (nicknameTimeoutRef.current) {
				clearTimeout(nicknameTimeoutRef.current);
			}
		};
	}, [username, isLogin]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const password = passwordRef.current?.value || "";
		if (!isLogin && !nicknameValidation.includes("✅")) {
			setError("Please choose a valid, available nickname");
			return;
		}

		setIsLoading(true);
		setError("");
		try {
			if (isLogin) {
				await login(email, password);
			} else {
				await register(username, email, password);
			}

			if (passwordRef.current) {
				passwordRef.current.value = "";
			}

			onAuthSuccess();
		} catch (error) {
			const brief = getErrorBrief(error);
			if (brief === "TwoFactorRequired") {
				setPendingEmail(email);
				setShowMfaModal(true);
			} else {
				setError(getErrorMessage(error, "Authentication failed"));
			}
		} finally {
			setIsLoading(false);
		}
	};

	const getValidationNode = () => {
		if (!username.trim().length) return null;
		const style = isCheckingNickname
			? "text-stone-400"
			: nicknameValidation.includes("❌")
				? "text-danger-light"
				: "text-stone-400";
		return (
			<span className={`text-xs font-medium ${style}`}>
				{isCheckingNickname ? "Checking..." : nicknameValidation}
			</span>
		);
	};

	const handleMfaSuccess = () => {
		setShowMfaModal(false);
		setPendingEmail(null);
		if (passwordRef.current) passwordRef.current.value = "";
		onAuthSuccess();
	};

	const handleMfaCancel = () => {
		setShowMfaModal(false);
		setPendingEmail(null);
	};

	return (
		<div className="flex items-center justify-center flex-grow p-4">
			<Card accent="gold" className="w-full max-w-md">
				<div className="text-center mb-8">
					<Swords size={48} className="mx-auto text-gold-400 mb-2" aria-hidden="true" />
					<h2>{isLogin ? "Welcome Back" : "Join the Guild"}</h2>
					<p className="text-stone-300 text-sm mt-1">
						{isLogin ? "Sign in to access your stats" : "Create an account to start your journey"}
					</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4" aria-label={isLogin ? "Sign in form" : "Registration form"}>
					{error && <Alert variant="error">{error}</Alert>}

					{!isLogin && (
						<Input
							label="Username"
							icon={<User size={18} />}
							id="username"
							name="username"
							autoComplete="username"
							type="text"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							placeholder="Sir_Woodalot"
							validation={getValidationNode()}
							required
						/>
					)}

					<Input
						ref={emailRef}
						label="Email"
						icon={<Mail size={18} />}
						id="email"
						autoFocus
						name="email"
						autoComplete="email"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="you@kingdom.com"
						required
					/>

					<Input
						ref={passwordRef}
						label="Password"
						icon={<Lock size={18} />}
						type="password"
						name="password"
						placeholder="••••••••"
						autoComplete={isLogin ? "current-password" : "new-password"}
						required
					/>

					<Button
						type="submit"
						loading={isLoading}
						loadingText={isLogin ? "Signing In..." : "Creating Account..."}
						fullWidth
						className="mt-4"
					>
						{isLogin ? "Sign In" : "Create Account"}
					</Button>
				</form>

				<div className="mt-6 text-center text-sm">
					<span className="text-stone-300">
						{isLogin ? "New here?  " : "Already have an account?  "}
					</span>
					<button
						type="button"
						onClick={() => setIsLogin(!isLogin)}
						className="text-gold-400 hover:text-gold-300 font-semibold underline"
					>
						{isLogin ? "Create an account" : "Sign in"}
					</button>
				</div>

				<div className="mt-8 border-t border-stone-700 pt-4 text-center">
					<button
						type="button"
						onClick={onBack}
						className="text-stone-400 hover:text-stone-100 text-sm transition-colors"
						aria-label="Go back to main menu"
					>
						← Back to Menu
					</button>
				</div>
			</Card>

			{showMfaModal && pendingEmail && (
				<TwoFactorLoginModal
					email={pendingEmail}
					getPassword={() => passwordRef.current?.value || ""}
					onSuccess={handleMfaSuccess}
					onCancel={handleMfaCancel}
				/>
			)}
		</div>
	);
}
