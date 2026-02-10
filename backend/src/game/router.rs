use crate::prelude::*;
use std::sync::Arc;

use super::{GameManager, Vector3D, GameStateSnapshot};

// =============================================================================
// Request/Response Types
// =============================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct JoinGameRequest {
    pub player_id: u32,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct JoinGameResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LeaveGameRequest {
    pub player_id: u32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct InputRequest {
    pub player_id: u32,
    pub movement: Vector3D,
    pub look_direction: Vector3D,
    #[serde(default)]
    pub attacking: bool,
    #[serde(default)]
    pub jumping: bool,
    #[serde(default)]
    pub ability1: bool,
    #[serde(default)]
    pub ability2: bool,
    #[serde(default)]
    pub dodging: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterHitRequest {
    pub attacker_id: u32,
    pub victim_id: u32,
    pub damage: f32,
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

#[endpoint]
async fn join_game(req: JsonBody<JoinGameRequest>, depot: &mut Depot) -> Json<JoinGameResponse> {
    let game_manager = depot.get::<Arc<GameManager>>("game_manager").unwrap();
    let req = req.into_inner();

    let success = game_manager.add_player(req.player_id, &req.name).await;

    if success {
        Json(JoinGameResponse {
            success: true,
            message: format!("Player {} joined successfully", req.name),
        })
    } else {
        Json(JoinGameResponse {
            success: false,
            message: "Failed to join game (game full or player already exists)".to_string(),
        })
    }
}

#[endpoint]
async fn leave_game(req: JsonBody<LeaveGameRequest>, depot: &mut Depot) -> StatusCode {
    let game_manager = depot.get::<Arc<GameManager>>("game_manager").unwrap();
    let req = req.into_inner();

    game_manager.remove_player(req.player_id).await;
    StatusCode::OK
}

#[endpoint]
async fn handle_input(req: JsonBody<InputRequest>, depot: &mut Depot) -> StatusCode {
    let game_manager = depot.get::<Arc<GameManager>>("game_manager").unwrap();
    let input = req.into_inner();

    game_manager.set_input(
        input.player_id,
        input.movement,
        input.look_direction,
        input.attacking,
        input.jumping,
        input.ability1,
        input.ability2,
        input.dodging,
    ).await;

    StatusCode::OK
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

#[endpoint]
async fn register_hit(req: JsonBody<RegisterHitRequest>, depot: &mut Depot) -> StatusCode {
    let game_manager = depot.get::<Arc<GameManager>>("game_manager").unwrap();
    let req = req.into_inner();

    game_manager.register_hit(
        req.attacker_id,
        req.victim_id,
        req.damage,
    ).await;

    StatusCode::OK
}

// =============================================================================
// Router
// =============================================================================

pub fn router(gm: Arc<GameManager>) -> Router {
    // Create separate router for each endpoint with game_manager cloned
    let join_handler = {
        let gm = gm.clone();
        #[endpoint]
        async fn handler(req: JsonBody<JoinGameRequest>, gm: Data<&Arc<GameManager>>) -> Json<JoinGameResponse> {
            let req = req.into_inner();
            let success = gm.add_player(req.player_id, &req.name).await;
            if success {
                Json(JoinGameResponse {
                    success: true,
                    message: format!("Player {} joined successfully", req.name),
                })
            } else {
                Json(JoinGameResponse {
                    success: false,
                    message: "Failed to join game (game full or player already exists)".to_string(),
                })
            }
        }
        handler
    };

    Router::with_path("game")
        .with_data(gm)
        .push(Router::with_path("join").post(join_game))
        .push(Router::with_path("leave").post(leave_game))
        .push(Router::with_path("input").post(handle_input))
        .push(Router::with_path("status").get(get_status))
        .push(Router::with_path("snapshot").get(get_snapshot))
        .push(Router::with_path("hit").post(register_hit))
}
