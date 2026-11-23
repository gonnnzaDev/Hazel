use crate::models::LocalAddress;
use std::collections::HashSet;
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, TcpListener, ToSocketAddrs, UdpSocket};

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

/// Direcciones que identifican a la máquina anfitriona del nodo: loopback,
/// las propias IPs del equipo y la puerta de enlace (la IP del puente cuando
/// el nodo corre en Docker).
pub fn host_ips() -> HashSet<IpAddr> {
    let mut hosts = HashSet::new();
    hosts.insert(IpAddr::V4(Ipv4Addr::LOCALHOST));
    hosts.insert(IpAddr::V6(Ipv6Addr::LOCALHOST));
    for address in local_addresses(true) {
        if let Ok(ip) = address.host.parse::<IpAddr>() {
            hosts.insert(normalize_ip(ip));
        }
    }
    if let Some(gateway) = default_gateway() {
        hosts.insert(normalize_ip(gateway));
    }
    hosts
}

/// IPv4 mapeado en IPv6 (`::ffff:127.0.0.1`) cuenta como la IPv4 original.
pub fn normalize_ip(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        v4 => v4,
    }
}

pub fn is_host_address(ip: IpAddr, hosts: &HashSet<IpAddr>) -> bool {
    hosts.contains(&normalize_ip(ip))
}

#[cfg(target_os = "linux")]
fn default_gateway() -> Option<IpAddr> {
    let routes = std::fs::read_to_string("/proc/net/route").ok()?;
    for line in routes.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 3 || fields[1] != "00000000" {
            continue;
        }
        let hex = fields[2];
        if hex.len() != 8 {
            continue;
        }
        let octets = (0..4)
            .map(|index| u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).ok())
            .collect::<Option<Vec<_>>>()?;
        // /proc/net/route guarda la gateway en little-endian.
        return Some(IpAddr::V4(Ipv4Addr::new(
            octets[3], octets[2], octets[1], octets[0],
        )));
    }
    None
}

#[cfg(not(target_os = "linux"))]
fn default_gateway() -> Option<IpAddr> {
    None
}

/// Devuelve el primer puerto libre enlazando de verdad (para comprobar que un
/// proceso_group puede escuchar ahí).
pub fn can_bind(port: u16, host: &str) -> io::Result<TcpListener> {
    TcpListener::bind((host, port))
}
