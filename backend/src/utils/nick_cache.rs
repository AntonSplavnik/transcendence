use crate::{db, models::nickname::Nickname, utils::mem_cache::LruMemCache};
use diesel::prelude::*;
use smallvec::SmallVec;

pub trait NicknameCache: Sync + Send {
    type TryGetManyError;

    /// Should only fail if the user does not exist.
    fn try_get(&self, user_id: i32) -> Option<Nickname>;
    /// i.e. to add newly registered user to the cache, before that user is ever requested.
    fn add(&self, user_id: i32, nickname: Nickname);

    fn get(&self, user_id: i32) -> Nickname {
        self.try_get(user_id)
            .expect("Caller must ensure user exists")
    }

    /// By default this will only return entries where try_get succeeds.
    fn get_many<I>(&self, user_ids: I) -> SmallVec<[(i32, Nickname); 6]>
    where
        I: IntoIterator<Item = i32>,
    {
        user_ids
            .into_iter()
            .filter_map(|user_id| {
                self.try_get(user_id).map(|name| (user_id, name))
            })
            .collect()
    }

    /// By default this will only return entries where try_get succeeds.
    /// Always returns Ok.
    fn try_get_many<I>(
        &self,
        user_ids: I,
    ) -> Result<SmallVec<[(i32, Nickname); 6]>, Self::TryGetManyError>
    where
        I: IntoIterator<Item = i32>,
    {
        Ok(self.get_many(user_ids))
    }
}

#[derive(Debug)]
pub struct NickLruMapCache(LruMemCache<i32, Nickname>);

impl NickLruMapCache {
    pub const fn new(max_length: u32) -> Self {
        Self(LruMemCache::with_max_length(max_length))
    }
}

impl NicknameCache for NickLruMapCache {
    type TryGetManyError = diesel::result::Error;

    #[inline]
    fn try_get(&self, user_id: i32) -> Option<Nickname> {
        self.0
            .get_or_insert_with(user_id, || {
                use crate::schema::users::dsl::*;
                let conn = &mut db::get();
                users.filter(id.eq(user_id)).select(nickname).first(conn)
            })
            .ok()
    }

    #[inline]
    fn get_many<I>(&self, user_ids: I) -> SmallVec<[(i32, Nickname); 6]>
    where
        I: IntoIterator<Item = i32>,
    {
        self.try_get_many(user_ids).unwrap_or_default()
    }

    #[inline]
    fn try_get_many<I>(
        &self,
        user_ids: I,
    ) -> Result<SmallVec<[(i32, Nickname); 6]>, Self::TryGetManyError>
    where
        I: IntoIterator<Item = i32>,
    {
        self.0.many_get_or_insert_bulk(user_ids, bulk_get)
    }

    #[inline]
    fn add(&self, user_id: i32, nickname: Nickname) {
        self.0.insert(user_id, nickname);
    }
}

/// A [`NicknameCache`] backed by a time-to-idle (TTI) eviction policy.
///
/// Unlike [`NickLruMapCache`], this cache is unbounded in capacity — entries
/// are only evicted when they have not been accessed for the configured TTI
/// duration. This makes it ideal for workloads where the active user set
/// fluctuates but should never be artificially capped.
#[derive(Debug)]
pub struct NickTTICache(crate::utils::mem_cache::TTIMemCache<i32, Nickname>);

impl NickTTICache {
    /// Creates a new unbounded TTI nickname cache.
    #[inline]
    pub fn new(tti: std::time::Duration) -> Self {
        Self(crate::utils::mem_cache::TTIMemCache::unbounded_with_tti(
            tti,
        ))
    }
}

impl NicknameCache for NickTTICache {
    type TryGetManyError = diesel::result::Error;

    #[inline]
    fn try_get(&self, user_id: i32) -> Option<Nickname> {
        if let Some(nick) = self.0.get(&user_id) {
            return Some(nick);
        }
        let nick: Nickname = {
            use crate::schema::users::dsl::*;
            let conn = &mut db::get();
            users
                .filter(id.eq(user_id))
                .select(nickname)
                .first(conn)
                .ok()?
        };
        self.0.insert(user_id, nick);
        Some(nick)
    }

    #[inline]
    fn get_many<I>(&self, user_ids: I) -> SmallVec<[(i32, Nickname); 6]>
    where
        I: IntoIterator<Item = i32>,
    {
        self.try_get_many(user_ids).unwrap_or_default()
    }

    #[inline]
    fn try_get_many<I>(
        &self,
        user_ids: I,
    ) -> Result<SmallVec<[(i32, Nickname); 6]>, Self::TryGetManyError>
    where
        I: IntoIterator<Item = i32>,
    {
        self.0.many_get_or_insert_bulk(user_ids, bulk_get)
    }

    #[inline]
    fn add(&self, user_id: i32, nickname: Nickname) {
        self.0.insert(user_id, nickname);
    }
}

#[inline]
fn bulk_get<const N: usize>(
    missing: SmallVec<[i32; 14]>,
    results: &mut SmallVec<[(i32, Nickname); N]>,
) -> Result<(), diesel::result::Error> {
    use crate::schema::users::dsl::*;
    let conn = &mut db::get();
    let rows: Vec<(i32, Nickname)> = users
        .filter(id.eq_any(missing))
        .select((id, nickname))
        .load(conn)?;
    results.extend(rows);
    Ok(())
}
