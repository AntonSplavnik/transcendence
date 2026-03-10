use crate::prelude::*;
use std::sync::Arc;

use super::{stream_handler, GameManager, GameStateSnapshot, Vector3D};

// =============================================================================
// Request/Response Types
// =============================================================================

/// Request to join the game and establish a WebTransport stream
#[derive(Debug, Deserialize, ToSchema)]
pub struct JoinStreamRequest {
    /// Player's display name
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GameStatusResponse {
    pub running: bool,
    pub player_count: usize,
    pub frame_number: u64,
}

// =============================================================================
// Handlers
// =============================================================================

/// Join the game and establish a WebTransport stream for bidirectional communication
///
/// This endpoint:
/// 1. Adds the player to the game
/// 2. Spawns a background task to handle the player's stream
/// 3. Returns immediately after spawning the task
///
/// The actual stream communication happens asynchronously via WebTransport.
#[endpoint]
async fn join_stream(
    req: JsonBody<JoinStreamRequest>,
    depot: &mut Depot,
) -> Result<StatusCode, StatusError> {
    let user_id: i32 = depot.user_id();
    let game_manager = depot.get::<Arc<GameManager>>("game_manager").unwrap();
    let req = req.into_inner();

    // Use user_id as player_id (or implement custom player_id assignment logic)
    let player_id = user_id as u32;

    // Add player to the game
    let success = game_manager.add_player(player_id, &req.name).await;
    if !success {
        return Err(StatusError::bad_request()
            .detail("Failed to join game (game full or player already exists)"));
    }
    let sm = Arc::clone(depot.stream_manager());
    // Spawn background task to handle the WebTransport stream
    tokio::spawn({
        let gm = game_manager.clone();
        let name = req.name.clone();
        async move {
            if let Err(e) =
                stream_handler::handle_player_stream(user_id, player_id, name, gm, sm).await
            {
                tracing::error!("Game stream handler error for player {}: {}", player_id, e);
            }
        }
    });

    Ok(StatusCode::OK)
}

#[endpoint]
async fn get_status(depot: &mut Depot) -> Json<GameStatusResponse> {
    let game_manager = depot.get::<Arc<GameManager>>("game_manager").unwrap();

    let running = game_manager.is_running().await;
    let player_count = game_manager.get_player_count().await;
    let snapshot = game_manager.get_snapshot().await;

    Json(GameStatusResponse {
        running,
        player_count,
        frame_number: snapshot.frame_number,
    })
}

#[endpoint]
async fn get_snapshot(depot: &mut Depot) -> Json<GameStateSnapshot> {
    let game_manager = depot.get::<Arc<GameManager>>("game_manager").unwrap();
    let snapshot = game_manager.get_snapshot().await;
    Json(snapshot)
}

// =============================================================================
// Router
// =============================================================================

struct GameManagerHoop(Arc<GameManager>);

#[handler]
impl GameManagerHoop {
    async fn handle(
        &self,
        req: &mut Request,
        depot: &mut Depot,
        res: &mut Response,
        ctrl: &mut FlowCtrl,
    ) {
        depot.insert("game_manager", self.0.clone());
        ctrl.call_next(req, depot, res).await;
    }
}

pub fn router(gm: Arc<GameManager>) -> Router {
    Router::with_path("game")
        .hoop(GameManagerHoop(gm))
        .requires_user_login()
        .push(Router::with_path("join_stream").post(join_stream))
        .push(Router::with_path("status").get(get_status))
        .push(Router::with_path("snapshot").get(get_snapshot))
}
