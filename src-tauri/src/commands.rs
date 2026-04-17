use serde_json::Value;
use tauri::State;

use crate::runtime::Backend;

fn map_error(error: anyhow::Error) -> String {
    error.to_string()
}

#[tauri::command]
pub async fn get_app_state(backend: State<'_, Backend>) -> Result<Value, String> {
    backend.get_app_state().await.map_err(map_error)
}

#[tauri::command]
pub async fn save_config_text(text: String, backend: State<'_, Backend>) -> Result<Value, String> {
    backend.save_config_text(text).await.map_err(map_error)
}

#[tauri::command]
pub async fn save_known_settings(
    input: Value,
    backend: State<'_, Backend>,
) -> Result<Value, String> {
    backend.save_known_settings(input).await.map_err(map_error)
}

#[tauri::command]
pub async fn start_proxy(backend: State<'_, Backend>) -> Result<Value, String> {
    backend.start_proxy().await.map_err(map_error)
}

#[tauri::command]
pub async fn stop_proxy(backend: State<'_, Backend>) -> Result<Value, String> {
    backend.stop_proxy().await.map_err(map_error)
}

#[tauri::command]
pub async fn sync_runtime_config(backend: State<'_, Backend>) -> Result<Value, String> {
    backend.sync_runtime_config().await.map_err(map_error)
}

#[tauri::command]
pub async fn get_provider_auth_url(
    provider: String,
    backend: State<'_, Backend>,
) -> Result<Value, String> {
    backend
        .get_provider_auth_url(provider)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn check_provider_auth_status(
    provider: String,
    state: String,
    backend: State<'_, Backend>,
) -> Result<Value, String> {
    backend
        .check_provider_auth_status(provider, state)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn check_proxy_binary_update(backend: State<'_, Backend>) -> Result<Value, String> {
    backend.check_proxy_binary_update().await.map_err(map_error)
}

#[tauri::command]
pub async fn update_proxy_binary(backend: State<'_, Backend>) -> Result<Value, String> {
    backend.update_proxy_binary().await.map_err(map_error)
}

#[tauri::command]
pub async fn check_app_update(backend: State<'_, Backend>) -> Result<Value, String> {
    backend.check_app_update().await.map_err(map_error)
}

#[tauri::command]
pub async fn update_app(backend: State<'_, Backend>) -> Result<Value, String> {
    backend.update_app().await.map_err(map_error)
}

#[tauri::command]
pub async fn pick_auth_files(
    provider_hint: Option<String>,
    backend: State<'_, Backend>,
) -> Result<Value, String> {
    backend
        .pick_auth_files(provider_hint)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn delete_auth_file(name: String, backend: State<'_, Backend>) -> Result<Value, String> {
    backend.delete_auth_file(name).await.map_err(map_error)
}

#[tauri::command]
pub async fn toggle_auth_file(name: String, backend: State<'_, Backend>) -> Result<Value, String> {
    backend.toggle_auth_file(name).await.map_err(map_error)
}

#[tauri::command]
pub async fn get_auth_file_quota(
    name: String,
    backend: State<'_, Backend>,
) -> Result<Value, String> {
    backend.get_auth_file_quota(name).await.map_err(map_error)
}

#[tauri::command]
pub async fn save_provider(input: Value, backend: State<'_, Backend>) -> Result<Value, String> {
    backend.save_provider(input).await.map_err(map_error)
}

#[tauri::command]
pub async fn delete_provider(index: i64, backend: State<'_, Backend>) -> Result<Value, String> {
    backend.delete_provider(index).await.map_err(map_error)
}

#[tauri::command]
pub async fn save_ai_provider(input: Value, backend: State<'_, Backend>) -> Result<Value, String> {
    backend.save_ai_provider(input).await.map_err(map_error)
}

#[tauri::command]
pub async fn delete_ai_provider(
    input: Value,
    backend: State<'_, Backend>,
) -> Result<Value, String> {
    backend.delete_ai_provider(input).await.map_err(map_error)
}

#[tauri::command]
pub async fn fetch_provider_models(
    input: Value,
    backend: State<'_, Backend>,
) -> Result<Vec<String>, String> {
    backend
        .fetch_provider_models(input)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn open_path(target_path: String, backend: State<'_, Backend>) -> Result<(), String> {
    backend.open_path(target_path).map_err(map_error)
}

#[tauri::command]
pub async fn open_external(target_url: String, backend: State<'_, Backend>) -> Result<(), String> {
    backend.open_external(target_url).map_err(map_error)
}

#[tauri::command]
pub async fn clear_logs(backend: State<'_, Backend>) -> Result<Value, String> {
    backend.clear_logs().await.map_err(map_error)
}

#[tauri::command]
pub async fn stop_proxy_and_quit(backend: State<'_, Backend>) -> Result<(), String> {
    backend.stop_proxy_and_quit().await.map_err(map_error)
}
