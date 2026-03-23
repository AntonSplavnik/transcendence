import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ScrollText } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button, Card } from './ui';

interface TermsOfServiceProps {
	onBack: () => void;
}

export default function TermsOfService({ onBack }: TermsOfServiceProps) {
	const { user, hasAcceptedTos, tosLoaded, acceptTos } = useAuth();
	const navigate = useNavigate();
	const [accepting, setAccepting] = useState(false);
	const [acceptError, setAcceptError] = useState<string | null>(null);

	const handleAcceptTos = async () => {
		setAccepting(true);
		setAcceptError(null);
		try {
			await acceptTos();
			navigate('/home', { replace: true });
		} catch {
			setAcceptError('Failed to accept Terms of Service. Please try again.');
			setAccepting(false);
		}
	};

	// Show the sticky accept bar for logged-in users who haven't accepted yet.
	// Gated on `tosLoaded` so the button doesn't appear before we know whether
	// acceptance is needed (see AuthContext for how tosLoaded is derived).
	const showAcceptButton = user && tosLoaded && !hasAcceptedTos;
	return (
		<main className="p-6 max-w-4xl mx-auto w-full">
			<div className="flex items-center gap-4 mb-8">
				<button
					onClick={onBack}
					className="text-stone-350 hover:text-gold-400 transition-colors"
					aria-label="Go back"
				>
					<ArrowLeft size={24} />
				</button>
				<ScrollText size={28} className="text-gold-400" aria-hidden="true" />
				<h1 className="text-3xl font-bold font-display">Terms of Service</h1>
			</div>

			<div className="space-y-6">
				{/* 1. Introduction */}
				<Card>
					<p className="text-stone-300 text-sm mb-2">Last updated: 25.02.2026</p>
					<p className="text-stone-300">
						Welcome to Hit 'em good! This is a multiplayer online game built as a final
						project at <strong className="text-stone-100">42 Berlin </strong> by a group
						of developer students. By creating an account or using this service, you
						agree to these Terms of Service. If you don&apos;t agree, please don&apos;t
						use the service.
					</p>
					<p className="text-stone-300 mt-3">
						These terms are a legal agreement between you and the Hit 'em good
						development team. They explain the rules for using the service, what you can
						expect from us, and what we expect from you.
					</p>
				</Card>

				{/* 2. Eligibility */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						1. Who Can Use This Service
					</h2>
					<p className="text-stone-300">
						You must be at least{' '}
						<strong className="text-stone-100">13 years old</strong> to use Hit 'em
						good. If you are under 16 years of age, you need permission from a parent or
						legal guardian before creating an account, as required by GDPR Article 8.
					</p>
					<p className="text-stone-300 mt-3">
						By creating an account, you confirm that you meet these age requirements.
					</p>
				</Card>

				{/* 3. Account & Registration */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						2. Your Account
					</h2>
					<p className="text-stone-300 mb-3">
						When you register, you provide a nickname, email address, and password.
						Here&apos;s what you agree to:
					</p>
					<ul className="list-disc list-inside text-stone-300 space-y-2 ml-2">
						<li>
							<strong className="text-stone-100">Keep your credentials safe</strong>{' '}
							&mdash; you are responsible for your password and, if enabled, your 2FA
							recovery codes. Don&apos;t share them with anyone.
						</li>
						<li>
							<strong className="text-stone-100">One account per person</strong>{' '}
							&mdash; creating multiple accounts is not allowed
						</li>
						<li>
							<strong className="text-stone-100">
								You&apos;re responsible for your account
							</strong>{' '}
							&mdash; anything that happens under your account is your responsibility
						</li>
						<li>
							<strong className="text-stone-100">Provide accurate info</strong>{' '}
							&mdash; use an email address that you own and keep your information up
							to date
						</li>
						<li>
							<strong className="text-stone-100">Manage your own security</strong>{' '}
							&mdash; if you suspect unauthorized access, use the Session Management
							page to review and revoke active sessions and/or change your password
							and activate 2FA. You are solely responsible for all activity under your
							account, including activity by others. We provide no account recovery,
							support, or guarantees in such cases.
						</li>
					</ul>
					<p className="text-stone-300 mt-3">
						Your password must be between 8 and 128 characters. We strongly recommend
						enabling two-factor authentication (2FA) for extra security.
					</p>
				</Card>

				{/* 4. The Service */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						3. What the Service Provides
					</h2>
					<p className="text-stone-300">
						Hit 'em good offers online multiplayer gaming with the following features:
					</p>
					<ul className="list-disc list-inside text-stone-300 space-y-1 ml-2 mt-2">
						<li>Online multiplayer matches against other players</li>
						<li>Matchmaking to pair you with opponents</li>
						<li>Player statistics and match history tracking</li>
						<li>Session management across multiple devices (up to 10 sessions)</li>
						<li>Optional avatar upload for your profile</li>
						<li>Optional two-factor authentication for account security</li>
					</ul>
					<p className="text-stone-300 mt-3">
						This is a student project. Features may change, be added, or be removed as
						development continues.
					</p>
				</Card>

				{/* 5. Acceptable Use */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						4. Rules of the Game
					</h2>
					<p className="text-stone-300 mb-3">
						To keep things fair and fun for everyone, you agree{' '}
						<strong className="text-stone-100">not to</strong>:
					</p>
					<ul className="list-disc list-inside text-stone-300 space-y-2 ml-2">
						<li>
							<strong className="text-stone-100">Cheat</strong> &mdash; use exploits,
							hacks, modified clients, or any method to gain an unfair advantage
						</li>
						<li>
							<strong className="text-stone-100">Abuse bugs</strong> &mdash; if you
							find a bug, report it instead of exploiting it
						</li>
						<li>
							<strong className="text-stone-100">Harass others</strong> &mdash; no
							bullying, threats, hate speech, or toxic behavior
						</li>
						<li>
							<strong className="text-stone-100">Impersonate</strong> &mdash;
							don&apos;t pretend to be another player, a team member, or anyone else
						</li>
						<li>
							<strong className="text-stone-100">Use bots or scripts</strong> &mdash;
							no automated tools to interact with the service unless we&apos;ve given
							explicit permission
						</li>
						<li>
							<strong className="text-stone-100">Attack the service</strong> &mdash;
							don&apos;t try to steal data or disrupt, overload, or break our servers
							or network
						</li>
						<li>
							<strong className="text-stone-100">Upload harmful content</strong>{' '}
							&mdash; avatars must not contain offensive, illegal, or inappropriate
							material
						</li>
					</ul>
				</Card>

				{/* 6. Account Termination */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						5. Account Suspension &amp; Deletion
					</h2>

					<h3 className="text-lg font-semibold text-stone-100 mt-2 mb-2">
						What we can do
					</h3>
					<p className="text-stone-300">
						We reserve the right to{' '}
						<strong className="text-stone-100">suspend or permanently ban</strong> any
						account that violates these terms. This includes, but is not limited to,
						cheating, harassment, and attempting to compromise the service. Depending on
						the severity, bans may be issued without prior warning.
					</p>

					<h3 className="text-lg font-semibold text-stone-100 mt-4 mb-2">
						What you can do
					</h3>
					<p className="text-stone-300">
						You can request deletion of your account at any time by contacting us at{' '}
						<span className="text-gold-400">schluesselfehlt@gmail.com</span>. When your
						account is deleted, all personal data associated with it is permanently
						removed from our systems, including sessions, game history, avatars, and
						statistics. See our Privacy Policy for full details on data retention and
						deletion.
					</p>
				</Card>

				{/* 7. Your Content */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						6. Your Content
					</h2>
					<p className="text-stone-300">
						You retain ownership of content you create within the service, such as your
						nickname and uploaded avatar image. By uploading content, you grant us a
						license to store and display it as part of the service (for example, showing
						your avatar to other players).
					</p>
					<p className="text-stone-300 mt-3">
						You are responsible for ensuring that any content you upload does not
						violate the rights of others or any applicable laws.
					</p>
				</Card>

				{/* 8. Intellectual Property */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						7. Our Intellectual Property
					</h2>
					<p className="text-stone-300">
						All game content &mdash; including code, game mechanics, and design &mdash;
						is the intellectual property of the Hit 'em good development team at 42
						Berlin. In-game models were graciously provided by{' '}
						<a
							href="https://kaylousberg.itch.io/"
							className="text-gold-400 font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
						>
							kaylousberg
						</a>
						. You may not copy, modify, distribute, or create derivative works from any
						part of the service without our explicit permission.
					</p>
				</Card>

				{/* 9. Privacy */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						8. Privacy
					</h2>
					<p className="text-stone-300">
						Your privacy matters to us. Our{' '}
						<strong className="text-stone-100">Privacy Policy</strong> explains what
						personal data we collect, why we collect it, and how we protect it. By using
						the service, you acknowledge that you have read and understood our Privacy
						Policy.
					</p>
				</Card>

				{/* 10. Disclaimer of Warranties */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						9. No Guarantees
					</h2>
					<p className="text-stone-300">
						This service is provided{' '}
						<strong className="text-stone-100">&quot;as is&quot;</strong> and{' '}
						<strong className="text-stone-100">&quot;as available&quot;</strong>.
						We&apos;re a team of students building this as a learning project, so we
						can&apos;t make promises about:
					</p>
					<ul className="list-disc list-inside text-stone-300 space-y-1 ml-2 mt-2">
						<li>The service being available 24/7 without interruption</li>
						<li>The service being free of bugs or errors</li>
						<li>Your data being preserved indefinitely</li>
						<li>Features remaining the same over time</li>
					</ul>
					<p className="text-stone-300 mt-3">
						The service may be taken offline, modified, or discontinued at any time
						without notice as part of ongoing development.
					</p>
				</Card>

				{/* 11. Limitation of Liability */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						10. Limitation of Liability
					</h2>
					<p className="text-stone-300">
						To the fullest extent permitted by German law, the Hit 'em good development
						team is not liable for any direct, indirect, incidental, or consequential
						damages arising from your use of (or inability to use) the service. This
						includes but is not limited to data loss, account suspension, or service
						interruptions.
					</p>
					<p className="text-stone-300 mt-3">
						This is a <strong className="text-stone-100">free service</strong> with no
						financial transactions. No financial claims may be made against the
						development team.
					</p>
				</Card>

				{/* 12. Changes to These Terms */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						11. Changes to These Terms
					</h2>
					<p className="text-stone-300">
						We may update these Terms of Service as the project evolves. When we do,
						we&apos;ll update the &quot;Last updated&quot; date at the top of this page.
					</p>
					<p className="text-stone-300 mt-3">
						For significant changes, we will make reasonable efforts to notify you (for
						example, through an in-app notice). Your continued use of the service after
						changes are posted means you accept the updated terms.
					</p>
				</Card>

				{/* 13. Governing Law */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						12. Governing Law
					</h2>
					<p className="text-stone-300">
						These terms are governed by the laws of the{' '}
						<strong className="text-stone-100">Federal Republic of Germany</strong>. Any
						disputes will be handled by the courts of{' '}
						<strong className="text-stone-100">Berlin, Germany</strong>.
					</p>
				</Card>

				{/* 14. Contact */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						13. Contact
					</h2>
					<p className="text-stone-300">
						Questions about these terms? Reach out to us at:{' '}
						<span className="text-gold-400">schluesselfehlt@gmail.com</span>
					</p>
				</Card>
			</div>

			{showAcceptButton && (
				<div className="sticky bottom-0 bg-stone-900/95 backdrop-blur border-t border-stone-700 p-4 mt-8">
					<div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
						<p className="text-stone-300 text-sm">
							Please read and accept the Terms of Service to continue.
						</p>
						<Button
							onClick={handleAcceptTos}
							loading={accepting}
							loadingText="Accepting..."
							className="shrink-0"
						>
							I Accept
						</Button>
					</div>
					{acceptError && (
						<p className="text-red-400 text-sm mt-2 text-center">{acceptError}</p>
					)}
				</div>
			)}
		</main>
	);
}
