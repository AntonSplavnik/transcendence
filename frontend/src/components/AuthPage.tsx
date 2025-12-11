import React, { useState } from "react";
import { Swords, User, Lock, Mail } from 'lucide-react';
import Button from "./ui/Button";
import Card from "./ui/Card";

export default function AuthPage({ onBack, onAuthSuccess }: { onBack: () => void; onAuthSuccess: () => void }) {
  const [isLogin, setIsLogin] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Actual Backend logic here
    onAuthSuccess();
  };

  return (
    <div className="flex items-center justify-center flex-grow p-4">
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
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-wood-300 mb-1">Username</label>
              <div className="relative">
                <User size={18} className="absolute left-3 top-3 text-wood-500" />
                <input type="text" className="w-full bg-wood-900 border border-wood-700 rounded p-2.5 pl-10 text-wood-100 focus:outline-none focus:border-primary" placeholder="Sir Woodalot" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-wood-300 mb-1">Email</label>
            <div className="relative">
              <Mail size={18} className="absolute left-3 top-3 text-wood-500" />
              <input type="email" required className="w-full bg-wood-900 border border-wood-700 rounded p-2.5 pl-10 text-wood-100 focus:outline-none focus:border-primary" placeholder="you@realm.com" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-wood-300 mb-1">Password</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-3 text-wood-500" />
              <input type="password" required className="w-full bg-wood-900 border border-wood-700 rounded p-2.5 pl-10 text-wood-100 focus:outline-none focus:border-primary" placeholder="••••••••" />
            </div>
          </div>

          <Button type="submit" className="w-full mt-4">
            {isLogin ? "Sign In" : "Create Account"}
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
    </div>
  );
}
