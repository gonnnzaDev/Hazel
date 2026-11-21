use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct LocalAddress {
    pub host: String,
    pub family: &'static str,
    #[serde(rename = "private")]
    pub is_private: bool,
    pub loopback: bool,
}
