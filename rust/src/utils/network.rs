use crate::models::LocalAddress;
use std::io;
use std::net::{IpAddr, Ipv4Addr, TcpListener, ToSocketAddrs, UdpSocket};

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_unique_local() || v6.is_loopback(),
    }
}

fn describe(raw: &str) -> Option<LocalAddress> {
    let ip: IpAddr = raw.parse().ok()?;
    Some(LocalAddress {
        family: if ip.is_ipv6() { "ipv6" } else { "ipv4" },
        is_private: is_private_ip(ip),
        loopback: ip.is_loopback(),
        host: ip.to_string(),
    })
}

fn hostname() -> Option<String> {
    std::fs::read_to_string("/etc/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn fallback_address() -> Vec<String> {
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
        return vec![];
    };
    if socket.connect("192.0.2.1:9").is_err() {
        return vec![];
    }
    socket
        .local_addr()
        .map(|addr| vec![addr.ip().to_string()])
        .unwrap_or_default()
}

/// Igual que `core.network.local_addresses()`.
pub fn local_addresses(include_loopback: bool) -> Vec<LocalAddress> {
    let mut candidates: Vec<String> = vec![];
    if let Some(name) = hostname() {
        if let Ok(addrs) = format!("{name}:0").to_socket_addrs() {
            candidates.extend(addrs.into_iter().map(|a| a.ip().to_string()));
        }
    }
    if candidates.is_empty() {
        candidates = fallback_address();
    }

    let mut seen = std::collections::HashSet::new();
    let mut result: Vec<LocalAddress> = vec![];
    for raw in candidates {
        let Some(address) = describe(&raw) else {
            continue;
        };
        if address.loopback && !include_loopback {
            continue;
        }
        if !seen.insert(address.host.clone()) {
            continue;
        }
        result.push(address);
    }

    result.sort_by_key(|a| {
        let priority = if a.loopback {
            3
        } else if a.is_private {
            if a.family == "ipv4" {
                0
            } else {
                1
            }
        } else {
            2
        };
        let numeric: u128 = a
            .host
            .parse::<Ipv4Addr>()
            .map(|v| u32::from(v) as u128)
            .unwrap_or(0);
        (priority, if a.family == "ipv4" { 0 } else { 1 }, numeric)
    });
    result
}

/// Devuelve el primer puerto libre enlazando de verdad (para comprobar que un
/// proceso_group puede escuchar ahí).
pub fn can_bind(port: u16, host: &str) -> io::Result<TcpListener> {
    TcpListener::bind((host, port))
}
