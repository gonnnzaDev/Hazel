use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: String,
    pub title: String,
    pub detail: String,
    pub extra: Value,
}

impl ApiError {
    pub fn new(
        status: u16,
        code: impl Into<String>,
        title: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            status: StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            code: code.into(),
            title: title.into(),
            detail: detail.into(),
            extra: json!({}),
        }
    }

    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        let value = value.into();
        if key == "code" {
            // En Python el argumento `code=` sobrescribe el código de la
            // excepción (y por tanto también el `type` del problem+json).
            if let Some(code) = value.as_str() {
                self.code = code.to_string();
                return self;
            }
        }
        self.extra[key] = value;
        self
    }

    pub fn with_extra(mut self, extra: Value) -> Self {
        if let Value::Object(map) = extra {
            for (key, value) in map {
                self.extra[key] = value;
            }
        }
        self
    }

    pub fn domain(detail: impl Into<String>) -> Self {
        Self::new(400, "domain_error", "Domain error", detail)
    }
    pub fn not_found(detail: impl Into<String>) -> Self {
        Self::new(404, "not_found", "Resource not found", detail)
    }
    pub fn conflict(detail: impl Into<String>) -> Self {
        Self::new(409, "conflict", "Conflict", detail)
    }
    pub fn validation(detail: impl Into<String>) -> Self {
        Self::new(422, "domain_validation_error", "Invalid data", detail)
    }
    pub fn unauthenticated(detail: impl Into<String>) -> Self {
        Self::new(401, "unauthenticated", "Unauthenticated", detail)
    }
    pub fn forbidden(detail: impl Into<String>) -> Self {
        Self::new(403, "forbidden", "Permission denied", detail)
    }
    pub fn server_inactive(detail: impl Into<String>) -> Self {
        Self::new(409, "server_inactive", "Server inactive", detail)
    }
    pub fn request_validation(errors: Value) -> Self {
        Self::new(
            422,
            "request_validation_error",
            "Invalid data",
            "The request body does not match the expected contract.",
        )
        .with("errors", errors)
    }
    pub fn internal(detail: impl Into<String>) -> Self {
        Self::new(500, "internal_error", "Internal error", detail)
    }

    pub fn problem_json(&self) -> Value {
        let mut body = json!({
            "type": format!("https://hazel.dev/errors/{}", self.code),
            "title": self.title,
            "status": self.status.as_u16(),
            "code": self.code,
            "detail": self.detail,
        });
        if let (Value::Object(target), Value::Object(extra)) = (&mut body, &self.extra) {
            for (key, value) in extra {
                target.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
        body
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status;
        let mut response = (status, Json(self.problem_json())).into_response();
        response.headers_mut().insert(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("application/problem+json"),
        );
        response
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(value: sqlx::Error) -> Self {
        tracing::error!(error = %value, "database error");
        let detail = match &value {
            sqlx::Error::RowNotFound => "The resource does not exist.".to_string(),
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                return Self::new(
                    409,
                    "conflict",
                    "Conflict",
                    "A unique constraint was violated.",
                )
            }
            _ => "An unexpected error occurred. Please try again later.".to_string(),
        };
        Self::internal(detail)
    }
}
