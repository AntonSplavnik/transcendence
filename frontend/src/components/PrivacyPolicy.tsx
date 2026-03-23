import { ArrowLeft, Shield } from 'lucide-react';
import { Card } from './ui';

interface PrivacyPolicyProps {
	onBack: () => void;
}

export default function PrivacyPolicy({ onBack }: PrivacyPolicyProps) {
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
				<Shield size={28} className="text-gold-400" aria-hidden="true" />
				<h1 className="text-3xl font-bold font-display">Privacy Policy</h1>
			</div>

			<div className="space-y-6">
				{/* 1. Introduction */}
				<Card>
					<p className="text-stone-300 text-sm mb-2">Last updated: 25.02.2026</p>
					<p className="text-stone-300">
						Welcome! Hit 'em good is a multiplayer online game built as a final project
						at <strong className="text-stone-100">42 Berlin</strong> by a group of
						developer students. We care about your privacy and want to be upfront about
						how we handle your personal data.
					</p>
					<p className="text-stone-300 mt-3">
						This document explains what data we collect, why we collect it, how we
						collect it, who can access it, and how long we keep it. It also covers your
						rights and how to reach us if you have questions.
					</p>
				</Card>

				{/* 2. Data Controller */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						1. Who&apos;s Responsible for Your Data
					</h2>
					<p className="text-stone-300">
						The data controller for this application is the Hit 'em good development
						team at 42 Berlin.
					</p>
					<ul className="list-none text-stone-300 space-y-1 mt-3 ml-2">
						<li>
							Email: <span className="text-gold-400">schluesselfehlt@gmail.com</span>
						</li>
					</ul>
					<p className="text-stone-300 mt-3">
						As a small student project team, we are not required to appoint a Data
						Protection Officer (DPO). However, you can reach our team for any data
						protection questions at the email address above.
					</p>
				</Card>

				{/* 3. What Data We Collect */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						2. What Data We Collect
					</h2>

					<h3 className="text-lg font-semibold text-stone-100 mt-4 mb-2">
						Data you give us
					</h3>
					<ul className="list-disc list-inside text-stone-300 space-y-1 ml-2">
						<li>
							<strong className="text-stone-100">Email address</strong> &mdash; used
							for account registration and identification
						</li>
						<li>
							<strong className="text-stone-100">Nickname</strong> &mdash; the display
							name you choose for the game
						</li>
						<li>
							<strong className="text-stone-100">Password</strong> &mdash; we never
							store your actual password, only a secure one-way hash of it
						</li>
						<li>
							<strong className="text-stone-100">Avatar image</strong> &mdash; if you
							upload a profile picture, we store it in two sizes
						</li>
						<li>
							<strong className="text-stone-100">
								Two-factor authentication data
							</strong>{' '}
							&mdash; if you enable 2FA, we store an encrypted TOTP secret and hashed
							recovery codes
						</li>
					</ul>

					<h3 className="text-lg font-semibold text-stone-100 mt-4 mb-2">
						Data collected automatically
					</h3>
					<ul className="list-disc list-inside text-stone-300 space-y-1 ml-2">
						<li>
							<strong className="text-stone-100">IP address</strong> &mdash; sent with
							every request your browser makes to our server
						</li>
						<li>
							<strong className="text-stone-100">Browser type and version</strong>{' '}
							&mdash; from the User-Agent header your browser sends automatically
						</li>
						<li>
							<strong className="text-stone-100">Operating system</strong> &mdash;
							also from the User-Agent header
						</li>
						<li>
							<strong className="text-stone-100">Timestamps</strong> &mdash; when you
							log in, refresh your session, play games, and interact with the service
						</li>
						<li>
							<strong className="text-stone-100">Device identifier</strong>
							&mdash; a randomly generated ID assigned to your browser the first time
							you make a request to our server without one present. It is stored in
							your browser as a cookie and saved in session records to identify which
							session to resume when you log in without a session cookie.
						</li>
					</ul>

					<h3 className="text-lg font-semibold text-stone-100 mt-4 mb-2">Game data</h3>
					<ul className="list-disc list-inside text-stone-300 space-y-1 ml-2">
						<li>Match history and results</li>
						<li>Player statistics (wins, losses, scores)</li>
						<li>Matchmaking rating</li>
					</ul>

					<p className="text-stone-300 mt-4">
						We do not collect sensitive data such as real names, physical addresses,
						payment information, or geolocation data.
					</p>
				</Card>

				{/* 4. How We Collect Your Data */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						3. How We Collect Your Data
					</h2>
					<ul className="list-disc list-inside text-stone-300 space-y-2 ml-2">
						<li>
							<strong className="text-stone-100">Registration form</strong>
							&mdash; when you create an account, you provide an email address,
							nickname, and password
						</li>
						<li>
							<strong className="text-stone-100">
								Automatically via your browser
							</strong>{' '}
							&mdash; your browser sends technical data (IP address, User-Agent) with
							every request. We store some of this in your session record.
						</li>
						<li>
							<strong className="text-stone-100">Cookies</strong> &mdash; we use three
							essential cookies for authentication (see Section 8 for details). Since
							these are strictly necessary for the service to work, no cookie consent
							banner is required under the ePrivacy Directive.
						</li>
						<li>
							<strong className="text-stone-100">Gameplay</strong> &mdash; match
							results and statistics are recorded as you play
						</li>
					</ul>
				</Card>

				{/* 5. Why We Collect This Data */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						4. Why We Collect This Data
					</h2>
					<p className="text-stone-300 mb-3">
						We only process your data when we have a legal reason to do so. Here are our
						legal bases:
					</p>

					<div className="space-y-3">
						<div>
							<h3 className="text-stone-100 font-semibold">
								Contract performance (Art. 6(1)(b) GDPR)
							</h3>
							<p className="text-stone-300 text-sm mb-1">
								Processing that&apos;s necessary to provide you with the service you
								signed up for:
							</p>
							<ul className="list-disc list-inside text-stone-300 space-y-1 ml-2 mt-1">
								<li>Creating and maintaining your game account</li>
								<li>Authenticating you when you log in</li>
								<li>Running multiplayer matchmaking</li>
								<li>Tracking your game statistics and match history</li>
							</ul>
						</div>

						<div>
							<h3 className="text-stone-100 font-semibold">
								Legitimate interest (Art. 6(1)(f) GDPR)
							</h3>
							<p className="text-stone-300 text-sm mb-1">
								Processing that serves our reasonable interests without overriding
								your rights:
							</p>
							<ul className="list-disc list-inside text-stone-300 space-y-1 ml-2 mt-1">
								<li>
									Keeping the service secure and preventing abuse (e.g., storing
									IP addresses and session data)
								</li>
								<li>Improving game balance through aggregated matchmaking data</li>
							</ul>
						</div>
					</div>

					<p className="text-stone-300 mt-4">
						We do not process your data based on consent for core functionality, and we
						do not use your data for marketing or profiling.
					</p>
				</Card>

				{/* 6. Who Has Access */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						5. Who Has Access to Your Data
					</h2>
					<ul className="list-disc list-inside text-stone-300 space-y-2 ml-2">
						<li>
							<strong className="text-stone-100">
								The Hit 'em good development team
							</strong>{' '}
							&mdash; for operating, maintaining, and improving the service
						</li>
						<li>
							<strong className="text-stone-100">Other players</strong> &mdash; can
							see your nickname, game statistics, and match history. They never see
							your password, IP address, or any authentication data.
						</li>
						{/* TODO: uncomment when OAuth providers are added */}
						{/* <li>
							<strong className="text-stone-100">Third-party authentication
							providers</strong> &mdash; if you choose to sign in via an external
							provider (e.g., OAuth), that provider will process data according to
							their own privacy policy
						</li> */}
					</ul>
					<p className="text-stone-300 mt-3">
						We do not sell, trade, or share your personal data with any third parties
						for marketing or advertising. Your data is stored on our own servers and is
						not transferred outside the European Union.
					</p>
				</Card>

				{/* 7. Data Retention */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						6. How Long We Keep Your Data
					</h2>
					<ul className="list-disc list-inside text-stone-300 space-y-2 ml-2">
						<li>
							<strong className="text-stone-100">Account data</strong> (email,
							nickname, password hash, avatar, 2FA secrets) &mdash; kept for as long
							as your account exists
						</li>
						<li>
							<strong className="text-stone-100">Session records</strong> &mdash; when
							you log out, your session is invalidated but the record remains in our
							database. You can permanently delete individual sessions from the
							Session Management page. Sessions are also automatically removed if you
							exceed 10 active sessions (the oldest are pruned first).
						</li>
						<li>
							<strong className="text-stone-100">Device identifier cookie</strong>
							&mdash; stored in your browser with no expiry. It is retained
							indefinitely as it serves as a persistent browser identifier for session
							lookup at login.
						</li>
						<li>
							<strong className="text-stone-100">
								Game statistics and match history
							</strong>{' '}
							&mdash; kept for as long as your account exists
						</li>
						<li>
							<strong className="text-stone-100">Cookies</strong> &mdash; the session
							cookie persists in your browser until you clear it, but the server stops
							accepting it after 30 days (or 7 days without activity). The JWT cookie
							expires after 15 minutes.
						</li>
					</ul>
					<p className="text-stone-300 mt-3">
						When you delete your account,{' '}
						<strong className="text-stone-100">
							all data associated with it is permanently removed
						</strong>{' '}
						from our systems, including all session records, game history, and
						statistics.
					</p>
				</Card>

				{/* 8. Cookies */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						7. Cookies
					</h2>
					<p className="text-stone-300">
						We use only{' '}
						<strong className="text-stone-100">strictly necessary cookies</strong> that
						are essential for the service to work. We use three:
					</p>
					<ul className="list-disc list-inside text-stone-300 space-y-2 ml-2 mt-3">
						<li>
							<strong className="text-stone-100">Session token</strong> &mdash; a
							secure, HttpOnly cookie that keeps you logged in. Your browser stores it
							long-term, but our server enforces expiry: your session becomes inactive
							after 7 days without use, or 30 days maximum.
						</li>
						<li>
							<strong className="text-stone-100">JWT token</strong> &mdash; a secure,
							HttpOnly cookie used to authenticate your API requests. It expires after
							15 minutes and is automatically refreshed in the background while you
							use the service.
						</li>
						<li>
							<strong className="text-stone-100">Device identifier</strong> &mdash; a
							randomly generated ID set when you first contact our server without one
							present. It has no expiry and is stored persistently in your browser.
							Its sole purpose is to identify which existing session to resume when
							you log in and no session cookie is present.
						</li>
					</ul>
					<p className="text-stone-300 mt-3">
						All the cookies are set with the{' '}
						<strong className="text-stone-100">Secure</strong> flag (HTTPS only) and{' '}
						<strong className="text-stone-100">SameSite=Lax</strong> for CSRF
						protection. They are not accessible via JavaScript.
					</p>
					<p className="text-stone-300 mt-3">
						We do not use any tracking, analytics, or advertising cookies. Because we
						only use strictly necessary cookies, no cookie consent banner is required
						under the ePrivacy Directive (2002/58/EC).
					</p>
				</Card>

				{/* 9. Your Rights */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						8. Your Rights
					</h2>
					<p className="text-stone-300 mb-3">
						Under the GDPR, you have the following rights over your personal data:
					</p>
					<ul className="list-disc list-inside text-stone-300 space-y-2 ml-2">
						<li>
							<strong className="text-stone-100">Right of access</strong> &mdash; you
							can ask us for a copy of all personal data we hold about you
						</li>
						<li>
							<strong className="text-stone-100">Right to rectification</strong>{' '}
							&mdash; you can ask us to correct any inaccurate or incomplete data
							(e.g., change your nickname)
						</li>
						<li>
							<strong className="text-stone-100">Right to erasure</strong> &mdash; you
							can request that we delete your account and all associated data
						</li>
						<li>
							<strong className="text-stone-100">Right to restrict processing</strong>{' '}
							&mdash; you can ask us to limit how we use your data in certain
							situations
						</li>
						<li>
							<strong className="text-stone-100">Right to data portability</strong>{' '}
							&mdash; you can request your data in a structured, machine-readable
							format to transfer to another service
						</li>
						<li>
							<strong className="text-stone-100">Right to object</strong> &mdash; you
							can object to processing based on legitimate interest (Section 4)
						</li>
						<li>
							<strong className="text-stone-100">Right to withdraw consent</strong>{' '}
							&mdash; if any processing is based on your consent, you can withdraw it
							at any time. This does not affect the lawfulness of processing that
							happened before you withdrew consent.
						</li>
					</ul>
					<p className="text-stone-300 mt-3">
						To exercise any of these rights, contact us. details are at the top of the
						page.
					</p>
				</Card>

				{/* 10. Data Security */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						9. How We Protect Your Data
					</h2>
					<p className="text-stone-300">
						We take data security seriously and have implemented the following measures
						to keep your information safe:
					</p>
					<ul className="list-disc list-inside text-stone-300 space-y-1 ml-2 mt-2">
						<li>All connections are encrypted with TLS/HTTPS</li>
						<li>Passwords are stored using secure one-way cryptographic hashing</li>
						<li>Session tokens are hashed with BLAKE3 before being stored</li>
						<li>
							Authentication cookies are HttpOnly and Secure (not accessible to
							JavaScript, HTTPS only)
						</li>
						<li>
							Two-factor authentication is available for additional account protection
						</li>
						<li>CSRF protection via SameSite cookie policy</li>
					</ul>
					<p className="text-stone-300 mt-3">
						While no system is 100% secure, we actively work to protect your data
						against unauthorized access, alteration, and breaches.
					</p>
				</Card>

				{/* 11. Children's Privacy */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						10. Children&apos;s Privacy
					</h2>
					<p className="text-stone-300">
						This service is designed for teenagers and young adults. If you are under 16
						years of age, you need consent from a parent or legal guardian before
						creating an account, as required by GDPR Article 8.
					</p>
					<p className="text-stone-300 mt-3">
						If we learn that we have collected data from someone under 16 without proper
						parental consent, we will delete that data as quickly as possible. If you
						believe this applies to you or your child, please contact us.
					</p>
				</Card>

				{/* 12. Changes to This Policy */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						11. Changes to This Policy
					</h2>
					<p className="text-stone-300">
						We may update this privacy policy from time to time. When we do, we will
						update the &quot;Last updated&quot; date at the top of this page. We
						encourage you to check back occasionally.
					</p>
					<p className="text-stone-300 mt-3">
						For significant changes that affect how your data is processed, we will make
						reasonable efforts to notify you (for example, through an in-app notice).
					</p>
				</Card>

				{/* 13. Contact, Complaints & Legal References */}
				<Card>
					<h2 className="text-xl font-bold font-display text-gold-400 mb-4">
						12. Contact, Complaints &amp; Legal References
					</h2>
					<p className="text-stone-300">
						If you have questions about this privacy policy or want to exercise your
						rights, reach out to us.
					</p>
					<p className="text-stone-300 mt-3">
						If you believe your data protection rights have been violated, you have the
						right to lodge a complaint with a supervisory authority. In Berlin, this is
						the{' '}
						<strong className="text-stone-100">
							Berliner Beauftragte für Datenschutz und Informationsfreiheit
						</strong>{' '}
						(Berlin Commissioner for Data Protection and Freedom of Information).
					</p>
					<div className="mt-4 pt-4 border-t border-stone-700">
						<h3 className="text-stone-100 font-semibold mb-2">Legal references</h3>
						<ul className="list-disc list-inside text-stone-300 space-y-1 ml-2">
							<li>
								General Data Protection Regulation (GDPR) &mdash; Regulation (EU)
								2016/679
							</li>
							<li>
								ePrivacy Directive &mdash; Directive 2002/58/EC (as amended by
								2009/136/EC)
							</li>
						</ul>
					</div>
				</Card>
			</div>
		</main>
	);
}
