import React from "react";
import Card from "./ui/Card";

interface Achievement {
    id: string;
    title: string;
    description: string;
    icon: string;
}

const ALL_ACHIEVEMENTS: Achievement[] = [
    {
        id: "KILL_10",
        title: "Monster Hunter I",
        description: "Kill 10 monsters in total",
        icon: "👹",
    },
    {
        id: "KILL_100",
        title: "Monster Hunter II",
        description: "Kill 100 monsters in total",
        icon: "💀",
    },
];

interface AchievementsProps {
    unlockedIds: string[];
}

export default function Achievements({ unlockedIds }: AchievementsProps) {
    return (
        <Card className="mt-6">
            <h2 className="text-2xl font-bold text-primary mb-4">Achievements</h2>
            <div className="grid grid-cols-1 gap-4">
                {ALL_ACHIEVEMENTS.map((achievement) => {
                    const isUnlocked = unlockedIds.includes(achievement.id);
                    return (
                        <div
                            key={achievement.id}
                            className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
                                isUnlocked
                                    ? "bg-green-900/20 border-green-500/50"
                                    : "bg-wood-900/50 border-wood-700 opacity-50 grayscale"
                            }`}
                        >
                            <div className="text-3xl bg-wood-700/50 p-2 rounded-full w-12 h-12 flex items-center justify-center">
                                {achievement.icon}
                            </div>
                            <div className="flex-1">
                                <h3 className={`font-bold ${isUnlocked ? "text-green-400" : "text-wood-300"}`}>
                                    {achievement.title}
                                </h3>
                                <p className="text-sm text-wood-400">{achievement.description}</p>
                            </div>
                            {isUnlocked && (
                                <div className="text-green-500 text-xs font-bold uppercase tracking-wider">
                                    Unlocked
                                </div>
                            )}
                        </div>
                    );
                })}
                {ALL_ACHIEVEMENTS.length === 0 && (
                    <p className="text-wood-500 italic text-center py-4">No achievements available yet.</p>
                )}
            </div>
        </Card>
    );
}
