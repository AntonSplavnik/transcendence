use std::borrow::Cow;

use validator::ValidationError;

use crate::models::nickname::Nickname;

pub fn nickname(nickname: &Nickname) -> Result<(), ValidationError> {
    let nickname = nickname.as_str_unchecked();
    let len = nickname.len();

    let err = if nickname.trim() != nickname {
        ValidationError::new("trim").with_message(Cow::Borrowed(
            "Must not have leading or trailing whitespace.",
        ))
    } else if len < 3 || len > 16 {
        ValidationError::new("length")
            .with_message(Cow::Borrowed("Must be between 3 and 16 characters long."))
    } else if nickname.split_whitespace().count() != 1 {
        ValidationError::new("whitespace")
            .with_message(Cow::Borrowed("Must not contain whitespace."))
    } else if !nickname
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        ValidationError::new("invalid_chars").with_message(Cow::Borrowed(
            "Can only contain alphanumeric characters, underscores, or hyphens.",
        ))
    } else {
        return Ok(());
    };
    Err(err)
}

pub fn description(desc: &str) -> Result<(), ValidationError> {
    if desc.len() > 100 {
        return Err(ValidationError::new("length")
            .with_message(Cow::Borrowed("Must be at most 100 characters long.")));
    }
    Ok(())
}

pub fn password(password: &str) -> Result<(), ValidationError> {
    let len = password.len();

    if len < 8 || len > 128 {
        let err = ValidationError::new("length")
            .with_message(Cow::Borrowed("Must be between 8 and 128 characters long."));
        return Err(err);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── nickname ─────────────────────────────────────────────────────

    fn nick(s: &str) -> Nickname {
        Nickname::try_from(s).expect("nickname should fit in VarStr<16>")
    }

    #[test]
    fn nickname_valid_accepted() {
        assert!(nickname(&nick("alice")).is_ok());
    }

    #[test]
    fn nickname_exact_min_accepted() {
        assert!(
            nickname(&nick("abc")).is_ok(),
            "3-char nick must be accepted"
        );
    }

    #[test]
    fn nickname_exact_max_accepted() {
        assert!(
            nickname(&nick(&"a".repeat(16))).is_ok(),
            "16-char nick must be accepted"
        );
    }

    #[test]
    fn nickname_too_short_rejected() {
        assert!(
            nickname(&nick("ab")).is_err(),
            "2-char nick must be rejected"
        );
    }

    #[test]
    fn nickname_single_char_rejected() {
        assert!(
            nickname(&nick("x")).is_err(),
            "1-char nick must be rejected"
        );
    }

    #[test]
    fn nickname_empty_rejected() {
        assert!(nickname(&nick("")).is_err(), "empty nick must be rejected");
    }

    #[test]
    fn nickname_underscores_and_hyphens_accepted() {
        assert!(nickname(&nick("a_b-c")).is_ok());
    }

    #[test]
    fn nickname_special_chars_rejected() {
        assert!(nickname(&nick("user@name")).is_err());
        assert!(nickname(&nick("user!name")).is_err());
        assert!(nickname(&nick("user.name")).is_err());
    }

    #[test]
    fn nickname_whitespace_rejected() {
        assert!(nickname(&nick("has space")).is_err());
    }

    #[test]
    fn nickname_leading_space_rejected() {
        assert!(nickname(&nick(" abc")).is_err());
    }

    #[test]
    fn nickname_trailing_space_rejected() {
        assert!(nickname(&nick("abc ")).is_err());
    }

    #[test]
    fn nickname_digits_accepted() {
        assert!(nickname(&nick("player42")).is_ok());
    }

    #[test]
    fn nickname_all_digits_accepted() {
        assert!(nickname(&nick("12345678")).is_ok());
    }

    // ── description ──────────────────────────────────────────────────

    #[test]
    fn description_empty_accepted() {
        assert!(description("").is_ok(), "empty description must be accepted");
    }

    #[test]
    fn description_valid_accepted() {
        assert!(description("Hello, Comment ca va ?").is_ok());
    }

    #[test]
    fn description_exact_max_accepted() {
        assert!(
            description(&"a".repeat(100)).is_ok(),
            "100-char description must be accepted"
        );
    }

    #[test]
    fn description_above_max_rejected() {
        assert!(
            description(&"a".repeat(101)).is_err(),
            "101-char description must be rejected"
        );
    }

    // ── password ─────────────────────────────────────────────────────

    #[test]
    fn password_valid_accepted() {
        assert!(password("securepassword").is_ok());
    }

    #[test]
    fn password_exact_min_accepted() {
        assert!(
            password("12345678").is_ok(),
            "8-char password must be accepted"
        );
    }

    #[test]
    fn password_exact_max_accepted() {
        assert!(
            password(&"x".repeat(128)).is_ok(),
            "128-char password must be accepted"
        );
    }

    #[test]
    fn password_below_min_rejected() {
        assert!(
            password("1234567").is_err(),
            "7-char password must be rejected"
        );
    }

    #[test]
    fn password_above_max_rejected() {
        assert!(
            password(&"x".repeat(129)).is_err(),
            "129-char password must be rejected"
        );
    }

    #[test]
    fn password_empty_rejected() {
        assert!(password("").is_err(), "empty password must be rejected");
    }
}
