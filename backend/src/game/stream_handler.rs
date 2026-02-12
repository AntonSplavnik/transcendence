use crate::stream::{Receiver, Sender, SinkExt, StreamExt, StreamManager};
use std::sync::Arc;
use tracing::{error, info, warn};

use super::messages::{GameClientMessage, GameServerMessage};
use super::GameManager;

/// Handle a single player's game stream session
///
/// This function:
/// 1. Opens a bidirectional WebTransport stream with the client
/// 2. Sends initial game state snapshot
/// 3. Registers the stream sender with GameManager for broadcasts
/// 4. Listens for incoming input messages from the client
/// 5. Processes input and updates game state in real-time
/// 6. Cleans up when the stream closes (disconnect, error, or Leave message)
///
/// # Arguments
/// * `user_id` - The authenticated user's ID
/// * `player_id` - The player's ID in the game
/// * `name` - The player's display name
/// * `game_manager` - Shared reference to the game manager
///
/// # Errors
/// Returns an error if the stream cannot be established or critical failures occur
pub async fn handle_player_stream(
    user_id: i32,
    player_id: u32,
    name: String,
    game_manager: Arc<GameManager>,
) -> Result<(), anyhow::Error> {
    info!(
        user_id,
        player_id, "Starting game stream for player '{}'", name
    );

    // Request bidirectional WebTransport stream
    let stream_manager = StreamManager::global();
    let (mut sender, mut receiver) = stream_manager
        .request_stream::<GameServerMessage, GameClientMessage>(
            user_id,
            crate::stream::StreamType::Game,
        )
        .await
        .map_err(|e| anyhow::anyhow!("Failed to open stream: {}", e))?;

    // Send initial game state snapshot
    let snapshot = game_manager.get_snapshot().await;
    sender
        .send(GameServerMessage::Snapshot(snapshot))
        .await?;
    sender.flush().await?;

    // Register this stream with GameManager for snapshot broadcasts
    game_manager.add_player_stream(player_id, sender).await;

    info!(
        user_id,
        player_id, "Game stream established, listening for input"
    );

    // Process incoming messages from client
    while let Some(result) = receiver.next().await {
        match result {
            Ok(GameClientMessage::Input {
                movement,
                look_direction,
                attacking,
                jumping,
                ability1,
                ability2,
                dodging,
            }) => {
                info!(
                    user_id,
                    player_id,
                    "Received input: movement=({}, {}, {})",
                    movement.x, movement.y, movement.z
                );
                // Update player input in game state
                game_manager
                    .set_input(
                        player_id,
                        movement,
                        look_direction,
                        attacking,
                        jumping,
                        ability1,
                        ability2,
                        dodging,
                    )
                    .await;
            }

            Ok(GameClientMessage::RegisterHit { victim_id, damage }) => {
                // Process hit registration (client-authoritative for now)
                game_manager
                    .register_hit(player_id, victim_id, damage)
                    .await;
            }

            Ok(GameClientMessage::Leave) => {
                info!(user_id, player_id, "Player requested leave via stream");
                break;
            }

            Err(e) => {
                warn!(
                    user_id,
                    player_id, "Stream error, disconnecting player: {}", e
                );
                break;
            }
        }
    }

    // Cleanup when stream ends
    info!(user_id, player_id, "Removing player from game");
    game_manager.remove_player_stream(player_id).await;
    game_manager.remove_player(player_id).await;

    Ok(())
}
