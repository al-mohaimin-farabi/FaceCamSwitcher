//! Integration tests that run the parser over the sample debugger fixture
//! files (spec §14).

use app_lib::debugger::parser::ObserverParser;
use std::path::PathBuf;

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read fixture {}: {e}", path.display()))
}

#[test]
fn resolves_last_switch_from_sample_log() {
    let mut p = ObserverParser::new("debugger_2026_06_20.log");
    for line in fixture("debugger_2026_06_20.log").lines() {
        p.process_line(line);
    }
    // The final switch in the fixture is to 16777217 -> noth3llfire.
    let s = p.current().expect("an observer should be resolved");
    assert_eq!(s.player_id.as_deref(), Some("16777217"));
    assert_eq!(s.name.as_deref(), Some("noth3llfire"));
    assert_eq!(s.source_file, "debugger_2026_06_20.log");
    assert_eq!(p.player_count(), 3);
}

#[test]
fn real_format_fixture_resolves_uid_name_and_player_id() {
    let mut p = ObserverParser::new("debugger_real_format.log");
    for line in fixture("debugger_real_format.log").lines() {
        p.process_line(line);
    }
    // Last switch is to themisuwu (uid 11838801107, playerId 16777217).
    let s = p.current().expect("an observer should be resolved");
    assert_eq!(s.uid.as_deref(), Some("11838801107"));
    assert_eq!(s.name.as_deref(), Some("themisuwu"));
    assert_eq!(s.player_id.as_deref(), Some("16777217"));
    // Two distinct UIDs learned across the session.
    assert_eq!(p.uid_mapping_count(), 2);
}

#[test]
fn malformed_fixture_does_not_crash_and_keeps_unknown_null() {
    let mut p = ObserverParser::new("debugger_malformed.log");
    for line in fixture("debugger_malformed.log").lines() {
        p.process_line(line);
    }
    // The only well-formed switch targets an unknown id (99999999).
    let s = p.current().expect("a switch should still register");
    assert_eq!(s.raw_observer_value.as_deref(), Some("99999999"));
    assert!(s.name.is_none(), "unknown id must not be guessed");
    assert!(s.player_id.is_none());
    // Two well-formed players are learned (noth3llfire + the final line);
    // the malformed `[InitTrackingPlayer] ->` / bare lines are skipped.
    assert_eq!(p.player_count(), 2);
}
