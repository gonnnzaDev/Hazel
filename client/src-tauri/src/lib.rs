mod commands;
mod deps;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::load_session,
            commands::save_session,
            commands::clear_session,
            commands::read_admin_token,
            deps::check_dependencies,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hazel");
}
