use std::sync::Arc;

use parking_lot::Mutex;
use salvo::{Service, test::SendTarget};
use tracing_appender::non_blocking::WorkerGuard;

use crate::{
    db::Db,
    email::Mailer,
    tos::CurrentTosTimestamp,
    utils::mock::{
        api_client::ApiClient,
        generators::{NickGenerator, UserGenerator},
        user::{Unregistered, User},
    },
};

#[derive(Clone)]
pub struct Server {
    pub host: Arc<str>,
    pub db: Db,
    pub mailer: Mailer,
    pub logger: Option<Arc<WorkerGuard>>,
    pub service: Arc<Service>,
    pub unique_nicks: Arc<Mutex<NickGenerator>>,
}

impl Server {
    pub fn new(
        host: impl Into<Arc<str>>,
        db: Db,
        mailer: Mailer,
        logger: Option<WorkerGuard>,
        service: Service,
    ) -> Self {
        Self {
            host: host.into(),
            db,
            mailer,
            logger: logger.map(Arc::new),
            service: Arc::new(service),
            unique_nicks: Arc::new(Mutex::new(NickGenerator::new())),
        }
    }

    /// Create a default test server with the given database and ToS timestamp.
    pub fn default_with(db: Db, tos_timestamp: CurrentTosTimestamp) -> Self {
        let mailer = Mailer::new();
        let router = crate::routers::rest_api(db.clone(), tos_timestamp, mailer.clone());
        Server {
            host: "http://localhost".into(),
            db,
            mailer,
            logger: None,
            service: Arc::new(Service::new(router)),
            unique_nicks: Arc::new(Mutex::new(NickGenerator::new())),
        }
    }

    /// Create a new server sharing this server's database but with a
    /// different ToS timestamp. Useful for testing ToS version changes.
    pub fn with_tos(&self, tos_timestamp: CurrentTosTimestamp) -> Self {
        Self::default_with(self.db.clone(), tos_timestamp)
    }

    pub fn client(&self) -> ApiClient {
        ApiClient::new(self)
    }

    pub fn user(&self) -> User<Unregistered> {
        self.user_generator()
            .next()
            .expect("403291461126605635584000000 unique nicknames should be enough for everyone")
    }

    pub fn user_generator(&self) -> UserGenerator<'_> {
        UserGenerator { server: &self }
    }
}

impl Default for Server {
    fn default() -> Self {
        let db = Db::new_test().expect("Failed to create test database");
        Self::default_with(db, CurrentTosTimestamp::now())
    }
}

impl SendTarget for &Server {
    fn call(self, req: salvo::Request) -> impl Future<Output = salvo::Response> + Send {
        SendTarget::call(&*self.service, req)
    }
}
