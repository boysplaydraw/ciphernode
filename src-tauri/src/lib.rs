use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent};
use rand::{thread_rng, Rng};
use rand::distributions::Alphanumeric;

struct SidecarState {
    child: Arc<Mutex<Option<tauri_plugin_shell::process::Child>>>,
    port: u16,
    token: String,
}

#[tauri::command]
fn get_backend_config(state: tauri::State<'_, SidecarState>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "port": state.port,
        "authToken": state.token
    }))
}

fn find_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(5000)
}

fn generate_secure_token() -> String {
    thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = find_free_port();
    let token = generate_secure_token();
    let child_process: Arc<Mutex<Option<tauri_plugin_shell::process::Child>>> = Arc::new(Mutex::new(None));
    let child_process_clone = Arc::clone(&child_process);
    let child_process_for_run = Arc::clone(&child_process);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: child_process_clone,
            port,
            token: token.clone(),
        })
        .invoke_handler(tauri::generate_handler![get_backend_config])
        .setup(move |app| {
            let app_handle = app.app_handle().clone();
            use tauri_plugin_shell::ShellExt;
            
            let sidecar_command = app_handle
                .shell()
                .sidecar("ciphernode-backend")
                .map_err(|e| e.to_string())?
                .args(&[
                    "--port", &port.to_string(),
                    "--auth-token", &token
                ]);

            // Tauri v2 spawn returns a tuple of (Receiver<CommandEvent>, Child)
            let (_rx, child) = sidecar_command.spawn().map_err(|e| e.to_string())?;
            *child_process_for_run.lock().unwrap() = Some(child);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| match event {
            RunEvent::Exit | RunEvent::ExitRequested { .. } => {
                let mut lock = child_process.lock().unwrap();
                if let Some(child) = lock.take() {
                    let _ = child.kill();
                }
            }
            _ => {}
        });
}
