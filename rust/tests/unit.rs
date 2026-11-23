use hazel::error::ApiError;
use hazel::events::envelope;
use hazel::models::ServerStatus;
use hazel::utils::{hash_token, is_host_address, normalize_slug, validate_nickname};
use serde_json::json;
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};
use uuid::Uuid;

#[test]
fn slug_normalization_matches_python() {
    assert_eq!(normalize_slug("Luis House"), "luis-house");
    assert_eq!(normalize_slug("  Álvaro's   Place "), "alvaro-s-place");
    assert_eq!(normalize_slug("!!!"), "");
}

#[test]
fn nickname_rules() {
    assert_eq!(validate_nickname("José").unwrap(), "jose");
    assert_eq!(validate_nickname("  Ana_1 ").unwrap(), "ana_1");
    assert!(validate_nickname("a").is_err());
    assert!(validate_nickname("admin").is_err());
    assert_eq!(validate_nickname("bad name").unwrap(), "bad_name");
}

#[test]
fn token_hash_is_sha256_hex() {
    assert_eq!(
        hash_token("hola"),
        "b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79"
    );
}

#[test]
fn envelope_shape() {
    let server_id = Uuid::nil();
    let event = envelope("message.created", server_id, None, json!({"x": 1}));
    assert_eq!(event["type"], "message.created");
    assert_eq!(event["server_id"], server_id.to_string());
    assert_eq!(event["data"]["x"], 1);
    assert!(event.get("channel_id").is_none());
}

#[test]
fn only_host_addresses_can_manage() {
    let hosts: HashSet<IpAddr> = [
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)),
    ]
    .into_iter()
    .collect();

    assert!(is_host_address(IpAddr::V4(Ipv4Addr::LOCALHOST), &hosts));
    assert!(is_host_address(
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)),
        &hosts
    ));
    assert!(!is_host_address(
        IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
        &hosts
    ));
}

#[test]
fn problem_json_shape() {
    let error = ApiError::not_found("nope")
        .with("code", "server_not_found")
        .with("server_id", "abc");
    let body = error.problem_json();
    assert_eq!(body["type"], "https://hazel.dev/errors/server_not_found");
    assert_eq!(body["status"], 404);
    assert_eq!(body["code"], "server_not_found");
    assert_eq!(body["server_id"], "abc");
}

#[test]
fn state_transitions() {
    assert!(ServerStatus::Creating.can_transition(ServerStatus::Active));
    assert!(ServerStatus::Active.can_transition(ServerStatus::Inactive));
    assert!(!ServerStatus::Active.can_transition(ServerStatus::Active));
    assert!(!ServerStatus::Deleted.can_transition(ServerStatus::Active));
    assert!(ServerStatus::Active.accepts_traffic());
}
