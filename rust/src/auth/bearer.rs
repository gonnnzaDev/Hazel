use axum::http::header::AUTHORIZATION;

pub fn bearer_token(headers: &axum::http::HeaderMap) -> String {
    let Some(value) = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()) else {
        return String::new();
    };
    let (scheme, rest) = value.split_once(' ').unwrap_or((value, ""));
    if !scheme.eq_ignore_ascii_case("bearer") {
        return String::new();
    }
    rest.trim().to_string()
}
