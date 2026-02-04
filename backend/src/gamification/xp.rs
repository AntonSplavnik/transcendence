/// XP lookup table for Hook phase (levels 1-5)
const HOOK_XP: [i32; 5] = [25, 38, 50, 63, 75];

/// XP required to reach the next level from current level
pub fn xp_for_next_level(current_level: i32) -> i32 {
    match current_level {
        // Phase 1: Hook (Lvl 1-5) - Very fast, 1-3 matches
        1..=5 => HOOK_XP[(current_level - 1) as usize],

        // Phase 2: Learning (Lvl 6-20) - Progressive slowdown, 4-10 matches
        6..=20 => 100 + (current_level - 6) * 10,

        // Phase 3: Cruising (Lvl 21+) - Linear flat, ~10 matches
        _ => 250,
    }
}

/// Total XP required to reach a specific level from level 1
pub fn total_xp_for_level(target_level: i32) -> i32 {
    (1..target_level).map(xp_for_next_level).sum()
}

/// Calculate current level from total XP
pub fn level_from_xp(total_xp: i32) -> i32 {
    let mut level = 1;
    let mut xp_remaining = total_xp;

    while xp_remaining >= xp_for_next_level(level) {
        xp_remaining -= xp_for_next_level(level);
        level += 1;
    }

    level
}

/// Calculate XP progress within current level
pub fn xp_in_current_level(total_xp: i32) -> i32 {
    let current_level = level_from_xp(total_xp);
    total_xp - total_xp_for_level(current_level)
}

/// Calculate progress percentage to next level (0.0 to 100.0)
pub fn level_progress_percent(total_xp: i32) -> f32 {
    let current_level = level_from_xp(total_xp);
    let xp_into_level = xp_in_current_level(total_xp);
    let xp_needed = xp_for_next_level(current_level);

    (xp_into_level as f32 / xp_needed as f32) * 100.0
}

/// XP rewards for game outcomes
pub mod rewards {
    /// Base XP for playing a game (participation)
    pub const GAME_PLAYED: i32 = 10;

    /// Bonus XP for winning
    pub const GAME_WON: i32 = 25;

    /// Bonus XP per win streak (starting at 3)
    pub const WIN_STREAK_BONUS: i32 = 5;

    /// Maximum win streak bonus
    pub const WIN_STREAK_BONUS_CAP: i32 = 25;

    /// Minimum streak to start getting bonus
    pub const WIN_STREAK_THRESHOLD: i32 = 3;

    /// Calculate total XP for a game result
    pub fn calculate_game_xp(won: bool, current_streak: i32) -> i32 {
        let mut xp = GAME_PLAYED;

        if won {
            xp += GAME_WON;

            // Win streak bonus (starts at 3 wins)
            if current_streak >= WIN_STREAK_THRESHOLD {
                let streak_bonus = (current_streak - WIN_STREAK_THRESHOLD + 1) * WIN_STREAK_BONUS;
                xp += streak_bonus.min(WIN_STREAK_BONUS_CAP);
            }
        }

        xp
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hook_phase_xp() {
        assert_eq!(xp_for_next_level(1), 25);
        assert_eq!(xp_for_next_level(2), 38);
        assert_eq!(xp_for_next_level(5), 75);
    }

    #[test]
    fn test_learning_phase_xp() {
        assert_eq!(xp_for_next_level(6), 100);
        assert_eq!(xp_for_next_level(10), 140);
        assert_eq!(xp_for_next_level(20), 240);
    }

    #[test]
    fn test_cruising_phase_xp() {
        assert_eq!(xp_for_next_level(21), 250);
        assert_eq!(xp_for_next_level(50), 250);
        assert_eq!(xp_for_next_level(100), 250);
    }

    #[test]
    fn test_level_from_xp() {
        assert_eq!(level_from_xp(0), 1);
        assert_eq!(level_from_xp(24), 1);
        assert_eq!(level_from_xp(25), 2);
        assert_eq!(level_from_xp(63), 3);
        assert_eq!(level_from_xp(711), 10);
    }

    #[test]
    fn test_total_xp_for_level() {
        assert_eq!(total_xp_for_level(1), 0);
        assert_eq!(total_xp_for_level(2), 25);
        assert_eq!(total_xp_for_level(6), 251);
    }

    #[test]
    fn test_game_xp_calculation() {
        use rewards::*;

        // Loss
        assert_eq!(calculate_game_xp(false, 0), 10);

        // Win without streak
        assert_eq!(calculate_game_xp(true, 1), 35);

        // Win with 3 streak (first bonus)
        assert_eq!(calculate_game_xp(true, 3), 40);

        // Win with 8 streak (capped bonus)
        assert_eq!(calculate_game_xp(true, 8), 60);
    }
}
