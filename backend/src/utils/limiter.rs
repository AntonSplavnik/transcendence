#[cfg(not(test))]
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::time::Duration;

use pingora_limits::rate::Rate;
use salvo::http::StatusCode;
use salvo::{async_trait, Depot, FlowCtrl, Handler, Request, Response, Router};

use crate::auth::DepotAuthExt;

const RATE_HASHES: usize = 3;
const RATE_SLOTS: usize = 512;

#[cfg(not(test))]
static RATE_LIMITED_COUNTERS: [AtomicUsize; 8] = [
    AtomicUsize::new(0),
    AtomicUsize::new(0),
    AtomicUsize::new(0),
    AtomicUsize::new(0),
    AtomicUsize::new(0),
    AtomicUsize::new(0),
    AtomicUsize::new(0),
    AtomicUsize::new(0),
];

#[cfg(not(test))]
pub fn periodic_rate_limit_report() {
    use tokio::time::interval;

    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(60 * 10));
        loop {
            interval.tick().await;
            let total = RATE_LIMITED_COUNTERS.iter().fold(0, |out, counter| {
                out + counter.swap(0, std::sync::atomic::Ordering::Relaxed)
            });
            if total > 0 {
                tracing::warn!("Rate limited requests in the last 10 minutes: {}", total);
            }
        }
    });
}

pub trait RouterRateLimitExt {
    fn ip_rate_limit(self, quota: &RateLimit) -> Self;
    /// also sets an IP rate limit to 5x the user rate limit
    fn user_rate_limit(self, quota: &RateLimit) -> Self;
}

// TODO Could improve memory usage and performance (cache-locality)
// by forking pingora-limits (or writing our own impl)
// and use AtomicU32 instead of AtomicIsize in the count-min sketch algo

#[derive(Clone)]
pub struct RateLimit {
    rate: Arc<Rate>,
    limit: u32,
}

impl RateLimit {
    #[must_use]
    pub fn new(limit: u32, interval: Duration) -> Self {
        let limit = limit.max(1);
        let interval = interval.max(Duration::from_secs(1));

        Self {
            rate: Arc::new(Rate::new_with_estimator_config(
                interval,
                RATE_HASHES,
                RATE_SLOTS,
            )),
            limit,
        }
    }

    #[must_use]
    pub fn per_minute(limit: u32) -> Self {
        Self::new(limit, Duration::from_secs(60))
    }

    #[must_use]
    pub fn per_5_minutes(limit: u32) -> Self {
        Self::new(limit, Duration::from_secs(300))
    }

    #[must_use]
    pub fn per_15_minutes(limit: u32) -> Self {
        Self::new(limit, Duration::from_secs(900))
    }

    #[must_use]
    pub fn per_day(limit: u32) -> Self {
        Self::new(limit, Duration::from_secs(86400))
    }

    async fn rate_limit<T: std::hash::Hash>(
        &self,
        key: &T,
        res: &mut Response,
        ctrl: &mut FlowCtrl,
    ) {
        let observed = self.rate.observe(key, 1);

        if observed <= 0 || observed > self.limit as isize {
            #[cfg(not(test))]
            RATE_LIMITED_COUNTERS[observed as usize % RATE_LIMITED_COUNTERS.len()]
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            res.status_code(StatusCode::TOO_MANY_REQUESTS);
            ctrl.cease();
        }
    }
}

#[derive(Clone)]
struct IpRateLimitHoop(RateLimit);

#[async_trait]
impl Handler for IpRateLimitHoop {
    async fn handle(
        &self,
        req: &mut Request,
        _: &mut Depot,
        res: &mut Response,
        ctrl: &mut FlowCtrl,
    ) {
        let ip = match req.remote_addr() {
            salvo::conn::SocketAddr::IPv4(a) => a.ip().to_ipv6_mapped(),
            salvo::conn::SocketAddr::IPv6(a) => *a.ip(),
            _ => return,
        };
        self.0.rate_limit(&ip, res, ctrl).await;
    }
}

#[derive(Clone)]
struct UserRateLimitHoop(RateLimit);

#[async_trait]
impl Handler for UserRateLimitHoop {
    async fn handle(
        &self,
        _: &mut Request,
        depot: &mut Depot,
        res: &mut Response,
        ctrl: &mut FlowCtrl,
    ) {
        let user_id = depot.user_id();
        self.0.rate_limit(&user_id, res, ctrl).await;
    }
}

impl RouterRateLimitExt for Router {
    fn ip_rate_limit(self, quota: &RateLimit) -> Self {
        self.hoop(IpRateLimitHoop(quota.clone()))
    }

    fn user_rate_limit(self, quota: &RateLimit) -> Self {
        self.hoop(UserRateLimitHoop(quota.clone()))
            .hoop(IpRateLimitHoop(RateLimit {
                rate: Arc::clone(&quota.rate),
                limit: quota.limit * 5,
            }))
    }
}
