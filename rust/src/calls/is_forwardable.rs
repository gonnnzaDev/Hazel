pub fn is_forwardable(kind: &str) -> bool {
    matches!(kind, "offer" | "answer" | "ice")
}
