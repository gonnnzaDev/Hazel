use hazel::auth::ServerAuth;
use hazel::error::ApiError;
use hazel::events::envelope;
use hazel::models::{MemberRow, ServerStatus};
use hazel::utils::{hash_token, normalize_slug, validate_nickname};
use serde_json::json;
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

fn owner_of(server_id: Uuid) -> MemberRow {
    MemberRow {
        id: Uuid::new_v4(),
        server_id,
        nickname: "luis".to_string(),
        display_name: "Luis".to_string(),
        role: 100,
        is_online: true,
        last_seen_at: None,
        created_at: chrono::Utc::now(),
    }
}

#[test]
fn server_auth_node_token_accepts_any_server() {
    assert!(ServerAuth::NodeAdmin.check(Uuid::new_v4()).is_ok());
}

#[test]
fn server_auth_owner_token_is_scoped_to_its_server() {
    let own = Uuid::new_v4();
    let other = Uuid::new_v4();
    let auth = ServerAuth::Owner(owner_of(own));
    assert!(auth.check(own).is_ok());
    assert_eq!(auth.check(other).unwrap_err().code, "wrong_server");
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
