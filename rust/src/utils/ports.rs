use std::net::{TcpListener, ToSocketAddrs};

/// Igual que `core.ports.is_port_free`.
pub fn is_port_free(port: u16, host: &str) -> bool {
    if port == 0 {
        return false;
    }
    let address = format!("{host}:{port}");
    let Ok(addrs) = address.to_socket_addrs() else {
        return false;
    };
    for addr in addrs {
        // Enlazar y soltar es la forma portable de comprobar que el puerto
        // está libre (lo que hacía `socket.bind()` en `core.ports.py`).
        if TcpListener::bind(addr).is_ok() {
            return true;
        }
    }
    false
}

pub fn next_available_port(
    first: u16,
    last: u16,
    host: &str,
    preferred: Option<u16>,
    taken: &[i32],
) -> Option<u16> {
    let is_taken = |port: u16| taken.contains(&(port as i32));
    if let Some(port) = preferred {
        if port >= first && port <= last && !is_taken(port) && is_port_free(port, host) {
            return Some(port);
        }
    }
    (first..=last).find(|port| !is_taken(*port) && is_port_free(*port, host))
}
