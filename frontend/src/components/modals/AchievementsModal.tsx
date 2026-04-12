import { Trophy } from 'lucide-react';
import Modal from '../ui/Modal';
import Card from '../ui/Card';
import { LoadingSpinner } from '../ui';
import { useAchievements } from '../../hooks/useAchievements';
import type { AchievementWithProgress } from '../../api/types';

interface AchievementsModalProps {
	onClose: () => void;
}

function getNextTier(a: AchievementWithProgress) {
	if (!a.bronze_unlocked) return { target: a.bronze_threshold, label: 'to Bronze' };
	if (!a.silver_unlocked) return { target: a.silver_threshold, label: 'to Silver' };
	if (!a.gold_unlocked) return { target: a.gold_threshold, label: 'to Gold' };
	return null;
}

function AchievementCard({ a }: { a: AchievementWithProgress }) {
	const next = getNextTier(a);
	const progressPct = next
		? Math.min(100, Math.round((a.current_progress / next.target) * 100))
		: 100;

	const tiers = [
		{
			label: 'Bronze',
			threshold: a.bronze_threshold,
			unlocked: a.bronze_unlocked,
			color: 'text-warning',
			border: 'border-warning/40',
		},
		{
			label: 'Silver',
			threshold: a.silver_threshold,
			unlocked: a.silver_unlocked,
			color: 'text-stone-300',
			border: 'border-stone-500/40',
		},
		{
			label: 'Gold',
			threshold: a.gold_threshold,
			unlocked: a.gold_unlocked,
			color: 'text-gold',
			border: 'border-gold/40',
		},
	];

	return (
		<Card variant="inset" padding="sm">
			<div className="flex items-start justify-between mb-1">
				<span className="font-semibold text-stone-100 text-sm">{a.name}</span>
				<span className="text-xs text-stone-500 bg-stone-800 px-2 py-0.5 rounded ml-2 shrink-0">
					{a.category}
				</span>
			</div>
			<p className="text-xs text-stone-400 mb-3">{a.description}</p>

			{/* Progress bar */}
			<div className="mb-1 flex items-center justify-between text-xs text-stone-400">
				<span>
					{a.current_progress} / {next?.target ?? a.gold_threshold}{' '}
					{next ? next.label : 'All tiers unlocked'}
				</span>
				<span>{progressPct}%</span>
			</div>
			<div className="h-2 bg-stone-700 rounded-full overflow-hidden mb-3">
				<div
					className="h-full bg-warning rounded-full transition-all duration-300"
					style={{ width: `${progressPct}%` }}
				/>
			</div>

			{/* Tier badges */}
			<div className="flex gap-2">
				{tiers.map((tier) => (
					<div
						key={tier.label}
						className={`flex-1 border rounded-md px-2 py-1.5 text-center ${tier.border} ${
							tier.unlocked ? '' : 'opacity-50'
						}`}
					>
						<p className={`text-xs font-semibold ${tier.color}`}>{tier.label}</p>
						<p className="text-xs text-stone-400">{tier.threshold}</p>
						{tier.unlocked ? (
							<p className="text-xs text-success mt-0.5">✓ Unlocked</p>
						) : (
							<p className="text-xs text-stone-500 mt-0.5">Locked</p>
						)}
					</div>
				))}
			</div>
		</Card>
	);
}

export default function AchievementsModal({ onClose }: AchievementsModalProps) {
	const { achievements, loading } = useAchievements();

	const categories = achievements ? [...new Set(achievements.map((a) => a.category))] : [];

	return (
		<Modal
			maxWidth="xl"
			title="Achievements"
			icon={<Trophy className="w-6 h-6 text-warning" />}
			onClose={onClose}
		>
			{loading ? (
				<div className="flex justify-center py-8">
					<LoadingSpinner size="md" />
				</div>
			) : !achievements || achievements.length === 0 ? (
				<p className="text-stone-400 text-sm text-center py-8">
					No achievements available.
				</p>
			) : (
				<div className="space-y-6">
					{categories.map((category) => (
						<section key={category}>
							<h3 className="text-sm font-semibold text-stone-300 uppercase tracking-wider mb-3">
								{category.charAt(0).toUpperCase() + category.slice(1)}
							</h3>
							<div className="space-y-3">
								{achievements
									.filter((a) => a.category === category)
									.map((a) => (
										<AchievementCard key={a.id} a={a} />
									))}
							</div>
						</section>
					))}
				</div>
			)}
		</Modal>
	);
}
