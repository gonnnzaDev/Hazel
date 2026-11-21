pub struct TypingWindow {
    start: Option<std::time::Instant>,
    count: i64,
}

impl TypingWindow {
    pub fn new() -> Self {
        Self {
            start: None,
            count: 0,
        }
    }

    pub fn admit(&mut self, now: std::time::Instant, limit: i64) -> bool {
        let start = self.start.get_or_insert(now);
        if now.duration_since(*start).as_secs_f64() >= 60.0 {
            *start = now;
            self.count = 0;
        }
        if self.count >= limit {
            return false;
        }
        self.count += 1;
        true
    }
}

impl Default for TypingWindow {
    fn default() -> Self {
        Self::new()
    }
}
