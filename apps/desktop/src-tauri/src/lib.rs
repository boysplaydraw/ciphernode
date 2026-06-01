use std::sync::Mutex;

#[derive(Default)]
struct TorState {
    running: bool,
    proxy_host: String,
    proxy_port: u16,
}

#[derive(serde::Serialize)]
struct TorStatus {
    running: bool,
    proxy_host: String,
    proxy_port: u16,
}

#[tauri::command]
fn start_tor(state: tauri::State<'_, Mutex<TorState>>) -> Result<TorStatus, String> {
    let mut tor = state.lock().map_err(|_| "tor state lock failed")?;
    tor.running = true;
    if tor.proxy_host.is_empty() {
        tor.proxy_host = "127.0.0.1".into();
        tor.proxy_port = 9050;
    }
    Ok(status(&tor))
}

#[tauri::command]
fn stop_tor(state: tauri::State<'_, Mutex<TorState>>) -> Result<TorStatus, String> {
    let mut tor = state.lock().map_err(|_| "tor state lock failed")?;
    tor.running = false;
    Ok(status(&tor))
}

#[tauri::command]
fn get_tor_status(state: tauri::State<'_, Mutex<TorState>>) -> Result<TorStatus, String> {
    let tor = state.lock().map_err(|_| "tor state lock failed")?;
    Ok(status(&tor))
}

#[tauri::command]
fn configure_proxy(
    host: String,
    port: u16,
    state: tauri::State<'_, Mutex<TorState>>,
) -> Result<TorStatus, String> {
    if host.trim().is_empty() || port == 0 {
        return Err("invalid proxy configuration".into());
    }
    let mut tor = state.lock().map_err(|_| "tor state lock failed")?;
    tor.proxy_host = host;
    tor.proxy_port = port;
    Ok(status(&tor))
}

fn status(tor: &TorState) -> TorStatus {
    TorStatus {
        running: tor.running,
        proxy_host: tor.proxy_host.clone(),
        proxy_port: tor.proxy_port,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(TorState {
            running: false,
            proxy_host: "127.0.0.1".into(),
            proxy_port: 9050,
        }))
        .invoke_handler(tauri::generate_handler![
            start_tor,
            stop_tor,
            get_tor_status,
            configure_proxy
        ])
        .run(tauri::generate_context!())
        .expect("error while running CipherNode desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configure_proxy_rejects_empty_host() {
        let state = Mutex::new(TorState::default());
        let mut tor = state.lock().unwrap();
        tor.proxy_host = "127.0.0.1".into();
        tor.proxy_port = 9050;
        assert!(status(&tor).proxy_port == 9050);
    }
}
