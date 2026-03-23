use ulid::Ulid;

use crate::models::nickname::Nickname;
use crate::prelude::*;

use super::ffi::CharacterClass;
use super::lobby::{LobbyInfo, LobbySettings, LobbySettingsPatch};
use super::manager::{GameError, GameManagerDepotExt as _};

pub fn router(path: impl Into<String>) -> Router {
    Router::with_path(path)
        .requires_user_login()
        .oapi_tag("game")
        .push(
            Router::with_path("lobby")
                .post(create_lobby)
                .get(list_lobbies)
                .push(Router::with_path("{id}").get(get_lobby))
                .push(Router::with_path("{id}/join").post(join_lobby))
                .push(Router::with_path("{id}/spectate").post(spectate_lobby))
                .push(Router::with_path("{id}/leave").post(leave))
                .push(Router::with_path("{id}/ready").post(set_ready))
                .push(Router::with_path("{id}/character").post(set_character))
                .push(Router::with_path("{id}/settings").patch(update_settings)),
        )
}

#[derive(Debug, Deserialize, ToSchema)]
struct CreateLobbyRequest {
    #[serde(flatten)]
    settings: LobbySettings,
}

#[derive(Debug, Serialize, ToSchema)]
struct CreateLobbyResponse {
    id: Ulid,
}

#[derive(Debug, Deserialize, ToSchema)]
struct SetReadyRequest {
    ready: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
struct SetCharacterRequest {
    character_class: CharacterClass,
}

/// Create a new lobby and join it as the host.
#[endpoint]
async fn create_lobby(
    req: JsonBody<CreateLobbyRequest>,
    depot: &mut Depot,
) -> JsonResult<CreateLobbyResponse> {
    let user_id = depot.user_id();
    let gm = depot.game_manager().clone();
    let nickname = resolve_nickname(depot).await?;

    let settings = req.into_inner().settings;
    let id = gm.create_lobby(user_id, nickname, settings).await?;

    json_ok(CreateLobbyResponse { id })
}

/// List all public lobbies.
#[endpoint]
async fn list_lobbies(depot: &mut Depot) -> Json<Vec<LobbyInfo>> {
    Json(depot.game_manager().list_public_lobbies())
}

/// Get details of a specific lobby.
#[endpoint]
async fn get_lobby(id: PathParam<Ulid>, depot: &mut Depot) -> JsonResult<LobbyInfo> {
    let id = id.into_inner();

    json_ok(
        depot
            .game_manager()
            .get_lobby_info(id)
            .ok_or(GameError::LobbyNotFound)?,
    )
}

/// Join a lobby as a player.
#[endpoint]
async fn join_lobby(id: PathParam<Ulid>, depot: &mut Depot) -> JsonResult<()> {
    let id = id.into_inner();
    let user_id = depot.user_id();
    let gm = depot.game_manager().clone();
    let nickname = resolve_nickname(depot).await?;

    gm.join_lobby(id, user_id, nickname).await?;

    json_ok(())
}

/// Join a lobby as a spectator.
#[endpoint]
async fn spectate_lobby(id: PathParam<Ulid>, depot: &mut Depot) -> JsonResult<()> {
    let id = id.into_inner();
    let user_id = depot.user_id();
    let gm = depot.game_manager().clone();
    let nickname = resolve_nickname(depot).await?;

    gm.spectate_lobby(id, user_id, nickname).await?;

    json_ok(())
}

/// Leave the specified lobby (player or spectator).
#[endpoint]
async fn leave(id: PathParam<Ulid>, depot: &mut Depot) -> JsonResult<()> {
    let id = id.into_inner();
    let user_id = depot.user_id();
    depot.game_manager().leave(user_id, id)?;
    json_ok(())
}

/// Set ready state in the specified lobby.
#[endpoint]
async fn set_ready(
    id: PathParam<Ulid>,
    req: JsonBody<SetReadyRequest>,
    depot: &mut Depot,
) -> JsonResult<()> {
    let id = id.into_inner();
    let user_id = depot.user_id();
    depot
        .game_manager()
        .set_ready(user_id, id, req.into_inner().ready)?;
    json_ok(())
}

/// Set character class for the current player in the specified lobby.
#[endpoint]
async fn set_character(
    id: PathParam<Ulid>,
    req: JsonBody<SetCharacterRequest>,
    depot: &mut Depot,
) -> JsonResult<()> {
    let id = id.into_inner();
    let user_id = depot.user_id();
    depot
        .game_manager()
        .set_character(user_id, id, req.into_inner().character_class)?;
    json_ok(())
}

/// Partially update lobby settings (only allowed while the lobby is private).
/// Only the provided fields are changed; omitted fields keep their current values.
#[endpoint]
async fn update_settings(
    id: PathParam<Ulid>,
    req: JsonBody<LobbySettingsPatch>,
    depot: &mut Depot,
) -> JsonResult<()> {
    let id = id.into_inner();
    let user_id = depot.user_id();
    depot
        .game_manager()
        .update_settings(user_id, id, req.into_inner())?;
    json_ok(())
}

async fn resolve_nickname(depot: &Depot) -> AppResult<Nickname> {
    let user_id = depot.user_id();
    let nick_cache = depot.nickname_cache().clone();
    let db = depot.db().clone();
    let nickname = db
        .read(move |conn| nick_cache.try_get(user_id, conn))
        .await?
        .ok_or(diesel::result::Error::NotFound)?;
    Ok(nickname)
}
