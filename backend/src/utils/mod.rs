use std::time::Duration;

pub mod adaptive_buffer;
pub mod limiter;
pub mod logger;
#[allow(dead_code)]
pub mod mem_cache;
#[cfg(test)]
pub mod mock;
#[allow(dead_code)]
pub mod nick_cache;

/// Render a minimal HTML status page (centered card layout).
///
/// Used for magic-link landing pages: email confirmation, data-export
/// confirmation, account-deletion confirmation, and their error variants.
pub fn html_action_result_card(title: &str, heading: &str, success: bool, message: &str) -> String {
    let color = if success { "#22c55e" } else { "#ef4444" };
    format!(
        "<!DOCTYPE html>\
        <html lang=\"en\">\
        <head><meta charset=\"utf-8\"><title>{title}</title>\
        <style>\
        body{{font-family:system-ui,sans-serif;display:flex;justify-content:center;\
        align-items:center;min-height:100vh;margin:0;background:#f5f5f5}}\
        .card{{background:#fff;padding:2rem;border-radius:8px;\
        box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:400px}}\
        h1{{color:{color};margin-bottom:.5rem}}\
        </style></head>\
        <body><div class=\"card\"><h1>{heading}</h1><p>{message}</p></div></body>\
        </html>"
    )
}

/// Time-to-idle duration for the nickname cache.
///
/// Entries not accessed within this window are evicted automatically.
pub const NICK_CACHE_TTI: Duration = Duration::from_mins(30);
pub type NickCache = nick_cache::NickTTICache;
