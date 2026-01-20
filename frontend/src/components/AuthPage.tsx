import React, { useState, useRef, useEffect } from "react";
import { Swords, User, Lock, Mail } from 'lucide-react';
import Button from "./ui/Button";
import Card from "./ui/Card";
import * as authApi from "../api/auth";
import * as usersApi from "../api/users";
import { getErrorMessage } from "../api/error";

export default function AuthPage({ onBack, onAuthSuccess }: { onBack: () => void; onAuthSuccess: () => void }) {
	const [isLogin, setIsLogin] = useState(true);
	const [isLoading, setIsLoading] = useState(false);
	const [email, setEmail] = useState("");
	const [username, setUsername] = useState("");
	const [error, setError] = useState("");
	const [nicknameValidation, setNicknameValidation] = useState("");
	const [isCheckingNickname, setIsCheckingNickname] = useState(false);
	const passwordRef = useRef<HTMLInputElement>(null);
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
				await authApi.login(email, password);
			} else {
				await authApi.register(username, email, password);
			}

			if (passwordRef.current) {
				passwordRef.current.value = "";
			}

			onAuthSuccess();
		} catch (error: any) {
			setError(getErrorMessage(error, 'Authentication failed'));
		} finally {
			setIsLoading(false);
		}
	};
	const getValidationStyle = () => {
		if (isCheckingNickname) return "text-wood-400";
		if (nicknameValidation.includes("❌")) return "text-red-400";
		return "text-wood-400";
	};

	return (
		<div className="flex items-center justify-center flex-grow p-4" >
			<Card className="w-full max-w-md border-t-8 border-t-primary">
				<div className="text-center mb-8">
					<Swords size={48} className="mx-auto text-primary mb-2" />
					<h2 className="text-2xl font-bold text-wood-100">
						{isLogin ? "Welcome Back" : "Join the Guild"}
					</h2>
					<p className="text-wood-300 text-sm">
						{isLogin ? "Sign in to access your stats" : "Create an account to start your journey"}
					</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					{error && (
						<div className="bg-red-900/20 border border-red-500 text-red-200 px-4 py-2 rounded">
							{error}
						</div>
					)}
					{!isLogin && (
						<div>
							<div className="flex justify-between items-center mb-1">
								<label className="block text-sm font-medium text-wood-300">Username</label>
								{username.trim().length > 0 && (
									<span className={`text-xs font-medium ${getValidationStyle()}`}>
										{isCheckingNickname ? "Checking..." : nicknameValidation}
									</span>
								)}
							</div>
							<div className="relative">
								<User size={18} className="absolute left-3 top-3 text-wood-500" />
								<input
									id="username"
									name="username"
									autoComplete="username"
									type="text"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									placeholder="Sir_Woodalot"
									className="w-full bg-wood-900 border border-wood-700 rounded p-2.5 pl-10 text-wood-100 focus: outline-none focus:border-primary"
									required
								/>
							</div>
						</div>
					)}

					<div>
						<label className="block text-sm font-medium text-wood-300 mb-1">Email</label>
						<div className="relative">
							<Mail size={18} className="absolute left-3 top-3 text-wood-500" />
							<input
								id="email"
								name="email"
								autoComplete="email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="you@kingdom.com"
								className="w-full bg-wood-900 border border-wood-700 rounded p-2.5 pl-10 text-wood-100 focus:outline-none focus:border-primary"
								required
							/>
						</div>
					</div>

					<div>
						<label className="block text-sm font-medium text-wood-300 mb-1">Password</label>
						<div className="relative">
							<Lock size={18} className="absolute left-3 top-3 text-wood-500" />
							<input
								type="password"
								name="password"
								ref={passwordRef}
								placeholder="••••••••"
								className="w-full bg-wood-900 border border-wood-700 rounded p-2.5 pl-10 text-wood-100 focus:outline-none focus:border-primary transition-colors duration-200"
								autoComplete={isLogin ? "current-password" : "new-password"}
								required
							/>
						</div>
					</div>

					<Button type="submit" disabled={isLoading} className="w-full mt-4">
						{isLogin ? (!isLoading ? "Sign In" : "Signing In....")
							: (!isLoading ? "Create Account" : "Creating your Account...")}
					</Button>
				</form>

				<div className="mt-6 text-center text-sm">
					<span className="text-wood-300">
						{isLogin ? "New here?  " : "Already have an account?  "}
					</span>
					<button
						type="button" onClick={() => setIsLogin(!isLogin)}
						className="text-primary hover: text-primary-hover font-semibold underline"
					>
						{isLogin ? "Create an account" : "Sign in"}
					</button>
				</div>

				<div className="mt-8 border-t border-wood-700 pt-4 text-center">
					<button type="button" onClick={onBack} className="text-wood-400 hover: text-wood-100 text-sm">
						← Back to Menu
					</button>
				</div>
			</Card>
		</div >
	);
}
