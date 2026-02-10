//! Adds ApiClient wrapping a TestClient

use cookie::CookieJar;
use salvo::{
    Response,
    http::{HeaderMap, Method, header::COOKIE},
    test::RequestBuilder,
};

use crate::utils::mock::server::Server;

pub trait ApiClientRequestExt {
    async fn client_send(self, client: &mut ApiClient) -> Response;
}

impl ApiClientRequestExt for RequestBuilder {
    async fn client_send(self, client: &mut ApiClient) -> Response {
        let res = self.send(&client.server).await;
        client.cookies = res.cookies.clone();
        client.apply_cookie_changes();
        res
    }
}

pub struct ApiClient {
    server: Server,
    pub headers: HeaderMap,
    pub cookies: CookieJar,
}

impl ApiClient {
    pub fn new(server: &Server) -> Self {
        ApiClient {
            server: server.clone(),
            headers: HeaderMap::new(),
            cookies: CookieJar::new(),
        }
    }

    fn apply_cookie_changes(&mut self) {
        // using self.cookies.delta() to track added/removed cookies and update self.cookies accordingly
        let delta_cookies = self.cookies.clone();
        self.cookies.reset_delta();
        for cookie in delta_cookies.delta() {
            let mut removal = cookie.clone();
            removal.make_removal();
            if cookie == &removal {
                self.cookies.force_remove(cookie.name());
            } else {
                self.cookies.add_original(cookie.clone());
            }
        }
    }

    pub fn request(&self, path: impl std::fmt::Display, method: Method) -> RequestBuilder {
        let cookie_header = self.cookies.iter().fold(String::new(), |acc, cookie| {
            if acc.is_empty() {
                cookie.encoded().to_string()
            } else {
                format!("{}; {}", acc, cookie.encoded())
            }
        });
        let mut req = RequestBuilder::new(format!("{}{}", self.server.host, path), method);
        for (k, v) in self.headers.iter() {
            req = req.add_header(k.clone(), v.clone(), true);
        }
        req = req.add_header(COOKIE, cookie_header, true);
        req
    }

    pub fn get(&self, path: impl std::fmt::Display) -> RequestBuilder {
        self.request(path, Method::GET)
    }

    pub fn post(&self, path: impl std::fmt::Display) -> RequestBuilder {
        self.request(path, Method::POST)
    }

    pub fn put(&self, path: impl std::fmt::Display) -> RequestBuilder {
        self.request(path, Method::PUT)
    }

    pub fn delete(&self, path: impl std::fmt::Display) -> RequestBuilder {
        self.request(path, Method::DELETE)
    }
}
