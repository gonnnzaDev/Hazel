use std::env;
use std::fs;
use std::path::Path;

pub(crate) fn load_dotenv() {
    let path = Path::new(".env");
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if env::var_os(key).is_some() {
            continue;
        }
        let value = value.trim().trim_matches('"').trim_matches('\'');
        // No sobrescribimos lo que ya viene del entorno (docker-compose, etc.).
        let _ = env::var(key);
        env::set_var(key, value);
    }
}
