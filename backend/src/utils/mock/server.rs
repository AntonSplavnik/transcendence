use std::{future::Future, sync::Arc};

use parking_lot::Mutex;
use salvo::{test::SendTarget, Service};
use tracing_appender::non_blocking::WorkerGuard;

use crate::{
    db::Db,
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
    pub logger: Option<Arc<WorkerGuard>>,
    pub service: Arc<Service>,
    pub unique_nicks: Arc<Mutex<NickGenerator>>,
}

impl Server {
    pub fn new(
        host: impl Into<Arc<str>>,
        db: Db,
        logger: Option<WorkerGuard>,
        service: Service,
    ) -> Self {
        Self {
            host: host.into(),
            db,
            logger: logger.map(Arc::new),
            service: Arc::new(service),
            unique_nicks: Arc::new(Mutex::new(NickGenerator::new())),
        }
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

        let router = crate::routers::rest_api(db.clone());
        Server {
            host: "http://localhost".into(),
            db,
            logger: None,
            service: Arc::new(Service::new(router)),
            unique_nicks: Arc::new(Mutex::new(NickGenerator::new())),
        }
    }
}

impl SendTarget for &Server {
    fn call(self, req: salvo::Request) -> impl Future<Output = salvo::Response> + Send {
        SendTarget::call(&*self.service, req)
    }
}
