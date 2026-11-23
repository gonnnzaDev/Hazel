use super::*;

pub(crate) fn default_max_members() -> i16 {
    50
}

pub(crate) fn default_ttl() -> i64 {
    300
}

pub(crate) fn default_channel_kind() -> ChannelKind {
    ChannelKind::Text
}
