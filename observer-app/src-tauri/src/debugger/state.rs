//! Normalized observer state types shared across the debugger module and
//! emitted to the frontend (spec §5.2 / §7).

use serde::{Deserialize, Serialize};

/// The normalized "who is the observer currently looking at" state.
///
/// Mirrors the `CurrentObserverState` TS type. Any field that cannot be
/// confidently resolved from the debugger log is `None` (serialized as `null`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentObserverState {
    pub uid: Option<String>,
    pub name: Option<String>,
    pub player_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_observer_value: Option<String>,
    pub source_file: String,
    pub updated_at: String,
}

/// Runtime (non-persisted) status of a single observer source.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ObserverStatus {
    Connected,
    Watching,
    Waiting,
    Error,
    Disabled,
}

impl ObserverStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ObserverStatus::Connected => "connected",
            ObserverStatus::Watching => "watching",
            ObserverStatus::Waiting => "waiting",
            ObserverStatus::Error => "error",
            ObserverStatus::Disabled => "disabled",
        }
    }
}

/// Payload emitted to the frontend on every observer update.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverUpdate {
    pub observer_id: String,
    pub status: String,
    pub current_observer: Option<CurrentObserverState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message: Option<String>,
    pub last_heartbeat_at: String,
}

impl ObserverUpdate {
    pub fn new(
        observer_id: impl Into<String>,
        status: ObserverStatus,
        current_observer: Option<CurrentObserverState>,
        last_message: Option<String>,
    ) -> Self {
        Self {
            observer_id: observer_id.into(),
            status: status.as_str().to_string(),
            current_observer,
            last_message,
            last_heartbeat_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}
