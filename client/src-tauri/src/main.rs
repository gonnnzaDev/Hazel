// Oculta la consola en builds de release en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hazel_client_lib::run();
}
