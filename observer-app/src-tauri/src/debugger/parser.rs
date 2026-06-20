//! Debugger log line parser.
//!
//! Converts raw Free Fire PCOB debugger log lines into a normalized
//! [`CurrentObserverState`]. The parser is line-oriented and stateful: it keeps
//! an in-memory player map built from `InitTrackingPlayer` lines and resolves
//! the active observer whenever an `OnSwitchObserver` line appears.
//!
//! ## ID correlation (the important part)
//!
//! Real debugger lines look like:
//!
//! ```txt
//! [2026-06-20 18:02:17.324][1][4135] [InitTrackingPlayer] 33554434 -> noth3llfire
//! [2026-06-20 18:02:17.324][1][4135] @UIHudPlayerRemainingInfoController OnSwitchObserver 14524251948 0
//! ```
//!
//! The trailing number on `OnSwitchObserver` is the player **UID**
//! (`14524251948`) — a *different* id space from the `playerId` (`33554434`) on
//! `InitTrackingPlayer`. The two lines are linked by the third bracket, a
//! per-event **frame id** (`[4135]`): the `InitTrackingPlayer` that shares a
//! frame with an `OnSwitchObserver` describes the same player. We use that to
//! learn a `uid -> {playerId, name}` map and resolve the full observer object
//! (uid + name + playerId).
//!
//! Design goals (spec §5, §17):
//!   - Never crash on malformed/partial lines.
//!   - Never guess unresolved identity fields — use `None`/`null` instead.
//!   - Stay extensible — new patterns can be added without touching the model.

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

use super::state::CurrentObserverState;

/// Third bracket of the log prefix — the per-event frame id, e.g. `[4135]`.
/// `[ts][1][4135] message` → captures `4135`.
static RE_FRAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\[[^\]]*\]\[[^\]]*\]\[(\d+)\]").unwrap());

/// `[InitTrackingPlayer] 16777217 -> noth3llfire`
static RE_INIT_TRACKING: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[InitTrackingPlayer\]\s+(\d+)\s*->\s*(\S+)").unwrap());

/// `... OnSwitchObserver 14524251948 0` — first number is the UID.
static RE_SWITCH_OBSERVER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"OnSwitchObserver\s+(\d+)").unwrap());

/// One player record discovered from the debugger stream.
#[derive(Debug, Clone, Default)]
pub struct PlayerRecord {
    /// The numeric identifier that precedes the name in `InitTrackingPlayer`
    /// (the in-game `playerId`).
    pub player_id: String,
    /// Human-readable in-game name.
    pub name: String,
}

/// The most recent `InitTrackingPlayer`, retained so the next `OnSwitchObserver`
/// sharing its frame can be bound to a UID.
#[derive(Debug, Clone)]
struct LastInit {
    frame: Option<String>,
    player_id: String,
    name: String,
}

/// The result of feeding a single line to the parser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseOutcome {
    /// Line was recognised and a new player mapping was learned.
    PlayerLearned,
    /// Line was an observer switch and produced a new observer state.
    ObserverSwitched,
    /// Line was not recognised — safely ignored.
    Ignored,
}

/// Stateful parser for a single debugger source (one observer / one file).
#[derive(Debug, Default)]
pub struct ObserverParser {
    /// `playerId` -> player record.
    players_by_id: HashMap<String, PlayerRecord>,
    /// `uid` (OnSwitchObserver value) -> resolved player.
    uid_to_player: HashMap<String, PlayerRecord>,
    /// The last `InitTrackingPlayer` seen, for frame-based UID binding.
    last_init: Option<LastInit>,
    /// The most recent resolved observer state, if any.
    current: Option<CurrentObserverState>,
    /// Name of the file these lines came from (for `sourceFile`).
    source_file: String,
}

impl ObserverParser {
    pub fn new(source_file: impl Into<String>) -> Self {
        Self {
            source_file: source_file.into(),
            ..Default::default()
        }
    }

    /// Update the source file name (used when the watcher rotates to a new file).
    pub fn set_source_file(&mut self, source_file: impl Into<String>) {
        self.source_file = source_file.into();
    }

    /// Current best-known observer state.
    pub fn current(&self) -> Option<&CurrentObserverState> {
        self.current.as_ref()
    }

    /// Number of distinct players learned so far (used in tests).
    #[allow(dead_code)]
    pub fn player_count(&self) -> usize {
        self.players_by_id.len()
    }

