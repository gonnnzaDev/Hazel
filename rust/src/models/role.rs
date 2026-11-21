#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    Member = 10,
    Admin = 50,
    Owner = 100,
}

impl Role {
    pub fn label(self) -> &'static str {
        match self {
            Self::Member => "member",
            Self::Admin => "admin",
            Self::Owner => "owner",
        }
    }
    pub fn from_i16(value: i16) -> Self {
        match value {
            100 => Self::Owner,
            50 => Self::Admin,
            _ => Self::Member,
        }
    }
    pub fn can_administer(self) -> bool {
        (self as i16) >= 50
    }
}
