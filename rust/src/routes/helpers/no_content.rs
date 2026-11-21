use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

pub(crate) fn no_content() -> Response {
    StatusCode::NO_CONTENT.into_response()
}
