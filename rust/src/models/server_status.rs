use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::ApiError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerStatus {
    Creating,
    Active,
    Inactive,
    Deleted,
}

impl ServerStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Creating => "creating",
            Self::Active => "active",
            Self::Inactive => "inactive",
            Self::Deleted => "deleted",
        }
    }
    pub fn accepts_traffic(self) -> bool {
        self == Self::Active
    }
    pub fn is_terminal(self) -> bool {
        self == Self::Deleted
    }
    pub fn can_transition(self, target: Self) -> bool {
        match self {
            Self::Creating => !matches!(target, Self::Creating),
            Self::Active => matches!(target, Self::Inactive | Self::Deleted),
            Self::Inactive => matches!(target, Self::Active | Self::Deleted),
            Self::Deleted => false,
        }
    }
}

impl FromStr for ServerStatus {
    type Err = ApiError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "creating" => Ok(Self::Creating),
            "active" => Ok(Self::Active),
            "inactive" => Ok(Self::Inactive),
            "deleted" => Ok(Self::Deleted),
            _ => Err(ApiError::internal("unknown server status")),
        }
    }
}
