//! Respuestas de error uniformes (`application/problem+json`).

mod api_error;
mod not_found_fallback;

pub type ApiResult<T> = Result<T, ApiError>;

pub use api_error::*;
pub use not_found_fallback::*;
