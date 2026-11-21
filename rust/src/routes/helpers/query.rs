use std::collections::HashMap;

use serde_json::json;

use crate::error::{ApiError, ApiResult};

pub(crate) fn query_value(query: &HashMap<String, String>, key: &str, default: &str) -> String {
    query
        .get(key)
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

pub(crate) fn query_i64(
    query: &HashMap<String, String>,
    key: &str,
    default: i64,
    min: i64,
    max: Option<i64>,
) -> ApiResult<i64> {
    let raw = query_value(query, key, &default.to_string());
    let value: i64 = raw.parse().map_err(|_| {
        ApiError::request_validation(json!([{"type":"int_parsing","loc":["query",key]}]))
    })?;
    if value < min || max.map(|m| value > m).unwrap_or(false) {
        return Err(ApiError::request_validation(json!([{
            "type": "greater_than_equal",
            "loc": ["query", key],
            "msg": format!("value must be >= {min}"),
        }])));
    }
    Ok(value)
}
