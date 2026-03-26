use std::{fmt::Display, sync::Arc};

use salvo::http::StatusCode;
use salvo::test::RequestBuilder;

use crate::{
    models::nickname::Nickname,
    utils::mock::{api_client::ApiClient, server::Server},
};

pub struct Registered(pub i32);
pub struct Unregistered;

pub struct User<T = Unregistered> {
    pub client: ApiClient,
    pub nickname: Nickname,
    pub email: Box<str>,
    pub password: Arc<str>,
    pub id: T,
}

impl User<Unregistered> {
    pub fn new(
        server: &Server,
        nickname: Nickname,
        email: impl Into<Box<str>>,
        password: impl Into<Arc<str>>,
    ) -> Self {
        Self {
            client: server.client(),
            nickname,
            email: email.into(),
            password: password.into(),
            id: Unregistered,
        }
    }
}

impl<T> std::fmt::Debug for User<T>
where
    Self: Display,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self)
    }
}

impl Display for User<Unregistered> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "User<Unregistered> {{ nick: {}, email: {}, pw: {} }}",
            self.nickname, self.email, self.password
        )
    }
}

impl User<Registered> {
    pub fn user_id(&self) -> i32 {
        self.id.0
    }

    /// Assert that a guarded endpoint requires authentication.
    ///
    /// Builds the request via `build_req` on a **fresh unauthenticated** client
    /// (no cookies) and asserts the response is `401 UNAUTHORIZED`.
    ///
    /// ```ignore
    /// user.assert_requires_auth(|c| c.get("/api/user/me")).await;
    /// user.assert_requires_auth(|c| c.post("/api/user/logout")).await;
    /// ```
    pub async fn assert_requires_auth(&mut self, build_req: impl Fn(&ApiClient) -> RequestBuilder) {
        let mut unauthed = self.client.unauthenticated();
        let req = build_req(&unauthed);
        let res = unauthed.send(req).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::UNAUTHORIZED),
            "endpoint must reject unauthenticated requests"
        );
    }
}

impl Display for User<Registered> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "    User   {{ id: {}, nick: {}, email: {} }}",
            self.id.0, self.nickname, self.email
        )
    }
}
