use axum::Json;
use serde_json::json;

use crate::error::ApiError;

use super::*;

pub struct JsonBody<T>(pub T);

impl<S, T> FromRequest<S> for JsonBody<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match axum::Json::<T>::from_request(req, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(rejection) => {
                let message = rejection.to_string();
                let location = match rejection {
                    axum::extract::rejection::JsonRejection::JsonDataError(_) => "body",
                    axum::extract::rejection::JsonRejection::JsonSyntaxError(_) => "body",
                    _ => "request",
                };
                Err(ApiError::request_validation(json!({
                    "errors": [{
                        "type": "value_error",
                        "loc": [location],
                        "msg": message,
                        "input": null,
                    }]
                })))
            }
        }
    }
}
