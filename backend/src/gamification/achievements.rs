use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde::Serialize;

use crate::db::DbConn;
use crate::models::{Achievement, UserAchievement, UserStats};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, salvo::oapi::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AchievementTier {
    Bronze,
    Silver,
    Gold,
}

impl AchievementTier {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bronze => "bronze",
            Self::Silver => "silver",
            Self::Gold => "gold",
        }
    }
}

impl AchievementTier {
    fn xp_multiplier(self) -> i32 {
        match self {
            Self::Bronze => 1,
            Self::Silver => 2,
            Self::Gold => 3,
        }
    }
}

#[derive(Debug, Clone, Serialize, salvo::oapi::ToSchema)]
pub struct AchievementUnlock {
    pub achievement_id: i32,
    pub achievement_code: String,
    pub achievement_name: String,
    pub tier: AchievementTier,
    pub xp_reward: i32,
}

/// Map an achievement code to the corresponding stat value from `UserStats`.
/// Returns `None` for stats that don't exist yet in `user_stats`.
fn stat_value_for_code(code: &str, stats: &UserStats) -> Option<i32> {
    match code {
        "games_played" => Some(stats.games_played),
        "games_won" => Some(stats.games_won),
        "win_streak" => Some(stats.best_win_streak),
        _ => None,
    }
}

/// Check all achievements for a user after a game is recorded.
/// Returns a list of newly unlocked tiers with their XP rewards.
pub fn check_achievements(
    conn: &mut DbConn,
    user_id: i32,
    stats: &UserStats,
) -> Result<Vec<AchievementUnlock>, diesel::result::Error> {
    use crate::schema::achievements::dsl as ach_dsl;
    use crate::schema::user_achievements::dsl as ua_dsl;

    let all_achievements = ach_dsl::achievements.load::<Achievement>(conn)?;
    let mut unlocks = Vec::new();
    let now = Utc::now();

    for achievement in &all_achievements {
        let Some(current_value) = stat_value_for_code(&achievement.code, stats) else {
            continue;
        };

        // Get or create user_achievement row
        let existing: Option<UserAchievement> = ua_dsl::user_achievements
            .filter(ua_dsl::user_id.eq(user_id))
            .filter(ua_dsl::achievement_id.eq(achievement.id))
            .first::<UserAchievement>(conn)
            .optional()?;

        let (mut bronze_at, mut silver_at, mut gold_at) = match &existing {
            Some(ua) => (
                ua.bronze_unlocked_at,
                ua.silver_unlocked_at,
                ua.gold_unlocked_at,
            ),
            None => (None, None, None),
        };

        // Check each tier
        let mut new_unlocks_for_this = Vec::new();

        if bronze_at.is_none() && current_value >= achievement.bronze_threshold {
            bronze_at = Some(now);
            new_unlocks_for_this.push(AchievementTier::Bronze);
        }
        if silver_at.is_none() && current_value >= achievement.silver_threshold {
            silver_at = Some(now);
            new_unlocks_for_this.push(AchievementTier::Silver);
        }
        if gold_at.is_none() && current_value >= achievement.gold_threshold {
            gold_at = Some(now);
            new_unlocks_for_this.push(AchievementTier::Gold);
        }

        if new_unlocks_for_this.is_empty() {
            // Still update progress if it changed
            if existing
                .as_ref()
                .is_none_or(|ua| ua.current_progress != current_value)
            {
                upsert_user_achievement(
                    conn,
                    &UpsertUserAchievement {
                        user_id,
                        achievement_id: achievement.id,
                        current_progress: current_value,
                        bronze_unlocked_at: bronze_at,
                        silver_unlocked_at: silver_at,
                        gold_unlocked_at: gold_at,
                        exists: existing.is_some(),
                    },
                )?;
            }
            continue;
        }

        // Upsert the user_achievement row
        upsert_user_achievement(
            conn,
            &UpsertUserAchievement {
                user_id,
                achievement_id: achievement.id,
                current_progress: current_value,
                bronze_unlocked_at: bronze_at,
                silver_unlocked_at: silver_at,
                gold_unlocked_at: gold_at,
                exists: existing.is_some(),
            },
        )?;

        for tier in new_unlocks_for_this {
            unlocks.push(AchievementUnlock {
                achievement_id: achievement.id,
                achievement_code: achievement.code.clone(),
                achievement_name: achievement.name.clone(),
                tier,
                xp_reward: achievement.base_xp_reward * tier.xp_multiplier(),
            });
        }
    }

    Ok(unlocks)
}

struct UpsertUserAchievement {
    user_id: i32,
    achievement_id: i32,
    current_progress: i32,
    bronze_unlocked_at: Option<DateTime<Utc>>,
    silver_unlocked_at: Option<DateTime<Utc>>,
    gold_unlocked_at: Option<DateTime<Utc>>,
    exists: bool,
}

fn upsert_user_achievement(
    conn: &mut DbConn,
    upsert: &UpsertUserAchievement,
) -> Result<(), diesel::result::Error> {
    use crate::schema::user_achievements::dsl;

    if upsert.exists {
        diesel::update(
            dsl::user_achievements
                .filter(dsl::user_id.eq(upsert.user_id))
                .filter(dsl::achievement_id.eq(upsert.achievement_id)),
        )
        .set((
            dsl::current_progress.eq(upsert.current_progress),
            dsl::bronze_unlocked_at.eq(upsert.bronze_unlocked_at),
            dsl::silver_unlocked_at.eq(upsert.silver_unlocked_at),
            dsl::gold_unlocked_at.eq(upsert.gold_unlocked_at),
        ))
        .execute(conn)?;
    } else {
        diesel::insert_into(dsl::user_achievements)
            .values((
                dsl::user_id.eq(upsert.user_id),
                dsl::achievement_id.eq(upsert.achievement_id),
                dsl::current_progress.eq(upsert.current_progress),
                dsl::bronze_unlocked_at.eq(upsert.bronze_unlocked_at),
                dsl::silver_unlocked_at.eq(upsert.silver_unlocked_at),
                dsl::gold_unlocked_at.eq(upsert.gold_unlocked_at),
            ))
            .execute(conn)?;
    }

    Ok(())
}
