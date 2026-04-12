use std::time::Instant;

use tracing::{Instrument, Level};

use salvo::http::{Request, ResBody, Response, StatusCode};
use salvo::{Depot, FlowCtrl, Handler, async_trait};

/// ----------
/// Copied from salvo crate with minor modification to check for ctrl-flow deceased state
/// ----------
/// A simple logger middleware.
pub struct Logger;

#[async_trait]
impl Handler for Logger {
    async fn handle(
        &self,
        req: &mut Request,
        depot: &mut Depot,
        res: &mut Response,
        ctrl: &mut FlowCtrl,
    ) {
        let span = tracing::span!(
            Level::INFO,
            "Request",
            remote_addr = %req.remote_addr().to_string(),
            version = ?req.version(),
            method = %req.method(),
            path = %req.uri(),
        );

        async move {
            let now = Instant::now();
            ctrl.call_next(req, depot, res).await;
            // added this check to not log certain requests (like rate-limited requests)
            if ctrl.is_ceased() {
                return;
            }
            let duration = now.elapsed();

            let status = res.status_code.unwrap_or(match &res.body {
                ResBody::None => StatusCode::NOT_FOUND,
                ResBody::Error(e) => e.code,
                _ => StatusCode::OK,
            });
            if let ResBody::Error(error) = &res.body {
                tracing::info!(
                    %status,
                    ?duration,
                    ?error,
                    "Response"
                );
            } else {
                tracing::info!(
                    %status,
                    ?duration,
                    "Response"
                );
            }
        }
        .instrument(span)
        .await;
    }
}
