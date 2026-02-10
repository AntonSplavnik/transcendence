use std::{fmt::Display, sync::Arc};

use crate::{
    models::nickname::Nickname,
    utils::mock::{api_client::ApiClient, server::Server},
};

pub struct Registered(i32);
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

impl Display for User<Registered> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "    User   {{ id: {}, nick: {}, email: {} }}",
            self.id.0, self.nickname, self.email
        )
    }
}
