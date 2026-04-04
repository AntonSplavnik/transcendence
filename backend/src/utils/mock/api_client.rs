//! Adds `ApiClient` wrapping a `TestClient`

use cookie::CookieJar;
use salvo::{
    Response,
    http::{HeaderMap, Method, header::COOKIE},
    test::RequestBuilder,
};

use crate::utils::mock::server::Server;

pub struct ApiClient {
    server: Server,
    pub headers: HeaderMap,
    pub cookies: CookieJar,
}

impl ApiClient {
    pub fn new(server: &Server) -> Self {
        Self {
            server: server.clone(),
            headers: HeaderMap::new(),
            cookies: CookieJar::new(),
        }
    }

    /// Create a new client connected to a different server but carrying
    /// over all cookies and headers. Useful for testing against a server
    /// with a different `ToS` timestamp (same DB).
    pub fn rebind(&self, server: &Server) -> Self {
        Self {
            server: server.clone(),
            headers: self.headers.clone(),
            cookies: self.cookies.clone(),
        }
    }

    /// Create a new client connected to the same server but without any
    /// cookies or custom headers — i.e. an unauthenticated twin.
    pub fn unauthenticated(&self) -> Self {
        Self {
            server: self.server.clone(),
            headers: HeaderMap::new(),
            cookies: CookieJar::new(),
        }
    }

    /// Send a request through the test server, merging any Set-Cookie
    /// changes from the response into this client's cookie jar.
    pub async fn send(&mut self, req: RequestBuilder) -> Response {
        let res = req.send(&self.server).await;
        for cookie in res.cookies.delta() {
            let mut removal = cookie.clone();
            removal.make_removal();
            if cookie == &removal {
                self.cookies.force_remove(cookie.name());
            } else {
                self.cookies.force_remove(cookie.name());
                self.cookies.add_original(cookie.clone());
            }
        }
        res
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
        for (k, v) in &self.headers {
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
