pub(crate) fn is_wildcard(host: &str) -> bool {
    matches!(host.trim(), "0.0.0.0" | "::" | "[::]")
}