    /// Number of learned uid→player mappings (used in tests).
    #[allow(dead_code)]
    pub fn uid_mapping_count(&self) -> usize {
        self.uid_to_player.len()
    }

    fn parse_frame(line: &str) -> Option<String> {
        RE_FRAME
            .captures(line)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
    }

    /// Feed a single raw line. Never panics — malformed input yields
    /// [`ParseOutcome::Ignored`].
    pub fn process_line(&mut self, raw: &str) -> ParseOutcome {
        let line = raw.trim();
        if line.is_empty() {
            return ParseOutcome::Ignored;
        }

        let frame = Self::parse_frame(line);

        if let Some(caps) = RE_INIT_TRACKING.captures(line) {
            let player_id = caps.get(1).map(|m| m.as_str().trim().to_string());
            let name = caps.get(2).map(|m| m.as_str().trim().to_string());
            if let (Some(player_id), Some(name)) = (player_id, name) {
                if !player_id.is_empty() && !name.is_empty() {
                    self.players_by_id.insert(
                        player_id.clone(),
                        PlayerRecord {
                            player_id: player_id.clone(),
                            name: name.clone(),
                        },
                    );
                    self.last_init = Some(LastInit {
                        frame,
                        player_id,
                        name,
                    });
                    return ParseOutcome::PlayerLearned;
                }
            }
            return ParseOutcome::Ignored;
        }

        if let Some(caps) = RE_SWITCH_OBSERVER.captures(line) {
            if let Some(value) = caps.get(1).map(|m| m.as_str().to_string()) {
                self.apply_switch(&value, frame);
                return ParseOutcome::ObserverSwitched;
            }
            return ParseOutcome::Ignored;
        }

        ParseOutcome::Ignored
    }

