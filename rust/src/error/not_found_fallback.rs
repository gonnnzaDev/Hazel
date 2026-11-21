use super::*;

pub async fn not_found_fallback() -> ApiError {
    ApiError::new(404, "http_404", "HTTP error", "Not Found")
}
