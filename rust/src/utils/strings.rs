use crate::error::{ApiError, ApiResult};
use unicode_normalization::UnicodeNormalization;

fn strip_accents(raw: &str) -> String {
    raw.nfkd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect()
}

/// Equivale a `re.sub(r"[^...]+", replacement, text)`: agrupa corridas.
fn collapse(
    chars: impl Iterator<Item = char>,
    keep: impl Fn(char) -> bool,
    replacement: char,
) -> String {
    let mut result = String::new();
    let mut pending_separator = false;
    for ch in chars {
        if keep(ch) {
            if pending_separator && !result.is_empty() {
                result.push(replacement);
            }
            pending_separator = false;
            result.push(ch);
        } else {
            pending_separator = true;
        }
    }
    result
}

const NICK_RESERVED: &[&str] = &[
    "admin",
    "administrador",
    "everyone",
    "todos",
    "here",
    "aqui",
    "hazel",
    "system",
    "sistema",
    "root",
    "null",
    "none",
    "support",
    "soporte",
];

pub fn normalize_nickname(raw: &str) -> String {
    let decomposed = strip_accents(raw.trim().to_lowercase().as_str());
    let cleaned = collapse(
        decomposed.chars(),
        |c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'),
        '_',
    );
    cleaned
        .trim_matches(|c| matches!(c, '.' | '_' | '-'))
        .to_string()
}

pub fn validate_nickname(raw: &str) -> ApiResult<String> {
    let nickname = normalize_nickname(raw);
    if nickname.len() < 2 {
        return Err(
            ApiError::validation("Nickname must be at least 2 characters long.")
                .with("code", "nickname_too_short")
                .with("min_length", 2),
        );
    }
    if nickname.len() > 32 {
        return Err(
            ApiError::validation("Nickname cannot exceed 32 characters.")
                .with("code", "nickname_too_long")
                .with("max_length", 32),
        );
    }
    let mut chars = nickname.chars();
    let first = chars.next().unwrap_or(' ');
    if !first.is_ascii_alphanumeric()
        || !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(ApiError::validation(
            "Nickname may only contain letters, numbers, dot, hyphen and underscore, \
             and must start with a letter or number.",
        )
        .with("code", "nickname_invalid_charset"));
    }
    if NICK_RESERVED.contains(&nickname.as_str()) {
        return Err(
            ApiError::validation(format!("'{nickname}' is a reserved nickname."))
                .with("code", "nickname_reserved"),
        );
    }
    Ok(nickname)
}

pub fn normalize_slug(raw: &str) -> String {
    let decomposed = strip_accents(raw.trim().to_lowercase().as_str());
    let cleaned = collapse(decomposed.chars(), |c| c.is_ascii_alphanumeric(), '-');
    cleaned.trim_matches('-').to_string()
}
