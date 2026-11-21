use std::env;

pub(crate) fn get(key: &str) -> Option<String> {
    env::var(format!("HAZEL_{key}"))
        .ok()
        .map(|v| v.trim().to_string())
}

pub(crate) fn string(key: &str, default: &str) -> String {
    get(key)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
}

pub(crate) fn int(key: &str, default: i64) -> i64 {
    get(key)
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(default)
}

pub(crate) fn boolean(key: &str, default: bool) -> bool {
    match get(key) {
        None => default,
        Some(value) => matches!(
            value.to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
    }
}

pub(crate) fn csv(key: &str, default: &[&str]) -> Vec<String> {
    match get(key) {
        None => default.iter().map(|s| (*s).to_string()).collect(),
        Some(value) => value
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
    }
}