    /// Resolve the best-possible observer object for a switch value, in priority
    /// order. Any field we cannot confidently fill stays `None` (spec §17).
    fn apply_switch(&mut self, value: &str, frame: Option<String>) {
        let now = chrono::Utc::now().to_rfc3339();

        // 1. The value is itself a known playerId (simple/legacy logs where the
        //    switch value is the playerId). uid is unknown in this shape.
        if let Some(rec) = self.players_by_id.get(value).cloned() {
            self.current = Some(CurrentObserverState {
                uid: None,
                name: Some(rec.name),
                player_id: Some(rec.player_id),
                raw_observer_value: Some(value.to_string()),
                source_file: self.source_file.clone(),
                updated_at: now,
            });
            return;
        }

        // 2. Previously-learned UID mapping.
        if let Some(rec) = self.uid_to_player.get(value).cloned() {
            self.current = Some(CurrentObserverState {
                uid: Some(value.to_string()),
                name: Some(rec.name),
                player_id: Some(rec.player_id),
                raw_observer_value: Some(value.to_string()),
                source_file: self.source_file.clone(),
                updated_at: now,
            });
            return;
        }

        // 3. Bind via the InitTrackingPlayer that shares this event's frame id.
        //    Only when both frames are present and equal, to avoid mis-binding.
        if let Some(li) = self.last_init.clone() {
            if frame.is_some() && frame == li.frame {
                let rec = PlayerRecord {
                    player_id: li.player_id.clone(),
                    name: li.name.clone(),
                };
                self.uid_to_player.insert(value.to_string(), rec);
                self.current = Some(CurrentObserverState {
                    uid: Some(value.to_string()),
                    name: Some(li.name),
                    player_id: Some(li.player_id),
                    raw_observer_value: Some(value.to_string()),
                    source_file: self.source_file.clone(),
                    updated_at: now,
                });
                return;
            }
        }

        // 4. Unresolved — keep the raw value, leave identity fields null.
        self.current = Some(CurrentObserverState {
            uid: None,
            name: None,
            player_id: None,
            raw_observer_value: Some(value.to_string()),
            source_file: self.source_file.clone(),
            updated_at: now,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_init_tracking_player() {
        let mut p = ObserverParser::new("test.log");
        assert_eq!(
            p.process_line("[InitTrackingPlayer] 16777217 -> noth3llfire"),
            ParseOutcome::PlayerLearned
        );
        assert_eq!(p.player_count(), 1);
    }

    #[test]
    fn legacy_switch_value_equals_player_id() {
        let mut p = ObserverParser::new("debugger.log");
        p.process_line("[InitTrackingPlayer] 16777217 -> noth3llfire");
        assert_eq!(
            p.process_line("@UIHudPlayerRemainingInfoController OnSwitchObserver 16777217"),
            ParseOutcome::ObserverSwitched
        );
        let s = p.current().expect("state");
        assert_eq!(s.player_id.as_deref(), Some("16777217"));
        assert_eq!(s.name.as_deref(), Some("noth3llfire"));
        assert_eq!(s.uid, None);
    }

    #[test]
    fn real_format_resolves_uid_to_player_via_frame() {
        let mut p = ObserverParser::new("debugger-2026-06-20.log");
        p.process_line("[2026-06-20 18:02:17.324][1][4135] [InitTrackingPlayer] 33554434 -> noth3llfire");
        let outcome = p.process_line(
            "[2026-06-20 18:02:17.324][1][4135] @UIHudPlayerRemainingInfoController OnSwitchObserver 14524251948 0",
        );
        assert_eq!(outcome, ParseOutcome::ObserverSwitched);
        let s = p.current().expect("state");
        assert_eq!(s.uid.as_deref(), Some("14524251948"));
        assert_eq!(s.name.as_deref(), Some("noth3llfire"));
        assert_eq!(s.player_id.as_deref(), Some("33554434"));
        assert_eq!(s.raw_observer_value.as_deref(), Some("14524251948"));
        assert_eq!(p.uid_mapping_count(), 1);
    }

    #[test]
    fn learned_uid_resolves_without_adjacent_init() {
        let mut p = ObserverParser::new("d.log");
        // Learn the mapping once.
        p.process_line("[t][1][10] [InitTrackingPlayer] 16777217 -> themisuwu");
        p.process_line("[t][1][10] OnSwitchObserver 11838801107 0");
        // A later switch to the same UID with no preceding init still resolves.
        p.process_line("[t][1][55] OnSwitchObserver 11838801107 0");
        let s = p.current().expect("state");
        assert_eq!(s.name.as_deref(), Some("themisuwu"));
        assert_eq!(s.uid.as_deref(), Some("11838801107"));
        assert_eq!(s.player_id.as_deref(), Some("16777217"));
    }

    #[test]
    fn unknown_uid_without_frame_match_stays_null() {
        let mut p = ObserverParser::new("test.log");
        // Init on a different frame than the switch — must NOT bind.
        p.process_line("[t][1][10] [InitTrackingPlayer] 16777217 -> themisuwu");
        p.process_line("[t][1][99] OnSwitchObserver 14524251948 0");
        let s = p.current().expect("state");
        assert!(s.name.is_none());
        assert!(s.player_id.is_none());
        assert!(s.uid.is_none());
        assert_eq!(s.raw_observer_value.as_deref(), Some("14524251948"));
    }

    #[test]
    fn unresolved_switch_keeps_fields_null() {
        let mut p = ObserverParser::new("test.log");
        p.process_line("@UIHudPlayerRemainingInfoController OnSwitchObserver 14524251948");
        let s = p.current().expect("state");
        assert!(s.player_id.is_none());
        assert!(s.name.is_none());
        assert!(s.uid.is_none());
        assert_eq!(s.raw_observer_value.as_deref(), Some("14524251948"));
    }

    #[test]
    fn handles_malformed_lines_safely() {
        let mut p = ObserverParser::new("test.log");
        assert_eq!(p.process_line(""), ParseOutcome::Ignored);
        assert_eq!(p.process_line("   "), ParseOutcome::Ignored);
        assert_eq!(p.process_line("[InitTrackingPlayer] ->"), ParseOutcome::Ignored);
        assert_eq!(p.process_line("garbage line with no meaning"), ParseOutcome::Ignored);
        assert_eq!(p.process_line("OnSwitchObserver notanumber"), ParseOutcome::Ignored);
        assert_eq!(p.player_count(), 0);
        assert!(p.current().is_none());
    }

    #[test]
    fn multiple_players_then_switch() {
        let mut p = ObserverParser::new("test.log");
        p.process_line("[InitTrackingPlayer] 16777217 -> noth3llfire");
        p.process_line("[InitTrackingPlayer] 16777218 -> themisuwu");
        p.process_line("@UIHudPlayerRemainingInfoController OnSwitchObserver 16777218");
        let s = p.current().expect("state");
        assert_eq!(s.name.as_deref(), Some("themisuwu"));
        assert_eq!(p.player_count(), 2);
    }
}
