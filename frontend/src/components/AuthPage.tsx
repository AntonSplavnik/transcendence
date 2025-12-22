import React, { useState, useRef } from "react";
import { Swords, User, Lock, Mail } from 'lucide-react';
import Button from "./ui/Button";
import Card from "./ui/Card";
import * as authApi from "../api/auth";
import { getErrorMessage } from "../api/error";

export default function AuthPage({ onBack, onAuthSuccess }: { onBack: () => void; onAuthSuccess: () => void }) {
	const [isLogin, setIsLogin] = useState(true);
	const [isLoading, setIsLoading] = useState(false);
	const [email, setEmail] = useState("");
	const [username, setUsername] = useState("");
	const [error, setError] = useState("");
	const passwordRef = useRef<HTMLInputElement>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const password = passwordRef.current?.value || "";
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
			// localStorage.removeItem('error');
		} finally {
			setIsLoading(false);
		}
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
							<label className="block text-sm font-medium text-wood-300 mb-1">Username</label>
							<div className="relative">
								<User size={18} className="absolute left-3 top-3 text-wood-500" />
								<input
									type="text"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									placeholder="Sir Woodalot"
									className="w-full bg-wood-900 border border-wood-700 rounded p-2.5 pl-10 text-wood-100 focus:outline-none focus:border-primary"
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
								type="text"
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
								ref={passwordRef}
								type="password"
								placeholder="••••••••"
								className="w-full bg-wood-900 border border-wood-700 rounded p-2.5 pl-10 text-wood-100 focus:outline-none focus:border-primary"
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
						{isLogin ? "New here? " : "Already have an account? "}
					</span>
					<button
						onClick={() => setIsLogin(!isLogin)}
						className="text-primary hover:text-primary-hover font-semibold underline"
					>
						{isLogin ? "Create an account" : "Sign in"}
					</button>
				</div>

				<div className="mt-8 border-t border-wood-700 pt-4 text-center">
					<button onClick={onBack} className="text-wood-400 hover:text-wood-100 text-sm">
						← Back to Menu
					</button>
				</div>
			</Card>
		</div >
	);
}
