use crate::prelude::*;

use super::*;

pub fn echo_stream_open_endpoint(path: impl Into<String>) -> Router {
    Router::with_path(path)
        .oapi_tag("stream")
        .requires_user_login()
        .user_rate_limit(&RateLimit::per_5_minutes(30))
        .post(open_echo_stream)
}

#[derive(Debug, Deserialize, ToSchema)]
struct OpenEchoStreamInput {
    initial_message: String,
}

/// Open a WebTransport echo stream with type `EchoExample(String)`.
///
/// This endpoint opens a WebTransport stream that echoes back any messages sent to it.
/// It also sends the given initial message back to the client as part of the stream type message.
#[endpoint]
async fn open_echo_stream(
    depot: &mut Depot,
    json: JsonBody<OpenEchoStreamInput>,
) -> JsonResult<()> {
    let user_id = depot.user_id();
    let initial_message = json.into_inner().initial_message;
    let echo_stream = EchoStream::new(user_id, initial_message).await?;
    tokio::spawn(async move {
        if let Err(e) = echo_stream.run_handler_loop().await {
            tracing::error!("Echo stream error: {:?}", e);
        }
    });
    json_ok(())
}

struct EchoStream {
    sender: Sender<String>,
    receiver: Receiver<String>,
}

impl EchoStream {
    async fn new(
        user_id: i32,
        initial_message: String,
    ) -> Result<Self, StreamManagerError> {
        let (tx, rx) = StreamManager::global()
            .request_stream(user_id, StreamType::EchoExample(initial_message))
            .await?;
        Ok(EchoStream {
            sender: tx,
            receiver: rx,
        })
    }

    async fn on_message(&mut self, msg: String) -> Result<(), anyhow::Error> {
        self.sender.send(msg).await
    }

    async fn run_handler_loop(mut self) -> Result<(), anyhow::Error> {
        while let Some(msg) = self.receiver.next().await {
            self.on_message(msg?).await?;
        }
        Ok(())
    }
}
