use serde_json::json;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

pub(crate) fn path_uuid(raw: &str) -> ApiResult<Uuid> {
    Uuid::parse_str(raw).map_err(|_| {
        ApiError::new(
            422,
            "request_validation_error",
            "Invalid data",
            "Invalid identifier.",
        )
        .with(
            "errors",
            json!([{"type":"uuid_parsing","loc":["path"],"msg":"invalid uuid"}]),
        )
    })
}
