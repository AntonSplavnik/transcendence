use std::io::Write;
use std::sync::{Arc, LazyLock};

use crate::models::blob::{Str, WritableVarBlob};
use crate::models::nickname::Nickname;
use crate::utils::mock::server::Server;
use crate::utils::mock::user::{Unregistered, User};
use crate::validate;

const NICK_MIN_LEN: usize = 3;
const NICK_MAX_LEN: usize = 16;
const NICK_CHARSET: &[u8; 26] = b"abcdefghijklmnopqrstuvwxyz";
const NICK_LAST_INDEX: usize = NICK_CHARSET.len() - 1;

pub struct NickGenerator {
    len: usize,
    indices: [usize; NICK_MAX_LEN],
    exhausted: bool,
}

impl NickGenerator {
    pub const fn new() -> Self {
        Self {
            len: NICK_MAX_LEN,
            indices: [NICK_LAST_INDEX; NICK_MAX_LEN],
            exhausted: false,
        }
    }

    fn build_current(&self) -> Nickname {
        let mut nickname = WritableVarBlob::<NICK_MAX_LEN, Str>::new();
        for i in 0..self.len {
            nickname
                .write(&[NICK_CHARSET[self.indices[i]]])
                .expect("writing nickname bytes should not fail");
        }
        let nickname = nickname.finish();
        debug_assert!(
            validate::nickname(&nickname).is_ok(),
            "generated nickname should be valid"
        );
        nickname
    }

    fn advance(&mut self) {
        for pos in (0..self.len).rev() {
            if self.indices[pos] > 0 {
                self.indices[pos] -= 1;
                return;
            }
            self.indices[pos] = NICK_LAST_INDEX;
        }

        if self.len > NICK_MIN_LEN {
            self.len -= 1;
            self.indices = [NICK_LAST_INDEX; NICK_MAX_LEN];
        } else {
            self.exhausted = true;
        }
    }
}

impl Iterator for NickGenerator {
    type Item = Nickname;

    fn next(&mut self) -> Option<Self::Item> {
        if self.exhausted {
            return None;
        }

        let nickname = self.build_current();
        self.advance();
        Some(nickname)
    }
}

pub struct UserGenerator<'srv> {
    pub server: &'srv Server,
}

impl Iterator for UserGenerator<'_> {
    type Item = User<Unregistered>;

    fn next(&mut self) -> Option<Self::Item> {
        static PASSWORD: LazyLock<Arc<str>> = LazyLock::new(|| "securepass".into());

        let nickname = { self.server.unique_nicks.lock().next()? };
        let email = format!("{}@te.st", nickname);
        Some(User::new(
            &self.server,
            nickname,
            email,
            Arc::clone(&*PASSWORD),
        ))
    }
}
