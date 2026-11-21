use std::collections::HashMap;
use std::sync::Arc;

use uuid::Uuid;

use super::*;

#[derive(Default)]
pub(crate) struct BusInner {
    pub(crate) subs: HashMap<Uuid, Arc<Subscription>>,
    pub(crate) sockets_by_member: HashMap<(Uuid, Uuid), usize>,
}
