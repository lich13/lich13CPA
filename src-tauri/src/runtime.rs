use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE, Engine as _};
use chrono::{TimeZone, Utc};
use env_proxy;
use flate2::read::GzDecoder;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client,
};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};
use sysproxy::Sysproxy;
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tempfile::TempDir;
use url::Url;
use zip::ZipArchive;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub const STATE_CHANGED_EVENT: &str = "cliproxy://state-changed";
pub const LOGS_UPDATED_EVENT: &str = "cliproxy://logs-updated";
pub const OAUTH_CALLBACK_EVENT: &str = "cliproxy://oauth-callback";

#[cfg(target_os = "windows")]
fn apply_windows_command_flags(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_windows_command_flags(_command: &mut Command) {}

const DESKTOP_METADATA_KEY: &str = "x-cliproxy-desktop";
const MAIN_LOG_NAME: &str = "main.log";
const AUTH_DIRECTORY_NAME: &str = "auth-files";
const USAGE_STATS_FILE_NAME: &str = "usage-stats.json";
const DEFAULT_PORT: u16 = 8313;
const DEFAULT_PROXY_API_KEY: &str = "cliproxy-local";
const DEFAULT_MANAGEMENT_API_KEY: &str = "cliproxy-management";
const DEFAULT_REQUEST_RETRY: u16 = 5;
const DEFAULT_MAX_RETRY_INTERVAL: u16 = 3;
const DEFAULT_STREAM_KEEPALIVE_SECONDS: u16 = 20;
const DEFAULT_STREAM_BOOTSTRAP_RETRIES: u16 = 2;
const DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS: u16 = 15;
const DEFAULT_THINKING_CUSTOM: u32 = 16000;
const DEFAULT_LOGS_MAX_TOTAL_SIZE_MB: u32 = 400;
const MAX_LOG_ENTRIES: usize = 600;
const MAX_USAGE_PROCESSED_FILE_IDS: usize = 6000;
const MIN_USAGE_LOG_FILE_AGE_MS: u64 = 1500;
const MANAGED_REASONING_EFFORT_MARKER: &str = "x-cliproxy-desktop-reasoning-effort";
const CLIPROXY_REPOSITORY: &str = "router-for-me/CLIProxyAPI";
const CLIPROXY_RELEASES_LATEST_URL: &str =
    "https://github.com/router-for-me/CLIProxyAPI/releases/latest";
const CLIPROXY_RELEASES_LATEST_API_URL: &str =
    "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest";
const DEFAULT_PROXY_CHECK_URL: &str = "https://example.com";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_PROFILE_URL: &str = "https://api.anthropic.com/api/oauth/profile";
const GEMINI_CLI_QUOTA_URL: &str =
    "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const GEMINI_CLI_CODE_ASSIST_URL: &str =
    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const KIMI_USAGE_URLS: &[&str] = &[
    "https://api.kimi.com/coding/v1/usages",
    "https://kimi.moonshot.cn/api/usage",
];

const PROVIDER_IMPORTS: &[(&str, &str)] = &[
    ("claude", "Claude"),
    ("openai", "OpenAI"),
    ("codex", "Codex"),
    ("gemini", "Gemini"),
    ("qwen", "Qwen"),
    ("iflow", "iFlow"),
    ("vertex", "Vertex"),
    ("kiro", "Kiro"),
    ("antigravity", "Antigravity"),
    ("kimi", "Kimi"),
    ("copilot", "Copilot"),
];

const PROVIDER_AUTH_ENDPOINTS: &[(&str, &str)] = &[
    ("claude", "/v0/management/anthropic-auth-url?is_webui=true"),
    ("openai", "/v0/management/codex-auth-url?is_webui=true"),
    ("codex", "/v0/management/codex-auth-url?is_webui=true"),
    ("gemini", "/v0/management/gemini-cli-auth-url?is_webui=true"),
    ("qwen", "/v0/management/qwen-auth-url?is_webui=true"),
    ("iflow", "/v0/management/iflow-auth-url?is_webui=true"),
    (
        "antigravity",
        "/v0/management/antigravity-auth-url?is_webui=true",
    ),
];

const SONNET_THINKING_MODELS: &[&str] = &[
    "claude-sonnet-4-5",
    "claude-sonnet-4-5-thinking",
    "gemini-claude-sonnet-4-5",
    "gemini-claude-sonnet-4-5-thinking",
    "claude-sonnet-4-6",
    "claude-sonnet-4-6-thinking",
    "gemini-claude-sonnet-4-6",
    "gemini-claude-sonnet-4-6-thinking",
];

const OPUS_THINKING_MODELS: &[&str] = &[
    "claude-opus-4-5",
    "claude-opus-4-5-thinking",
    "gemini-claude-opus-4-5",
    "gemini-claude-opus-4-5-thinking",
    "claude-opus-4-6",
    "claude-opus-4-6-thinking",
    "gemini-claude-opus-4-6",
    "gemini-claude-opus-4-6-thinking",
];

const CLAUDE_USAGE_WINDOW_KEYS: &[(&str, &str, &str)] = &[
    ("five_hour", "5 小时", "five-hour"),
    ("seven_day", "7 天", "seven-day"),
    (
        "seven_day_oauth_apps",
        "7 天 OAuth Apps",
        "seven-day-oauth-apps",
    ),
    ("seven_day_opus", "7 天 Opus", "seven-day-opus"),
    ("seven_day_sonnet", "7 天 Sonnet", "seven-day-sonnet"),
    ("seven_day_cowork", "7 天 Cowork", "seven-day-cowork"),
    ("iguana_necktie", "Iguana Necktie", "iguana-necktie"),
    ("primary", "主额度", "primary"),
    ("weekly", "7 天", "weekly"),
    ("daily", "24 小时", "daily"),
];

const CODEX_ACCOUNT_DISCOVERY_URLS: &[&str] = &[
    "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27",
    "https://chatgpt.com/backend-api/accounts",
    "https://chat.openai.com/backend-api/accounts/check/v4-2023-04-27",
];

const ANTIGRAVITY_QUOTA_URLS: &[&str] = &[
    "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
    "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuiState {
    reasoning_effort: String,
    proxy_binary_path: String,
    auto_sync_on_stop: bool,
    management_api_key: String,
    launch_at_login: bool,
    auto_start_proxy_on_launch: bool,
    minimize_to_tray_on_close: bool,
}

impl Default for GuiState {
    fn default() -> Self {
        Self {
            reasoning_effort: "xhigh".to_string(),
            proxy_binary_path: String::new(),
            auto_sync_on_stop: true,
            management_api_key: DEFAULT_MANAGEMENT_API_KEY.to_string(),
            launch_at_login: true,
            auto_start_proxy_on_launch: true,
            minimize_to_tray_on_close: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    timestamp: String,
    level: String,
    source: String,
    message: String,
}

#[derive(Debug, Clone)]
struct ProxyStatusData {
    running: bool,
    pid: Option<u32>,
    port: u16,
    endpoint: String,
    web_ui_url: String,
    binary_path: String,
    started_at: Option<String>,
    stopped_at: Option<String>,
    last_exit_code: Option<i32>,
    last_error: Option<String>,
    last_sync_at: Option<String>,
}

impl Default for ProxyStatusData {
    fn default() -> Self {
        Self {
            running: false,
            pid: None,
            port: DEFAULT_PORT,
            endpoint: build_api_base_url(DEFAULT_PORT),
            web_ui_url: build_management_base_url(DEFAULT_PORT),
            binary_path: String::new(),
            started_at: None,
            stopped_at: None,
            last_exit_code: None,
            last_error: None,
            last_sync_at: None,
        }
    }
}

#[derive(Debug, Clone)]
struct ProxyBinaryStateData {
    path: String,
    current_version: Option<String>,
    current_build_at: Option<String>,
    latest_version: Option<String>,
    latest_tag: Option<String>,
    update_available: Option<bool>,
    last_checked_at: Option<String>,
    last_updated_at: Option<String>,
    last_error: Option<String>,
}

impl Default for ProxyBinaryStateData {
    fn default() -> Self {
        Self {
            path: String::new(),
            current_version: None,
            current_build_at: None,
            latest_version: None,
            latest_tag: None,
            update_available: None,
            last_checked_at: None,
            last_updated_at: None,
            last_error: None,
        }
    }
}

#[derive(Debug, Clone)]
struct BinaryVersionCacheEntry {
    path: String,
    mtime_ms: u64,
    version: Option<String>,
    build_at: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedPaths {
    base_dir: PathBuf,
    install_dir: PathBuf,
    config_path: PathBuf,
    gui_state_path: PathBuf,
    auth_dir: PathBuf,
    logs_dir: PathBuf,
    usage_stats_path: PathBuf,
    binary_candidates: Vec<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct PendingOAuthState {
    pub provider: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedUsageRecord {
    record_id: String,
    model: String,
    timestamp: Option<String>,
    timestamp_ms: Option<i64>,
    total_tokens: i64,
    input_tokens: i64,
    output_tokens: i64,
    cached_tokens: i64,
    #[serde(default)]
    cache_creation_tokens: i64,
    reasoning_tokens: i64,
    failed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedUsageState {
    version: i64,
    updated_at: Option<String>,
    processed_file_ids: Vec<String>,
    records: Vec<PersistedUsageRecord>,
}

impl Default for PersistedUsageState {
    fn default() -> Self {
        Self {
            version: 1,
            updated_at: None,
            processed_file_ids: Vec::new(),
            records: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct ManagementApiCallResponse {
    status_code: u16,
    body: Value,
    body_text: String,
}

#[derive(Debug, Clone)]
struct ReleaseAssetDescriptor {
    asset_name: String,
    archive_kind: String,
    binary_names: Vec<String>,
    default_target_file_name: String,
    download_url: String,
    tag: String,
    version: String,
}

#[derive(Clone)]
pub struct Backend {
    inner: Arc<BackendInner>,
}

struct BackendInner {
    app: AppHandle,
    client: Client,
    paths: ResolvedPaths,
    logs: Mutex<Vec<LogEntry>>,
    gui_state_cache: Mutex<Option<GuiState>>,
    usage_state_cache: Mutex<Option<PersistedUsageState>>,
    proxy_status: Mutex<ProxyStatusData>,
    proxy_binary: Mutex<ProxyBinaryStateData>,
    proxy_child: Mutex<Option<Arc<Mutex<Child>>>>,
    watchers: Mutex<Vec<RecommendedWatcher>>,
    binary_version_cache: Mutex<Option<BinaryVersionCacheEntry>>,
    pending_oauth: Mutex<Option<PendingOAuthState>>,
    proxy_stop_requested: AtomicBool,
    quit_requested: AtomicBool,
}

impl Backend {
    pub fn new(app: AppHandle) -> Result<Self> {
        let client = Client::builder()
            .user_agent("CLIProxy Desktop")
            .build()
            .context("failed to build HTTP client")?;

        Ok(Self {
            inner: Arc::new(BackendInner {
                paths: resolve_paths(&app),
                app,
                client,
                logs: Mutex::new(Vec::new()),
                gui_state_cache: Mutex::new(None),
                usage_state_cache: Mutex::new(None),
                proxy_status: Mutex::new(ProxyStatusData::default()),
                proxy_binary: Mutex::new(ProxyBinaryStateData::default()),
                proxy_child: Mutex::new(None),
                watchers: Mutex::new(Vec::new()),
                binary_version_cache: Mutex::new(None),
                pending_oauth: Mutex::new(None),
                proxy_stop_requested: AtomicBool::new(false),
                quit_requested: AtomicBool::new(false),
            }),
        })
    }

    pub async fn initialize(&self) -> Result<()> {
        self.ensure_app_files()?;
        self.reload_logs_from_disk()?;
        self.start_watchers()?;

        let gui_state = self.read_gui_state()?;
        self.sync_launch_at_login(gui_state.launch_at_login).ok();

        if gui_state.auto_start_proxy_on_launch && !self_test_enabled() {
            let backend = self.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = backend.start_proxy().await {
                    backend.append_log("warn", "app", &format!("启动时自动拉起代理失败：{error}"));
                    backend.emit_state_changed();
                }
            });
        }

        let backend = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = backend.refresh_proxy_binary_state().await {
                {
                    let mut binary = backend.inner.proxy_binary.lock().unwrap();
                    binary.last_error = Some(error.to_string());
                }
                backend.append_log("warn", "app", &format!("CLIProxyAPI 更新检查失败：{error}"));
            }
            backend.emit_state_changed();
        });

        if self_test_enabled() {
            self.append_log("info", "app", "检测到自测模式，准备执行功能自测。");
            let backend = self.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = backend.run_self_test().await {
                    backend.append_log("error", "app", &format!("自测执行失败：{error}"));
                }
                backend.emit_state_changed();
                if self_test_should_exit() {
                    backend.mark_quit_requested(true);
                    backend.inner.app.exit(0);
                }
            });
        }

        Ok(())
    }

    pub fn mark_quit_requested(&self, value: bool) {
        self.inner.quit_requested.store(value, Ordering::SeqCst);
    }

    pub fn quit_requested(&self) -> bool {
        self.inner.quit_requested.load(Ordering::SeqCst)
    }

    pub fn minimize_to_tray_on_close(&self) -> bool {
        self.read_gui_state()
            .map(|state| state.minimize_to_tray_on_close)
            .unwrap_or(true)
    }

    pub fn proxy_running(&self) -> bool {
        self.is_proxy_running()
    }

    pub fn proxy_port(&self) -> u16 {
        self.inner.proxy_status.lock().unwrap().port
    }

    pub fn set_pending_oauth(&self, provider: String, state: String) {
        *self.inner.pending_oauth.lock().unwrap() = Some(PendingOAuthState { provider, state });
    }

    pub fn pending_oauth(&self) -> Option<PendingOAuthState> {
        self.inner.pending_oauth.lock().unwrap().clone()
    }

    pub fn clear_pending_oauth(&self) {
        *self.inner.pending_oauth.lock().unwrap() = None;
    }

    pub fn emit_oauth_callback(&self, provider: &str, state: &str, callback_url: &str) {
        let _ = self.inner.app.emit(
            OAUTH_CALLBACK_EVENT,
            json!({
                "provider": provider,
                "state": state,
                "callbackUrl": callback_url,
            }),
        );
    }

    pub async fn get_app_state(&self) -> Result<Value> {
        self.build_app_state(None).await
    }

    pub async fn save_config_text(&self, text: String) -> Result<Value> {
        self.ensure_app_files()?;
        let mut config = parse_config_object(&text)?;
        ensure_required_config_fields(&mut config, &self.inner.paths);
        sync_gui_state_management_api_key(self, &config)?;
        self.write_config_object(&config)?;
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn save_known_settings(&self, input: Value) -> Result<Value> {
        self.ensure_app_files()?;
        let raw = self.read_config_text()?;
        let mut config = parse_config_object(&raw)?;
        let mut gui_state = self.read_gui_state()?;

        apply_known_settings(self, &mut config, &input)?;
        gui_state.auto_sync_on_stop =
            read_bool(input.get("autoSyncOnStop"), gui_state.auto_sync_on_stop);
        gui_state.launch_at_login =
            read_bool(input.get("launchAtLogin"), gui_state.launch_at_login);
        gui_state.auto_start_proxy_on_launch = read_bool(
            input.get("autoStartProxyOnLaunch"),
            gui_state.auto_start_proxy_on_launch,
        );
        gui_state.reasoning_effort =
            read_string(input.get("reasoningEffort"), &gui_state.reasoning_effort);
        gui_state.minimize_to_tray_on_close = read_bool(
            input.get("minimizeToTrayOnClose"),
            gui_state.minimize_to_tray_on_close,
        );

        self.write_config_object(&config)?;
        self.write_gui_state_partial(gui_state)?;
        self.sync_launch_at_login(read_bool(input.get("launchAtLogin"), true))
            .ok();
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn start_proxy(&self) -> Result<Value> {
        if self.is_proxy_running() {
            return self.build_app_state(None).await;
        }

        self.ensure_app_files()?;
        let binary_path = self.ensure_proxy_binary_installed().await?;
        if binary_path.is_empty() {
            return Err(anyhow!("没有找到可用的 CLIProxyAPI 二进制，请先检查设置。"));
        }

        let (_, known_settings) = self.prepare_config_for_launch()?;
        self.proxy_stop_requested().store(false, Ordering::SeqCst);

        let mut child = Command::new(&binary_path);
        apply_windows_command_flags(&mut child);
        child
            .arg("--config")
            .arg(&self.inner.paths.config_path)
            .current_dir(&self.inner.paths.base_dir)
            .env("WRITABLE_PATH", &self.inner.paths.base_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = child
            .spawn()
            .with_context(|| format!("failed to start {binary_path}"))?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));

        {
            let mut process = self.inner.proxy_child.lock().unwrap();
            *process = Some(child.clone());
        }

        {
            let mut status = self.inner.proxy_status.lock().unwrap();
            status.running = true;
            status.pid = Some(pid);
            status.port = read_u16(
                known_settings
                    .get("port")
                    .and_then(Value::as_u64)
                    .unwrap_or(DEFAULT_PORT as u64),
                DEFAULT_PORT,
            );
            status.endpoint = read_string(
                known_settings.get("apiBaseUrl"),
                &build_api_base_url(DEFAULT_PORT),
            );
            status.web_ui_url = read_string(
                known_settings.get("managementBaseUrl"),
                &build_management_base_url(DEFAULT_PORT),
            );
            status.binary_path = binary_path.clone();
            status.started_at = Some(now_iso());
            status.stopped_at = None;
            status.last_exit_code = None;
            status.last_error = None;
        }

        self.append_log("info", "app", &format!("启动代理：{binary_path}"));
        self.spawn_proxy_reader(stdout, "info");
        self.spawn_proxy_reader(stderr, "error");
        self.spawn_proxy_monitor(child);

        if let Err(error) = self
            .wait_for_management_ready(
                read_u16(
                    known_settings
                        .get("port")
                        .and_then(Value::as_u64)
                        .unwrap_or(DEFAULT_PORT as u64),
                    DEFAULT_PORT,
                ),
                &read_string(
                    known_settings.get("managementApiKey"),
                    DEFAULT_MANAGEMENT_API_KEY,
                ),
            )
            .await
        {
            self.append_log("warn", "app", &error.to_string());
        }

        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn stop_proxy(&self) -> Result<Value> {
        if !self.is_proxy_running() {
            self.finalize_proxy_stop(None, true);
            self.ingest_usage_logs_to_store().ok();
            self.emit_state_changed();
            return self.build_app_state(None).await;
        }

        let gui_state = self.read_gui_state()?;
        if gui_state.auto_sync_on_stop {
            if let Err(error) = self.sync_runtime_config().await {
                self.append_log("warn", "app", &format!("停止前同步运行时配置失败：{error}"));
            }
        }

        self.proxy_stop_requested().store(true, Ordering::SeqCst);
        if let Some(child) = self.inner.proxy_child.lock().unwrap().as_ref().cloned() {
            let _ = child.lock().unwrap().kill();
        }

        for _ in 0..6 {
            if !self.is_proxy_running() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

        if self.is_proxy_running() {
            if let Some(child) = self.inner.proxy_child.lock().unwrap().as_ref().cloned() {
                let _ = child.lock().unwrap().kill();
            }
        }

        for _ in 0..8 {
            if !self.is_proxy_running() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        self.finalize_proxy_stop(None, true);
        self.ingest_usage_logs_to_store().ok();
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn sync_runtime_config(&self) -> Result<Value> {
        self.sync_runtime_config_file().await?;
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn refresh_usage(&self) -> Result<Value> {
        self.ingest_usage_logs_to_store()?;
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn get_usage_summary(&self, query: Option<Value>) -> Result<Value> {
        self.ensure_app_files()?;
        let query = query.unwrap_or(Value::Null);
        if self.is_proxy_running() {
            let runtime = self.resolve_management_runtime()?;
            match self
                .fetch_management_json(runtime.0, &runtime.1, "/v0/management/usage")
                .await
            {
                Ok(payload) => {
                    let management_summary = build_usage_summary(&payload, Some(&query));
                    let local_summary = self.build_usage_summary_from_logs(Some(&query))?;
                    if should_use_usage_log_fallback(&management_summary) {
                        return Ok(local_summary.unwrap_or(management_summary));
                    }
                    return Ok(management_summary);
                }
                Err(error) => {
                    if let Some(local_summary) = self.build_usage_summary_from_logs(Some(&query))? {
                        return Ok(local_summary);
                    }

                    return Ok(empty_usage_summary(Some(error.to_string()), Some(&query)));
                }
            }
        }

        Ok(self
            .build_usage_summary_from_logs(Some(&query))?
            .unwrap_or_else(|| empty_usage_summary(None, Some(&query))))
    }

    pub async fn get_provider_auth_url(&self, provider: String) -> Result<Value> {
        self.ensure_proxy_ready_for_provider_auth().await?;
        let endpoint = PROVIDER_AUTH_ENDPOINTS
            .iter()
            .find(|(id, _)| *id == provider)
            .map(|(_, endpoint)| *endpoint)
            .ok_or_else(|| {
                anyhow!(
                    "{} 暂不支持一键网页授权，请先手动导入。",
                    get_provider_import_label(&provider)
                )
            })?;
        let runtime = self.resolve_management_runtime()?;
        let payload = self
            .fetch_management_json(runtime.0, &runtime.1, endpoint)
            .await?;
        let auth_url = read_string_from_candidates(&payload, &["auth_url", "authUrl", "url"], "")
            .unwrap_or_default();
        if auth_url.is_empty() {
            return Err(anyhow!("管理接口没有返回可用的授权链接。"));
        }
        let state = read_string_from_candidates(&payload, &["state"], "")
            .or_else(|| infer_state_from_url(&auth_url))
            .unwrap_or_default();
        if state.is_empty() {
            return Err(anyhow!("管理接口没有返回授权状态标识，请稍后再试。"));
        }
        self.set_pending_oauth(provider.clone(), state.clone());
        self.append_log(
            "info",
            "app",
            &format!(
                "已生成 {} 的网页授权链接。",
                get_provider_import_label(&provider)
            ),
        );
        Ok(json!({
          "provider": provider,
          "label": get_provider_import_label(&provider),
          "authUrl": auth_url,
          "state": state,
        }))
    }

    pub async fn check_provider_auth_status(
        &self,
        provider: String,
        state: String,
    ) -> Result<Value> {
        self.ensure_proxy_ready_for_provider_auth().await?;
        let runtime = self.resolve_management_runtime()?;
        let payload = self
            .fetch_management_json(
                runtime.0,
                &runtime.1,
                &format!(
                    "/v0/management/get-auth-status?state={}",
                    url::form_urlencoded::byte_serialize(state.trim().as_bytes())
                        .collect::<String>()
                ),
            )
            .await?;
        let status = read_string(payload.get("status"), "wait").to_lowercase();
        let label = get_provider_import_label(&provider);
        if status == "ok" || status == "success" {
            self.clear_pending_oauth();
            tokio::time::sleep(Duration::from_millis(450)).await;
            let imported_files = self.sync_remote_auth_files().await?;
            self.emit_state_changed();
            if imported_files.is_empty() {
                self.append_log("info", "app", &format!("检测到 {label} 已完成网页授权。"));
            } else {
                self.append_log(
                    "info",
                    "app",
                    &format!(
                        "检测到 {label} 已完成网页授权，并已导入 {} 个认证文件。",
                        imported_files.len()
                    ),
                );
            }
            return Ok(json!({
              "provider": provider,
              "label": label,
              "state": state.trim(),
              "status": "ok",
              "error": Value::Null,
              "importedCount": imported_files.len(),
              "importedFiles": imported_files,
            }));
        }
        if status == "error" {
            self.clear_pending_oauth();
            return Ok(json!({
              "provider": provider,
              "label": label,
              "state": state.trim(),
              "status": "error",
              "error": normalized_string(payload.get("error")).unwrap_or_else(|| format!("{label} 授权失败，请重新生成授权链接后再试。")),
            }));
        }
        Ok(json!({
          "provider": provider,
          "label": label,
          "state": state.trim(),
          "status": "wait",
          "error": normalized_string(payload.get("error")),
        }))
    }

    pub async fn check_proxy_binary_update(&self) -> Result<Value> {
        self.refresh_proxy_binary_state().await?;
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn update_proxy_binary(&self) -> Result<Value> {
        self.update_proxy_binary_internal().await?;
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn pick_auth_files(&self, provider_hint: Option<String>) -> Result<Value> {
        self.ensure_app_files()?;
        let files = self_test_import_files().unwrap_or_else(|| {
            FileDialog::new()
                .add_filter("JSON", &["json"])
                .set_directory(&self.inner.paths.auth_dir)
                .pick_files()
                .unwrap_or_default()
        });

        if files.is_empty() {
            return self.build_app_state(None).await;
        }

        let imported_count = files.len();
        for source in files {
            let file_name = build_imported_auth_file_name(&source, provider_hint.as_deref());
            let target = self.next_available_auth_path(&file_name)?;
            fs::copy(&source, &target).with_context(|| {
                format!(
                    "failed to copy {} to {}",
                    source.display(),
                    target.display()
                )
            })?;
        }

        if let Some(provider_hint) = provider_hint.as_deref() {
            self.append_log(
                "info",
                "app",
                &format!(
                    "已导入 {imported_count} 个 {} 认证文件到程序同目录。",
                    get_provider_import_label(provider_hint)
                ),
            );
        } else {
            self.append_log(
                "info",
                "app",
                &format!("已导入 {imported_count} 个认证文件到程序同目录。"),
            );
        }

        self.notify_proxy_auth_files_changed().await?;
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn delete_auth_file(&self, name: String) -> Result<Value> {
        let target = resolve_inside_directory(&self.inner.paths.auth_dir, &name)?;
        if target.exists() {
            fs::remove_file(&target)?;
            self.append_log("info", "app", &format!("已删除认证文件：{name}"));
        }
        self.notify_proxy_auth_files_changed().await?;
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn toggle_auth_file(&self, name: String) -> Result<Value> {
        let current_path = resolve_inside_directory(&self.inner.paths.auth_dir, &name)?;
        if !current_path.exists() {
            return Err(anyhow!("未找到认证文件：{name}"));
        }
        let local_enabled = !is_disabled_auth_file(&name);

        if self.is_proxy_running() {
            let runtime = self.resolve_management_runtime()?;
            let mut current_enabled = local_enabled;

            if let Some(remote_enabled) = self
                .resolve_remote_auth_file_enabled_state(runtime.0, &runtime.1, &name)
                .await?
            {
                current_enabled = remote_enabled;
            }

            let will_enable = !current_enabled;
            let next_disabled = !will_enable;
            if let Err(error) = self
                .patch_auth_file_status_via_management(runtime.0, &runtime.1, &name, next_disabled)
                .await
            {
                self.append_log(
                    "warn",
                    "app",
                    &format!("管理端切换认证文件状态失败，回退为重命名方案：{error}"),
                );

                let next_name = if will_enable {
                    to_enabled_auth_name(&name)
                } else {
                    to_disabled_auth_name(&name)
                };
                let next_path = resolve_inside_directory(&self.inner.paths.auth_dir, &next_name)?;
                if next_path.exists() {
                    return Err(anyhow!("目标文件已存在：{next_name}"));
                }
                fs::rename(&current_path, &next_path)?;
            }

            self.append_log(
                "info",
                "app",
                &format!(
                    "认证文件已{}：{name}",
                    if will_enable { "启用" } else { "禁用" }
                ),
            );
        } else {
            let will_enable = is_disabled_auth_file(&name);
            let next_name = if will_enable {
                to_enabled_auth_name(&name)
            } else {
                to_disabled_auth_name(&name)
            };
            let next_path = resolve_inside_directory(&self.inner.paths.auth_dir, &next_name)?;
            if next_path.exists() {
                return Err(anyhow!("目标文件已存在：{next_name}"));
            }
            fs::rename(&current_path, &next_path)?;
            self.append_log(
                "info",
                "app",
                &format!(
                    "认证文件已{}：{name}",
                    if will_enable { "启用" } else { "禁用" }
                ),
            );
        }

        self.notify_proxy_auth_files_changed().await?;
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn get_auth_file_quota(&self, name: String) -> Result<Value> {
        if !self.is_proxy_running() {
            return Err(anyhow!("请先启动代理，再刷新认证文件额度。"));
        }
        let state = self.build_app_state(None).await?;
        let auth_files = array(state.get("authFiles"));
        let record = auth_files
            .iter()
            .find(|item| read_string(item.get("name"), "") == name)
            .cloned()
            .ok_or_else(|| anyhow!("未找到认证文件：{name}"))?;
        let provider = resolve_quota_provider(&record)
            .unwrap_or_else(|| read_string(record.get("provider"), "unknown"));
        let label = get_provider_import_label(&provider);
        let local_payload =
            self.read_auth_file_payload(Path::new(&read_string(record.get("path"), "")))?;

        let summary = if provider == "codex" || provider == "openai" {
            let auth_index = normalized_string(record.get("authIndex"));
            let runtime = self.resolve_management_runtime().ok();
            self.build_codex_quota_summary(
                &record,
                runtime.as_ref().map(|runtime| runtime.0),
                runtime.as_ref().map(|runtime| runtime.1.as_str()),
                auth_index.as_deref(),
                local_payload.as_ref(),
            )
            .await
            .unwrap_or_else(|error| {
                generic_quota_summary(&record, &provider, &label, Some(error.to_string()))
            })
        } else if provider == "claude" {
            let auth_index = normalized_string(record.get("authIndex"))
                .ok_or_else(|| anyhow!("当前认证文件还未被管理端识别，请先启动代理并刷新状态。"))?;
            let runtime = self.resolve_management_runtime()?;
            self.build_claude_quota_summary(&record, runtime.0, &runtime.1, &auth_index)
                .await
                .unwrap_or_else(|error| {
                    generic_quota_summary(&record, &provider, &label, Some(error.to_string()))
                })
        } else if provider == "gemini" {
            let auth_index = normalized_string(record.get("authIndex"))
                .ok_or_else(|| anyhow!("当前认证文件还未被管理端识别，请先启动代理并刷新状态。"))?;
            let runtime = self.resolve_management_runtime()?;
            self.build_gemini_quota_summary(
                &record,
                runtime.0,
                &runtime.1,
                &auth_index,
                local_payload.as_ref(),
            )
            .await
            .unwrap_or_else(|error| {
                generic_quota_summary(&record, &provider, &label, Some(error.to_string()))
            })
        } else if provider == "antigravity" {
            let auth_index = normalized_string(record.get("authIndex"))
                .ok_or_else(|| anyhow!("当前认证文件还未被管理端识别，请先启动代理并刷新状态。"))?;
            let runtime = self.resolve_management_runtime()?;
            self.build_antigravity_quota_summary(
                &record,
                runtime.0,
                &runtime.1,
                &auth_index,
                local_payload.as_ref(),
            )
            .await
            .unwrap_or_else(|error| {
                generic_quota_summary(&record, &provider, &label, Some(error.to_string()))
            })
        } else if provider == "kimi" {
            let auth_index = normalized_string(record.get("authIndex"))
                .ok_or_else(|| anyhow!("当前认证文件还未被管理端识别，请先启动代理并刷新状态。"))?;
            let runtime = self.resolve_management_runtime()?;
            self.build_kimi_quota_summary(&record, runtime.0, &runtime.1, &auth_index)
                .await
                .unwrap_or_else(|error| {
                    generic_quota_summary(&record, &provider, &label, Some(error.to_string()))
                })
        } else {
            generic_quota_summary(
                &record,
                &provider,
                &label,
                Some("当前类型暂不支持额度查询".to_string()),
            )
        };

        Ok(summary)
    }

    pub async fn save_provider(&self, input: Value) -> Result<Value> {
        self.ensure_app_files()?;
        let provider_name = read_string(input.get("name"), "").trim().to_string();
        let base_url = read_string(input.get("baseUrl"), "").trim().to_string();
        let api_key = read_string(input.get("apiKey"), "").trim().to_string();
        if provider_name.is_empty() || base_url.is_empty() || api_key.is_empty() {
            return Err(anyhow!("提供商名称、Base URL 和 API Key 不能为空。"));
        }
        let raw = self.read_config_text()?;
        let mut config = parse_config_object(&raw)?;
        apply_provider(&mut config, &input)?;
        self.write_config_object(&config)?;
        self.append_log("info", "app", &format!("已保存提供商：{provider_name}"));
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn delete_provider(&self, index: i64) -> Result<Value> {
        self.ensure_app_files()?;
        let raw = self.read_config_text()?;
        let mut config = parse_config_object(&raw)?;
        delete_provider_at_index(&mut config, index as usize)?;
        self.write_config_object(&config)?;
        self.append_log("info", "app", &format!("已删除提供商，索引 {index}"));
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn save_ai_provider(&self, input: Value) -> Result<Value> {
        self.ensure_app_files()?;
        let raw = self.read_config_text()?;
        let mut config = parse_config_object(&raw)?;
        apply_ai_provider(&mut config, &input)?;
        self.write_config_object(&config)?;
        let kind = read_string(input.get("kind"), "provider");
        self.append_log(
            "info",
            "app",
            &format!("已保存 {} 配置。", ai_provider_kind_label(&kind)),
        );
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn delete_ai_provider(&self, input: Value) -> Result<Value> {
        self.ensure_app_files()?;
        let raw = self.read_config_text()?;
        let mut config = parse_config_object(&raw)?;
        delete_ai_provider(&mut config, &input)?;
        self.write_config_object(&config)?;
        let kind = read_string(input.get("kind"), "provider");
        self.append_log(
            "info",
            "app",
            &format!("已删除 {} 配置。", ai_provider_kind_label(&kind)),
        );
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn fetch_provider_models(&self, input: Value) -> Result<Vec<String>> {
        let base_url = normalize_provider_models_url(read_string(input.get("baseUrl"), ""))?;
        let headers = normalize_header_entries(input.get("headers"));
        let api_key = read_string(input.get("apiKey"), "");
        let mut request_headers = HeaderMap::new();
        request_headers.insert("accept", HeaderValue::from_static("application/json"));
        for (key, value) in headers {
            request_headers.insert(
                HeaderName::from_bytes(key.as_bytes())?,
                HeaderValue::from_str(&value)?,
            );
        }
        if !api_key.trim().is_empty() && !request_headers.contains_key("authorization") {
            request_headers.insert(
                "authorization",
                HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))?,
            );
        }
        let response = self
            .inner
            .client
            .get(base_url)
            .headers(request_headers)
            .timeout(Duration::from_secs(10))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(anyhow!("拉取模型失败：HTTP {}", response.status().as_u16()));
        }
        let payload: Value = response.json().await?;
        let models = parse_provider_models_payload(&payload);
        if models.is_empty() {
            return Err(anyhow!("拉取成功，但未解析到模型列表。"));
        }
        Ok(models)
    }

    pub fn open_path(&self, target_path: String) -> Result<()> {
        if self_test_no_open() {
            self.append_log(
                "info",
                "app",
                &format!("自测模式跳过打开路径：{target_path}"),
            );
            return Ok(());
        }
        open::that(target_path)?;
        Ok(())
    }

    pub fn open_external(&self, target_url: String) -> Result<()> {
        if self_test_no_open() {
            self.append_log(
                "info",
                "app",
                &format!("自测模式跳过打开外链：{target_url}"),
            );
            return Ok(());
        }
        open::that(target_url)?;
        Ok(())
    }

    pub async fn clear_logs(&self) -> Result<Value> {
        self.ingest_usage_logs_to_store().ok();
        for entry in fs::read_dir(&self.inner.paths.logs_dir)? {
            let entry = entry?;
            let target_path = entry.path();
            if entry.file_type()?.is_dir() {
                fs::remove_dir_all(&target_path)?;
            } else {
                fs::write(&target_path, "")?;
            }
        }
        {
            let mut logs = self.inner.logs.lock().unwrap();
            logs.clear();
        }
        self.emit_logs_updated();
        self.append_log("info", "app", "日志已清空。");
        self.emit_state_changed();
        self.build_app_state(None).await
    }

    pub async fn stop_proxy_and_quit(&self) -> Result<()> {
        let _ = self.stop_proxy().await;
        self.mark_quit_requested(true);
        self.inner.app.exit(0);
        Ok(())
    }

    fn snapshot_self_test_workspace(&self, snapshot_root: &Path) -> Result<()> {
        copy_path_recursive(
            &self.inner.paths.config_path,
            &snapshot_root.join("proxy-config.yaml"),
        )?;
        copy_path_recursive(
            &self.inner.paths.gui_state_path,
            &snapshot_root.join("gui-state.json"),
        )?;
        copy_path_recursive(
            &self.inner.paths.auth_dir,
            &snapshot_root.join(AUTH_DIRECTORY_NAME),
        )?;
        copy_path_recursive(&self.inner.paths.logs_dir, &snapshot_root.join("logs"))?;
        copy_path_recursive(
            &self.inner.paths.usage_stats_path,
            &snapshot_root.join(USAGE_STATS_FILE_NAME),
        )?;
        Ok(())
    }

    fn restore_self_test_workspace(&self, snapshot_root: &Path) -> Result<()> {
        let restore_item = |relative: &str, current: &Path| -> Result<()> {
            let snapshot_path = snapshot_root.join(relative);
            remove_path_if_exists(current)?;
            if snapshot_path.exists() {
                copy_path_recursive(&snapshot_path, current)?;
            }
            Ok(())
        };

        restore_item("proxy-config.yaml", &self.inner.paths.config_path)?;
        restore_item("gui-state.json", &self.inner.paths.gui_state_path)?;
        restore_item(AUTH_DIRECTORY_NAME, &self.inner.paths.auth_dir)?;
        restore_item("logs", &self.inner.paths.logs_dir)?;
        restore_item(USAGE_STATS_FILE_NAME, &self.inner.paths.usage_stats_path)?;
        Ok(())
    }

    pub async fn run_self_test(&self) -> Result<()> {
        let snapshot_dir = TempDir::new()?;
        self.snapshot_self_test_workspace(snapshot_dir.path())?;
        self.append_log("info", "app", "开始执行功能自测。");
        let _ = self.stop_proxy().await;
        self.proxy_stop_requested().store(false, Ordering::SeqCst);

        let mut results = Vec::<Value>::new();
        let started_at = now_iso();
        let mut imported_name = None::<String>;

        let mut push_result = |name: &str, status: &str, detail: Value| {
            results.push(json!({
                "name": name,
                "status": status,
                "detail": detail,
                "at": now_iso(),
            }));
            self.append_log("info", "app", &format!("自测步骤 {name}: {status}"));
            let _ = write_self_test_report(&json!({
                "startedAt": started_at,
                "finishedAt": Value::Null,
                "failedCount": results
                    .iter()
                    .filter(|item| read_string(item.get("status"), "") == "error")
                    .count(),
                "passedCount": results
                    .iter()
                    .filter(|item| read_string(item.get("status"), "") == "ok")
                    .count(),
                "results": results,
            }));
        };

        let config_text = self.read_config_text().unwrap_or_default();
        match self.save_config_text(config_text.clone()).await {
            Ok(state) => push_result(
                "save_config_text_roundtrip",
                "ok",
                json!({
                    "configMtimeMs": state.get("configMtimeMs").cloned().unwrap_or(Value::Null),
                    "configBytes": config_text.len(),
                }),
            ),
            Err(error) => push_result(
                "save_config_text_roundtrip",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        let settings_input = json!({
            "port": 8314,
            "useSystemProxy": false,
            "proxyUrl": "",
            "proxyUsername": "",
            "proxyPassword": "",
            "proxyApiKey": "cliproxy-self-test",
            "managementApiKey": "cliproxy-management",
            "requestRetry": 7,
            "maxRetryInterval": 5,
            "streamKeepaliveSeconds": 25,
            "streamBootstrapRetries": 3,
            "nonStreamKeepaliveIntervalSeconds": 20,
            "thinkingBudgetMode": "custom",
            "thinkingBudgetCustom": 12288,
            "reasoningEffort": "high",
            "autoSyncOnStop": true,
            "launchAtLogin": false,
            "autoStartProxyOnLaunch": false,
            "minimizeToTrayOnClose": false
        });
        match self.save_known_settings(settings_input).await {
            Ok(state) => push_result(
                "save_known_settings",
                "ok",
                json!({
                    "port": state.pointer("/knownSettings/port").cloned().unwrap_or(Value::Null),
                    "reasoningEffort": state.pointer("/knownSettings/reasoningEffort").cloned().unwrap_or(Value::Null),
                    "apiBaseUrl": state.pointer("/knownSettings/apiBaseUrl").cloned().unwrap_or(Value::Null),
                }),
            ),
            Err(error) => push_result(
                "save_known_settings",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        let provider_input = json!({
            "name": "SelfTest Provider",
            "baseUrl": "https://example.invalid/v1",
            "apiKey": "sk-self-test",
            "models": [{ "name": "gpt-4.1", "alias": "gpt-4.1" }]
        });
        match self.save_provider(provider_input).await {
            Ok(state) => {
                let saved_index = array(state.get("providers")).into_iter().find_map(|item| {
                    (read_string(item.get("name"), "") == "SelfTest Provider")
                        .then(|| item.get("index").and_then(Value::as_i64).unwrap_or(-1))
                });
                push_result(
                    "save_provider",
                    "ok",
                    json!({ "index": saved_index, "count": array(state.get("providers")).len() }),
                );
                if let Some(index) = saved_index.filter(|index| *index >= 0) {
                    match self.delete_provider(index).await {
                        Ok(state) => push_result(
                            "delete_provider",
                            "ok",
                            json!({ "count": array(state.get("providers")).len() }),
                        ),
                        Err(error) => push_result(
                            "delete_provider",
                            "error",
                            json!({ "message": error.to_string(), "index": index }),
                        ),
                    }
                }
            }
            Err(error) => push_result(
                "save_provider",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        let ai_inputs = vec![
            (
                "save_ai_provider_gemini",
                json!({
                    "kind": "gemini",
                    "apiKey": "gemini-self-test",
                    "priority": 1,
                    "prefix": "g-",
                    "baseUrl": "https://example.invalid/gemini",
                    "proxyUrl": "",
                    "headers": [{ "key": "x-test", "value": "1" }],
                    "models": [{ "name": "gemini-2.5-pro", "alias": "gemini-2.5-pro" }],
                    "excludedModels": ["skip-model"]
                }),
            ),
            (
                "save_ai_provider_codex",
                json!({
                    "kind": "codex",
                    "apiKey": "codex-self-test",
                    "priority": 2,
                    "prefix": "c-",
                    "baseUrl": "https://example.invalid/codex",
                    "proxyUrl": "",
                    "headers": [{ "key": "x-test", "value": "1" }],
                    "models": [{ "name": "codex-mini", "alias": "codex-mini" }],
                    "excludedModels": [],
                    "websockets": false
                }),
            ),
            (
                "save_ai_provider_claude",
                json!({
                    "kind": "claude",
                    "apiKey": "claude-self-test",
                    "priority": 3,
                    "prefix": "a-",
                    "baseUrl": "https://example.invalid/claude",
                    "proxyUrl": "",
                    "headers": [{ "key": "x-test", "value": "1" }],
                    "models": [{ "name": "claude-sonnet-4-5", "alias": "claude-sonnet-4-5" }],
                    "excludedModels": [],
                    "websockets": true
                }),
            ),
            (
                "save_ai_provider_vertex",
                json!({
                    "kind": "vertex",
                    "apiKey": "vertex-self-test",
                    "priority": 4,
                    "prefix": "v-",
                    "baseUrl": "https://example.invalid/vertex",
                    "proxyUrl": "",
                    "headers": [{ "key": "x-test", "value": "1" }],
                    "models": [{ "name": "gemini-2.5-flash", "alias": "gemini-2.5-flash" }],
                    "excludedModels": [],
                    "websockets": false
                }),
            ),
            (
                "save_ai_provider_openai_compatibility",
                json!({
                    "kind": "openai-compatibility",
                    "name": "Compat SelfTest",
                    "prefix": "o-",
                    "baseUrl": "https://example.invalid/compat/v1",
                    "headers": [{ "key": "x-test", "value": "1" }],
                    "models": [{ "name": "o3", "alias": "o3" }],
                    "apiKeyEntries": [{
                        "apiKey": "compat-key",
                        "proxyUrl": "http://127.0.0.1:7890",
                        "headers": [{ "key": "x-entry", "value": "1" }]
                    }],
                    "priority": 5,
                    "testModel": "o3"
                }),
            ),
            (
                "save_ai_provider_ampcode",
                json!({
                    "kind": "ampcode",
                    "config": {
                        "upstreamUrl": "https://example.invalid/ampcode",
                        "upstreamApiKey": "amp-upstream",
                        "upstreamApiKeys": [{
                            "upstreamApiKey": "amp-upstream",
                            "apiKeys": ["amp-a", "amp-b"]
                        }],
                        "modelMappings": [{
                            "from": "o3",
                            "to": "gpt-4.1"
                        }],
                        "forceModelMappings": true
                    }
                }),
            ),
        ];

        for (step_name, input) in ai_inputs {
            match self.save_ai_provider(input.clone()).await {
                Ok(state) => {
                    push_result(
                        step_name,
                        "ok",
                        json!({ "kind": read_string(input.get("kind"), "") }),
                    );
                    let delete_input = match read_string(input.get("kind"), "").as_str() {
                        "gemini" => json!({ "kind": "gemini", "index": 0 }),
                        "codex" => json!({ "kind": "codex", "index": 0 }),
                        "claude" => json!({ "kind": "claude", "index": 0 }),
                        "vertex" => json!({ "kind": "vertex", "index": 0 }),
                        "openai-compatibility" => {
                            let index = array(state.pointer("/aiProviders/openaiCompatibility"))
                                .into_iter()
                                .find_map(|item| {
                                    (read_string(item.get("name"), "") == "Compat SelfTest").then(
                                        || item.get("index").and_then(Value::as_i64).unwrap_or(0),
                                    )
                                })
                                .unwrap_or(0);
                            json!({ "kind": "openai-compatibility", "index": index })
                        }
                        "ampcode" => json!({ "kind": "ampcode" }),
                        _ => Value::Null,
                    };
                    match self.delete_ai_provider(delete_input).await {
                        Ok(_) => push_result(
                            &format!("delete_{}", step_name),
                            "ok",
                            json!({ "kind": read_string(input.get("kind"), "") }),
                        ),
                        Err(error) => push_result(
                            &format!("delete_{}", step_name),
                            "error",
                            json!({ "kind": read_string(input.get("kind"), ""), "message": error.to_string() }),
                        ),
                    }
                }
                Err(error) => push_result(
                    step_name,
                    "error",
                    json!({ "kind": read_string(input.get("kind"), ""), "message": error.to_string() }),
                ),
            }
        }

        let before_names = self
            .list_auth_files()?
            .into_iter()
            .map(|item| read_string(item.get("name"), ""))
            .collect::<HashSet<_>>();
        match self.pick_auth_files(Some("codex".to_string())).await {
            Ok(state) => {
                let after_names = array(state.get("authFiles"))
                    .into_iter()
                    .map(|item| read_string(item.get("name"), ""))
                    .collect::<HashSet<_>>();
                imported_name = after_names.difference(&before_names).next().cloned();
                push_result(
                    "pick_auth_files",
                    "ok",
                    json!({
                        "importedName": imported_name,
                        "count": after_names.len(),
                    }),
                );
            }
            Err(error) => push_result(
                "pick_auth_files",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        if let Some(file_name) = imported_name.clone() {
            match self.toggle_auth_file(file_name.clone()).await {
                Ok(state) => {
                    let next_name = array(state.get("authFiles"))
                        .into_iter()
                        .map(|item| read_string(item.get("name"), ""))
                        .find(|name| name.contains("disabled") || name.starts_with('_'));
                    imported_name = next_name.clone();
                    push_result(
                        "toggle_auth_file_local",
                        "ok",
                        json!({ "currentName": next_name }),
                    );
                }
                Err(error) => push_result(
                    "toggle_auth_file_local",
                    "error",
                    json!({ "message": error.to_string(), "fileName": file_name }),
                ),
            }
        }

        match self.start_proxy().await {
            Ok(state) => push_result(
                "start_proxy",
                "ok",
                json!({
                    "running": state.pointer("/proxyStatus/running").cloned().unwrap_or(Value::Null),
                    "port": state.pointer("/proxyStatus/port").cloned().unwrap_or(Value::Null),
                }),
            ),
            Err(error) => push_result(
                "start_proxy",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        if let Some(file_name) = imported_name.clone() {
            match self.toggle_auth_file(file_name.clone()).await {
                Ok(state) => {
                    let next_name = array(state.get("authFiles"))
                        .into_iter()
                        .map(|item| read_string(item.get("name"), ""))
                        .find(|name| !name.contains("disabled") && !name.starts_with('_'));
                    imported_name = next_name.clone();
                    push_result(
                        "toggle_auth_file_runtime",
                        "ok",
                        json!({ "currentName": next_name }),
                    );
                }
                Err(error) => push_result(
                    "toggle_auth_file_runtime",
                    "error",
                    json!({ "message": error.to_string(), "fileName": file_name }),
                ),
            }
        }

        match self.get_usage_summary(None).await {
            Ok(summary) => push_result(
                "get_usage_summary",
                "ok",
                json!({
                    "available": summary.get("available").cloned().unwrap_or(Value::Null),
                    "requests": summary.pointer("/snapshot/requests").cloned().unwrap_or(Value::Null),
                }),
            ),
            Err(error) => push_result(
                "get_usage_summary",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        match self.refresh_usage().await {
            Ok(state) => push_result(
                "refresh_usage",
                "ok",
                json!({ "usageAvailable": state.pointer("/usageSummary/available").cloned().unwrap_or(Value::Null) }),
            ),
            Err(error) => push_result(
                "refresh_usage",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        match self.sync_runtime_config().await {
            Ok(state) => push_result(
                "sync_runtime_config",
                "ok",
                json!({ "lastSyncAt": state.pointer("/proxyStatus/lastSyncAt").cloned().unwrap_or(Value::Null) }),
            ),
            Err(error) => push_result(
                "sync_runtime_config",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        for (provider, _) in PROVIDER_AUTH_ENDPOINTS {
            match self.get_provider_auth_url((*provider).to_string()).await {
                Ok(payload) => {
                    push_result(
                        &format!("get_provider_auth_url_{provider}"),
                        "ok",
                        json!({
                            "state": payload.get("state").cloned().unwrap_or(Value::Null),
                            "authUrl": payload.get("authUrl").cloned().unwrap_or(Value::Null),
                        }),
                    );
                    let state_token = read_string(payload.get("state"), "");
                    match self
                        .check_provider_auth_status((*provider).to_string(), state_token.clone())
                        .await
                    {
                        Ok(status) => push_result(
                            &format!("check_provider_auth_status_{provider}"),
                            "ok",
                            json!({ "status": status.get("status").cloned().unwrap_or(Value::Null) }),
                        ),
                        Err(error) => push_result(
                            &format!("check_provider_auth_status_{provider}"),
                            "error",
                            json!({ "message": error.to_string(), "state": state_token }),
                        ),
                    }
                }
                Err(error) => push_result(
                    &format!("get_provider_auth_url_{provider}"),
                    "error",
                    json!({ "message": error.to_string() }),
                ),
            }
        }

        let quota_target = imported_name.clone().or_else(|| {
            self.list_auth_files().ok().and_then(|files| {
                files.into_iter().find_map(|item| {
                    (read_string(item.get("provider"), "") == "codex")
                        .then(|| read_string(item.get("name"), ""))
                })
            })
        });
        if let Some(file_name) = quota_target {
            match self.get_auth_file_quota(file_name.clone()).await {
                Ok(summary) => push_result(
                    "get_auth_file_quota",
                    "ok",
                    json!({
                        "provider": summary.get("provider").cloned().unwrap_or(Value::Null),
                        "items": array(summary.get("items")),
                    }),
                ),
                Err(error) => push_result(
                    "get_auth_file_quota",
                    "error",
                    json!({ "message": error.to_string(), "fileName": file_name }),
                ),
            }
        }

        match self.check_proxy_binary_update().await {
            Ok(state) => push_result(
                "check_proxy_binary_update",
                "ok",
                json!({
                    "currentVersion": state.pointer("/proxyBinary/currentVersion").cloned().unwrap_or(Value::Null),
                    "latestVersion": state.pointer("/proxyBinary/latestVersion").cloned().unwrap_or(Value::Null),
                    "updateAvailable": state.pointer("/proxyBinary/updateAvailable").cloned().unwrap_or(Value::Null),
                }),
            ),
            Err(error) => push_result(
                "check_proxy_binary_update",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        match self.update_proxy_binary().await {
            Ok(state) => push_result(
                "update_proxy_binary",
                "ok",
                json!({
                    "currentVersion": state.pointer("/proxyBinary/currentVersion").cloned().unwrap_or(Value::Null),
                    "lastUpdatedAt": state.pointer("/proxyBinary/lastUpdatedAt").cloned().unwrap_or(Value::Null),
                }),
            ),
            Err(error) => push_result(
                "update_proxy_binary",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        match start_models_stub_server() {
            Ok((base_url, handle)) => {
                match self
                    .fetch_provider_models(json!({
                        "baseUrl": base_url,
                        "apiKey": "sk-test",
                        "headers": []
                    }))
                    .await
                {
                    Ok(models) => {
                        push_result("fetch_provider_models", "ok", json!({ "models": models }))
                    }
                    Err(error) => push_result(
                        "fetch_provider_models",
                        "error",
                        json!({ "message": error.to_string() }),
                    ),
                }
                let _ = handle.join();
            }
            Err(error) => push_result(
                "fetch_provider_models",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        match self.open_path(self.inner.paths.base_dir.to_string_lossy().to_string()) {
            Ok(()) => push_result(
                "open_path",
                "ok",
                json!({ "path": self.inner.paths.base_dir.to_string_lossy() }),
            ),
            Err(error) => push_result(
                "open_path",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        match self.open_external("https://example.com".to_string()) {
            Ok(()) => push_result(
                "open_external",
                "ok",
                json!({ "url": "https://example.com" }),
            ),
            Err(error) => push_result(
                "open_external",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        match self.clear_logs().await {
            Ok(state) => push_result(
                "clear_logs",
                "ok",
                json!({ "logCount": array(state.get("logs")).len() }),
            ),
            Err(error) => push_result(
                "clear_logs",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        if let Some(file_name) = imported_name.clone() {
            match self.delete_auth_file(file_name.clone()).await {
                Ok(state) => push_result(
                    "delete_auth_file",
                    "ok",
                    json!({ "count": array(state.get("authFiles")).len() }),
                ),
                Err(error) => push_result(
                    "delete_auth_file",
                    "error",
                    json!({ "message": error.to_string(), "fileName": file_name }),
                ),
            }
        }

        match self.stop_proxy().await {
            Ok(state) => push_result(
                "stop_proxy",
                "ok",
                json!({ "running": state.pointer("/proxyStatus/running").cloned().unwrap_or(Value::Null) }),
            ),
            Err(error) => push_result(
                "stop_proxy",
                "error",
                json!({ "message": error.to_string() }),
            ),
        }

        self.restore_self_test_workspace(snapshot_dir.path())?;
        self.emit_state_changed();

        let failed = results
            .iter()
            .filter(|item| read_string(item.get("status"), "") == "error")
            .count();
        let report = json!({
            "startedAt": started_at,
            "finishedAt": now_iso(),
            "failedCount": failed,
            "passedCount": results.len().saturating_sub(failed),
            "results": results,
        });
        write_self_test_report(&report)?;

        if failed > 0 {
            self.append_log("warn", "app", &format!("功能自测完成，失败 {failed} 项。"));
        } else {
            self.append_log("info", "app", "功能自测完成，全部通过。");
        }

        Ok(())
    }
}

impl BackendInner {
    fn emit_state_changed(&self) {
        let _ = self.app.emit(STATE_CHANGED_EVENT, ());
    }

    fn emit_logs_updated(&self) {
        let logs = self.logs.lock().unwrap().clone();
        let _ = self.app.emit(LOGS_UPDATED_EVENT, logs);
    }
}

impl Backend {
    fn proxy_stop_requested(&self) -> &AtomicBool {
        &self.inner.proxy_stop_requested
    }

    fn emit_state_changed(&self) {
        self.inner.emit_state_changed();
    }

    fn emit_logs_updated(&self) {
        self.inner.emit_logs_updated();
    }

    fn ensure_app_files(&self) -> Result<()> {
        fs::create_dir_all(&self.inner.paths.base_dir)?;
        fs::create_dir_all(&self.inner.paths.auth_dir)?;
        fs::create_dir_all(&self.inner.paths.logs_dir)?;
        self.migrate_legacy_runtime_files()?;
        self.migrate_legacy_auth_files()?;

        if !self.inner.paths.config_path.exists() {
            self.write_config_object(&create_default_config(&self.inner.paths))?;
        }
        if !self.inner.paths.gui_state_path.exists() {
            self.write_gui_state_partial(GuiState::default())?;
        }
        if !self.inner.paths.usage_stats_path.exists() {
            fs::write(
                &self.inner.paths.usage_stats_path,
                serde_json::to_vec_pretty(&PersistedUsageState::default())?,
            )?;
        }
        Ok(())
    }

    fn reload_logs_from_disk(&self) -> Result<()> {
        let log_path = self.inner.paths.logs_dir.join(MAIN_LOG_NAME);
        let logs = if log_path.exists() {
            fs::read_to_string(log_path)?
                .lines()
                .filter_map(parse_persisted_log_line)
                .rev()
                .take(MAX_LOG_ENTRIES)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        *self.inner.logs.lock().unwrap() = logs;
        self.emit_logs_updated();
        Ok(())
    }

    fn append_log(&self, level: &str, source: &str, message: &str) {
        let mut normalized_lines = Vec::new();
        for line in message.replace('\r', "").split('\n') {
            let line = line.trim_end();
            if !line.is_empty() {
                normalized_lines.push(line.to_string());
            }
        }
        if normalized_lines.is_empty() {
            return;
        }

        let mut logs = self.inner.logs.lock().unwrap();
        let now = now_iso();
        for line in &normalized_lines {
            logs.push(LogEntry {
                timestamp: now.clone(),
                level: level.to_string(),
                source: source.to_string(),
                message: line.clone(),
            });
        }
        if logs.len() > MAX_LOG_ENTRIES {
            let remove = logs.len() - MAX_LOG_ENTRIES;
            logs.drain(0..remove);
        }
        let serialized = normalized_lines
            .iter()
            .map(|line| format!("[{now}] [{source}/{level}] {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.inner.paths.logs_dir.join(MAIN_LOG_NAME))
            .and_then(|mut file| file.write_all(format!("{serialized}\n").as_bytes()));
        drop(logs);
        self.emit_logs_updated();
    }

    fn read_gui_state(&self) -> Result<GuiState> {
        if let Some(cached) = self.inner.gui_state_cache.lock().unwrap().clone() {
            return Ok(cached);
        }
        let next = match fs::read_to_string(&self.inner.paths.gui_state_path) {
            Ok(raw) => serde_json::from_str::<GuiState>(&raw).unwrap_or_default(),
            Err(_) => GuiState::default(),
        };
        *self.inner.gui_state_cache.lock().unwrap() = Some(next.clone());
        Ok(next)
    }

    fn write_gui_state_partial(&self, next_state: GuiState) -> Result<GuiState> {
        fs::write(
            &self.inner.paths.gui_state_path,
            format!("{}\n", serde_json::to_string_pretty(&next_state)?),
        )?;
        *self.inner.gui_state_cache.lock().unwrap() = Some(next_state.clone());
        Ok(next_state)
    }

    fn read_config_text(&self) -> Result<String> {
        Ok(fs::read_to_string(&self.inner.paths.config_path)?)
    }

    fn write_config_object(&self, config: &Value) -> Result<()> {
        let serialized = stringify_config_object(config)?;
        fs::write(&self.inner.paths.config_path, serialized)?;
        Ok(())
    }

    fn read_persisted_usage_state(&self) -> Result<PersistedUsageState> {
        if let Some(cached) = self.inner.usage_state_cache.lock().unwrap().clone() {
            return Ok(cached);
        }
        let next = match fs::read_to_string(&self.inner.paths.usage_stats_path) {
            Ok(raw) => serde_json::from_str::<PersistedUsageState>(&raw).unwrap_or_default(),
            Err(_) => PersistedUsageState::default(),
        };
        *self.inner.usage_state_cache.lock().unwrap() = Some(next.clone());
        Ok(next)
    }

    fn write_persisted_usage_state(&self, state: &PersistedUsageState) -> Result<()> {
        let mut next = state.clone();
        next.updated_at = Some(now_iso());
        if next.processed_file_ids.len() > MAX_USAGE_PROCESSED_FILE_IDS {
            let keep_from = next.processed_file_ids.len() - MAX_USAGE_PROCESSED_FILE_IDS;
            next.processed_file_ids = next.processed_file_ids[keep_from..].to_vec();
        }
        fs::write(
            &self.inner.paths.usage_stats_path,
            serde_json::to_vec_pretty(&next)?,
        )?;
        *self.inner.usage_state_cache.lock().unwrap() = Some(next);
        Ok(())
    }

    fn migrate_legacy_auth_files(&self) -> Result<()> {
        let install_dir = &self.inner.paths.install_dir;
        if install_dir == &self.inner.paths.base_dir {
            return Ok(());
        }
        for entry in fs::read_dir(install_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_candidate_auth_file_name_v2(&name) {
                continue;
            }
            let source = entry.path();
            if !looks_like_auth_file_payload(&name, self.read_auth_file_payload(&source)?.as_ref())
            {
                continue;
            }
            let target = self.next_available_auth_path(&name)?;
            move_file_with_fallback(&source, &target)?;
        }
        Ok(())
    }

    fn migrate_legacy_runtime_files(&self) -> Result<()> {
        let install_dir = &self.inner.paths.install_dir;
        let base_dir = &self.inner.paths.base_dir;

        if install_dir == base_dir {
            return Ok(());
        }

        migrate_path_if_missing(
            &install_dir.join("proxy-config.yaml"),
            &self.inner.paths.config_path,
        )?;
        migrate_path_if_missing(
            &install_dir.join("gui-state.json"),
            &self.inner.paths.gui_state_path,
        )?;
        migrate_path_if_missing(
            &install_dir.join(USAGE_STATS_FILE_NAME),
            &self.inner.paths.usage_stats_path,
        )?;
        migrate_path_if_missing(
            &install_dir.join(AUTH_DIRECTORY_NAME),
            &self.inner.paths.auth_dir,
        )?;
        migrate_path_if_missing(&install_dir.join("logs"), &self.inner.paths.logs_dir)?;

        Ok(())
    }

    fn next_available_auth_path(&self, file_name: &str) -> Result<PathBuf> {
        let parsed = Path::new(file_name);
        let stem = parsed
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("auth");
        let ext = parsed
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("json");
        for attempt in 0..500 {
            let suffix = if attempt == 0 {
                String::new()
            } else {
                format!("-{}", attempt + 1)
            };
            let candidate = self
                .inner
                .paths
                .auth_dir
                .join(format!("{stem}{suffix}.{ext}"));
            if !candidate.exists() {
                return Ok(candidate);
            }
        }
        Err(anyhow!("认证文件重名过多，无法自动生成新名称。"))
    }

    fn read_auth_file_payload(&self, path: &Path) -> Result<Option<Value>> {
        let raw = match fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(_) => return Ok(None),
        };
        let normalized = raw.trim_start_matches('\u{FEFF}').trim();
        if normalized.is_empty() {
            return Ok(None);
        }
        let parsed: Value = match serde_json::from_str(normalized) {
            Ok(value) => value,
            Err(_) => return Ok(None),
        };
        Ok(parsed.is_object().then_some(parsed))
    }

    fn list_auth_files(&self) -> Result<Vec<Value>> {
        fs::create_dir_all(&self.inner.paths.auth_dir)?;
        let mut files = Vec::new();
        for entry in fs::read_dir(&self.inner.paths.auth_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_candidate_auth_file_name_v2(&name) {
                continue;
            }
            let full_path = entry.path();
            let metadata = fs::metadata(&full_path)?;
            let provider = detect_provider_from_file_name(&name);
            let payload = self.read_auth_file_payload(&full_path)?;
            let file_type = normalized_string(payload.as_ref().and_then(|value| value.get("type")))
                .or_else(|| {
                    normalized_string(payload.as_ref().and_then(|value| value.get("provider")))
                })
                .map(|value| value.to_lowercase())
                .unwrap_or_else(|| provider.clone());
            let detail = build_local_auth_file_details(payload.as_ref(), &provider, &file_type);
            files.push(json!({
              "name": name,
              "displayName": strip_disabled_marker(&name),
              "path": full_path.to_string_lossy(),
              "provider": provider,
              "type": file_type,
              "enabled": !is_disabled_auth_file(&name),
              "size": metadata.len(),
              "modifiedAt": system_time_to_iso(metadata.modified().ok()),
              "authIndex": Value::Null,
              "label": Value::Null,
              "source": Value::Null,
              "status": Value::Null,
              "statusMessage": Value::Null,
              "runtimeOnly": false,
              "unavailable": false,
              "createdAt": Value::Null,
              "updatedAt": Value::Null,
              "successCount": 0,
              "failureCount": 0,
              "totalRequests": 0,
              "lastUsedAt": Value::Null,
              "planType": detail.1,
              "detailItems": detail.0,
            }));
        }
        files.sort_by_key(|item| {
            std::cmp::Reverse(parse_usage_timestamp(normalized_string(
                item.get("modifiedAt"),
            )))
        });
        Ok(files)
    }

    fn build_provider_import_summaries(&self, auth_files: &[Value]) -> Vec<Value> {
        let mut summary_map: BTreeMap<String, Value> = PROVIDER_IMPORTS
            .iter()
            .map(|(id, label)| {
                (
                    (*id).to_string(),
                    json!({
                      "id": id,
                      "label": label,
                      "enabledCount": 0,
                      "disabledCount": 0,
                      "totalCount": 0,
                      "lastImportedAt": Value::Null,
                    }),
                )
            })
            .collect();
        for file in auth_files {
            let provider = read_string(file.get("provider"), "unknown");
            let key = if summary_map.contains_key(&provider) {
                provider
            } else {
                "unknown".to_string()
            };
            let entry = summary_map.entry(key.clone()).or_insert_with(|| {
                json!({
                  "id": key,
                  "label": get_provider_import_label(&key),
                  "enabledCount": 0,
                  "disabledCount": 0,
                  "totalCount": 0,
                  "lastImportedAt": Value::Null,
                })
            });
            let total = entry.get("totalCount").and_then(Value::as_i64).unwrap_or(0) + 1;
            let enabled = read_bool(file.get("enabled"), false);
            entry["totalCount"] = Value::Number(Number::from(total));
            entry["enabledCount"] = Value::Number(Number::from(
                entry
                    .get("enabledCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    + if enabled { 1 } else { 0 },
            ));
            entry["disabledCount"] = Value::Number(Number::from(
                entry
                    .get("disabledCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    + if enabled { 0 } else { 1 },
            ));
            let modified = normalized_string(file.get("modifiedAt"));
            if newer_iso(
                modified.clone(),
                normalized_string(entry.get("lastImportedAt")),
            ) {
                entry["lastImportedAt"] = modified.map(Value::String).unwrap_or(Value::Null);
            }
        }
        let mut items = summary_map.into_values().collect::<Vec<_>>();
        items.sort_by(|left, right| {
            let left_total = left.get("totalCount").and_then(Value::as_i64).unwrap_or(0);
            let right_total = right.get("totalCount").and_then(Value::as_i64).unwrap_or(0);
            right_total.cmp(&left_total).then_with(|| {
                read_string(left.get("label"), "").cmp(&read_string(right.get("label"), ""))
            })
        });
        items
    }

    async fn build_app_state(&self, usage_query: Option<&Value>) -> Result<Value> {
        self.ensure_app_files()?;
        let initial_gui_state = self.read_gui_state()?;
        let effective_binary_path = self.resolve_binary_path(&initial_gui_state)?;
        self.sync_proxy_binary_local_state(&effective_binary_path)
            .ok();
        let raw_config_text = self.read_config_text()?;
        let config_mtime_ms = fs::metadata(&self.inner.paths.config_path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|value| system_time_to_millis(Some(value)))
            .unwrap_or(0);

        let mut parsed_config = create_default_config(&self.inner.paths);
        let mut config_parse_error = None::<String>;

        match parse_config_object(&raw_config_text) {
            Ok(value) => {
                parsed_config = value;
                sync_gui_state_management_api_key(self, &parsed_config)?;
            }
            Err(error) => {
                config_parse_error = Some(error.to_string());
            }
        }

        let gui_state = if config_parse_error.is_some() {
            initial_gui_state
        } else {
            self.read_gui_state()?
        };
        let known_settings = extract_known_settings(&parsed_config, &gui_state);

        if !self.is_proxy_running() {
            let mut status = self.inner.proxy_status.lock().unwrap();
            status.port = read_u16(
                known_settings
                    .get("port")
                    .and_then(Value::as_u64)
                    .unwrap_or(DEFAULT_PORT as u64),
                DEFAULT_PORT,
            );
            status.endpoint = read_string(
                known_settings.get("apiBaseUrl"),
                &build_api_base_url(DEFAULT_PORT),
            );
            status.web_ui_url = read_string(
                known_settings.get("managementBaseUrl"),
                &build_management_base_url(DEFAULT_PORT),
            );
            status.binary_path = effective_binary_path.clone();
        }

        let mut auth_files = self.list_auth_files()?;
        let query = usage_query.cloned().unwrap_or(Value::Null);
        let mut usage_summary = self
            .build_usage_summary_from_logs(Some(&query))?
            .unwrap_or_else(|| empty_usage_summary(None, Some(&query)));
        let mut management_usage_summary = None::<Value>;

        if self.is_proxy_running() {
            let runtime = self.resolve_management_runtime()?;
            let usage_result = self
                .fetch_management_json(runtime.0, &runtime.1, "/v0/management/usage")
                .await;
            let usage_payload = usage_result.as_ref().ok().cloned();
            let remote_auth_files = self
                .fetch_management_json(runtime.0, &runtime.1, "/v0/management/auth-files")
                .await
                .ok();

            if let Some(payload) = usage_payload.as_ref() {
                let management_summary = build_usage_summary(payload, Some(&query));
                management_usage_summary = Some(management_summary.clone());
                if let Some(local_summary) = self.build_usage_summary_from_logs(Some(&query))? {
                    usage_summary = if should_use_usage_log_fallback(&management_summary) {
                        local_summary
                    } else {
                        management_summary
                    };
                } else {
                    usage_summary = management_summary;
                }
            } else if let Err(error) = usage_result {
                if !read_bool(usage_summary.get("available"), false) {
                    usage_summary = empty_usage_summary(Some(error.to_string()), Some(&query));
                }
            }

            if let Some(payload) = remote_auth_files.as_ref() {
                let remote_entries = extract_remote_auth_file_entries(payload);
                let indexed = index_remote_auth_files_by_name(&remote_entries);
                let usage_stats = if let (Some(usage_payload), Some(management_summary)) =
                    (usage_payload.as_ref(), management_usage_summary.as_ref())
                {
                    if should_use_usage_log_fallback(management_summary) {
                        HashMap::new()
                    } else {
                        collect_usage_stats_by_auth_index(usage_payload)
                    }
                } else {
                    HashMap::new()
                };
                auth_files = auth_files
                    .into_iter()
                    .map(|file| {
                        let name = read_string(file.get("name"), "").to_lowercase();
                        let remote = indexed.get(&name).cloned();
                        merge_remote_auth_file_record(file, remote, &usage_stats)
                    })
                    .collect();
            }
        }

        let warnings = {
            let mut warnings = Vec::new();
            if let Some(error) = config_parse_error.clone() {
                warnings.push(Value::String(format!(
                    "当前 proxy-config.yaml 无法解析：{error}"
                )));
            }
            if effective_binary_path.is_empty() {
                warnings.push(Value::String(
                    "尚未找到可用的 CLIProxyAPI 二进制，请重新构建应用或在设置页手动指定。"
                        .to_string(),
                ));
            }
            if !gui_state.proxy_binary_path.is_empty()
                && !Path::new(&gui_state.proxy_binary_path).exists()
            {
                warnings.push(Value::String(format!(
                    "已保存的二进制路径不存在：{}",
                    gui_state.proxy_binary_path
                )));
            }
            Value::Array(warnings)
        };

        let status = self.inner.proxy_status.lock().unwrap().clone();
        let binary = self.inner.proxy_binary.lock().unwrap().clone();
        let provider_imports = self.build_provider_import_summaries(&auth_files);

        Ok(json!({
          "paths": {
            "baseDir": self.inner.paths.base_dir.to_string_lossy(),
            "configPath": self.inner.paths.config_path.to_string_lossy(),
            "guiStatePath": self.inner.paths.gui_state_path.to_string_lossy(),
            "authDir": self.inner.paths.auth_dir.to_string_lossy(),
            "logsDir": self.inner.paths.logs_dir.to_string_lossy(),
            "binaryCandidates": self.inner.paths.binary_candidates.iter().map(|path| Value::String(path.to_string_lossy().to_string())).collect::<Vec<_>>(),
            "effectiveBinaryPath": effective_binary_path,
          },
          "proxyStatus": {
            "running": status.running,
            "pid": status.pid,
            "port": status.port,
            "endpoint": if status.running { status.endpoint.clone() } else { read_string(known_settings.get("apiBaseUrl"), &status.endpoint) },
            "webUiUrl": if status.running { status.web_ui_url.clone() } else { read_string(known_settings.get("managementBaseUrl"), &status.web_ui_url) },
            "binaryPath": if status.running { if status.binary_path.is_empty() { self.resolve_binary_path(&gui_state)? } else { status.binary_path.clone() } } else { self.resolve_binary_path(&gui_state)? },
            "startedAt": status.started_at,
            "stoppedAt": status.stopped_at,
            "lastExitCode": status.last_exit_code,
            "lastError": status.last_error,
            "lastSyncAt": status.last_sync_at,
          },
          "proxyBinary": {
            "path": if binary.path.is_empty() { self.resolve_binary_path(&gui_state)? } else { binary.path.clone() },
            "currentVersion": binary.current_version,
            "currentBuildAt": binary.current_build_at,
            "latestVersion": binary.latest_version,
            "latestTag": binary.latest_tag,
            "updateAvailable": binary.update_available,
            "lastCheckedAt": binary.last_checked_at,
            "lastUpdatedAt": binary.last_updated_at,
            "lastError": binary.last_error,
          },
          "knownSettings": known_settings,
          "configText": raw_config_text,
          "configMtimeMs": config_mtime_ms,
          "configParseError": config_parse_error,
          "providers": if config_parse_error.is_some() { Value::Array(vec![]) } else { read_providers(&parsed_config) },
          "aiProviders": if config_parse_error.is_some() { empty_ai_providers() } else { read_ai_providers(&parsed_config) },
          "authFiles": auth_files,
          "providerImports": provider_imports,
          "usageSummary": usage_summary,
          "logs": self.inner.logs.lock().unwrap().clone(),
          "warnings": warnings,
        }))
    }

    fn is_proxy_running(&self) -> bool {
        let child = self.inner.proxy_child.lock().unwrap().clone();
        if let Some(child) = child {
            if child.lock().unwrap().try_wait().ok().flatten().is_none() {
                return true;
            }
        }
        false
    }

    fn finalize_proxy_stop(&self, exit_code: Option<i32>, expected: bool) {
        let mut proxy_child = self.inner.proxy_child.lock().unwrap();
        let mut status = self.inner.proxy_status.lock().unwrap();
        if !status.running && proxy_child.is_none() {
            return;
        }
        *proxy_child = None;
        status.running = false;
        status.pid = None;
        status.stopped_at = Some(now_iso());
        status.last_exit_code = exit_code;
        if expected {
            status.last_error = None;
            self.append_log("info", "app", "代理已停止。");
        } else {
            status.last_error = Some(match exit_code {
                Some(code) => format!("代理进程异常退出，退出码 {code}"),
                None => "代理进程异常退出".to_string(),
            });
            if let Some(message) = status.last_error.clone() {
                self.append_log("warn", "app", &message);
            }
        }
    }

    fn spawn_proxy_reader(&self, stream: Option<impl Read + Send + 'static>, level: &str) {
        let Some(stream) = stream else { return };
        let backend = self.clone();
        let level = level.to_string();
        thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                backend.append_log(&level, "proxy", &line);
            }
        });
    }

    fn spawn_proxy_monitor(&self, child: Arc<Mutex<Child>>) {
        let backend = self.clone();
        thread::spawn(move || loop {
            let exit = {
                let mut child = child.lock().unwrap();
                child.try_wait().ok().flatten()
            };
            if let Some(status) = exit {
                let expected = backend.proxy_stop_requested().swap(false, Ordering::SeqCst);
                backend.finalize_proxy_stop(status.code(), expected);
                backend.emit_state_changed();
                break;
            }
            thread::sleep(Duration::from_millis(250));
        });
    }

    async fn wait_for_management_ready(&self, port: u16, management_api_key: &str) -> Result<()> {
        let mut last_error = None::<String>;
        for _ in 0..16 {
            if !self.is_proxy_running() {
                return Err(anyhow!(
                    "代理进程启动后立即退出，请检查二进制和当前 YAML 配置。"
                ));
            }
            match self
                .fetch_management_text(port, management_api_key, "/v0/management/config.yaml")
                .await
            {
                Ok(_) => return Ok(()),
                Err(error) => last_error = Some(error.to_string()),
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        if let Some(error) = last_error {
            return Err(anyhow!("管理接口未在预期时间内就绪：{error}"));
        }
        Err(anyhow!("管理接口未在预期时间内就绪。"))
    }

    fn prepare_config_for_launch(&self) -> Result<(Value, Value)> {
        let gui_state = self.read_gui_state()?;
        let config_text = self.read_config_text()?;
        let mut config = parse_config_object(&config_text)?;
        ensure_required_config_fields(&mut config, &self.inner.paths);

        let management_api_key = resolve_management_api_key(&config, &gui_state);
        {
            let remote_management =
                ensure_object_mut(root_object_mut(&mut config)?, "remote-management");
            remote_management.insert(
                "secret-key".to_string(),
                Value::String(management_api_key.clone()),
            );
        }

        let use_system_proxy =
            read_bool(get_desktop_metadata(&config).get("use-system-proxy"), false);
        if use_system_proxy {
            if let Some(proxy_url) = resolve_effective_proxy_url(&config) {
                root_object_mut(&mut config)?
                    .insert("proxy-url".to_string(), Value::String(proxy_url));
            } else {
                root_object_mut(&mut config)?.remove("proxy-url");
                self.append_log(
                    "warn",
                    "app",
                    "已启用 Use System Proxy，但当前没有检测到系统代理地址。",
                );
            }
        } else if let Some(proxy_url) = resolve_effective_proxy_url(&config) {
            root_object_mut(&mut config)?.insert("proxy-url".to_string(), Value::String(proxy_url));
        }

        self.write_gui_state_partial(GuiState {
            management_api_key,
            ..gui_state
        })?;
        self.write_config_object(&config)?;

        Ok((
            config.clone(),
            extract_known_settings(&config, &self.read_gui_state()?),
        ))
    }

    async fn sync_runtime_config_file(&self) -> Result<()> {
        if !self.is_proxy_running() {
            return Err(anyhow!("代理尚未运行，无法从运行时同步配置。"));
        }
        let gui_state = self.read_gui_state()?;
        let local_config_text = self.read_config_text()?;
        let local_config = parse_config_object(&local_config_text)?;
        let local_desktop = get_desktop_metadata(&local_config).clone();
        let local_auth_dir = normalized_string(local_config.get("auth-dir"));
        let management_api_key = resolve_management_api_key(&local_config, &gui_state);
        let port = read_u16(
            read_number(local_config.get("port"), DEFAULT_PORT as f64) as u64,
            DEFAULT_PORT,
        );
        let remote_text = self
            .fetch_management_text(port, &management_api_key, "/v0/management/config.yaml")
            .await?;
        let mut remote_config = parse_config_object(&remote_text)?;
        {
            let root = root_object_mut(&mut remote_config)?;
            let desktop = ensure_object_mut(root, DESKTOP_METADATA_KEY);
            for (key, value) in local_desktop {
                desktop.insert(key, value);
            }
            if let Some(auth_dir) = local_auth_dir {
                root.insert("auth-dir".to_string(), Value::String(auth_dir));
            }
            let remote_management = ensure_object_mut(root, "remote-management");
            remote_management.insert(
                "secret-key".to_string(),
                Value::String(management_api_key.clone()),
            );
        }
        self.write_gui_state_partial(GuiState {
            management_api_key,
            ..gui_state
        })?;
        self.write_config_object(&remote_config)?;
        self.inner.proxy_status.lock().unwrap().last_sync_at = Some(now_iso());
        self.append_log(
            "info",
            "app",
            "已从运行中的 CLIProxyAPI 同步 config.yaml 回本地文件。",
        );
        Ok(())
    }

    fn resolve_management_runtime(&self) -> Result<(u16, String)> {
        let gui_state = self.read_gui_state()?;
        let config = parse_config_object(&self.read_config_text()?)?;
        let known_settings = extract_known_settings(&config, &gui_state);
        let port = if self.is_proxy_running() {
            self.inner.proxy_status.lock().unwrap().port
        } else {
            read_u16(
                known_settings
                    .get("port")
                    .and_then(Value::as_u64)
                    .unwrap_or(DEFAULT_PORT as u64),
                DEFAULT_PORT,
            )
        };
        Ok((
            port,
            read_string(
                known_settings.get("managementApiKey"),
                DEFAULT_MANAGEMENT_API_KEY,
            ),
        ))
    }

    async fn ensure_proxy_ready_for_provider_auth(&self) -> Result<()> {
        if self.is_proxy_running() {
            return Ok(());
        }
        self.append_log("info", "app", "供应商网页登录前自动启动代理。");
        self.start_proxy().await?;
        Ok(())
    }

    async fn notify_proxy_auth_files_changed(&self) -> Result<()> {
        if !self.is_proxy_running() {
            return Ok(());
        }
        let runtime = self.resolve_management_runtime()?;
        if let Err(error) = self
            .fetch_management_text(runtime.0, &runtime.1, "/v0/management/auth-files")
            .await
        {
            self.append_log(
                "warn",
                "app",
                &format!("认证文件切换后刷新管理端状态失败：{error}"),
            );
        }
        Ok(())
    }

    async fn sync_remote_auth_files(&self) -> Result<Vec<String>> {
        if !self.is_proxy_running() {
            return Ok(Vec::new());
        }

        let runtime = self.resolve_management_runtime()?;
        for attempt in 0..4 {
            let payload = self
                .fetch_management_json(runtime.0, &runtime.1, "/v0/management/auth-files")
                .await?;
            let matching_entries = extract_remote_auth_file_entries(&payload);

            let mut imported_files = Vec::new();
            let mut local_names = self
                .list_auth_files()?
                .into_iter()
                .map(|item| read_string(item.get("name"), "").to_lowercase())
                .collect::<HashSet<_>>();

            for entry in &matching_entries {
                let Some(file_name) = normalize_remote_auth_file_base_name(
                    entry
                        .get("name")
                        .or_else(|| entry.get("id"))
                        .or_else(|| entry.get("path")),
                ) else {
                    continue;
                };

                if local_names.contains(&file_name.to_lowercase()) {
                    continue;
                }

                let bytes = self
                    .download_remote_auth_file_bytes(runtime.0, &runtime.1, &file_name)
                    .await?;
                let target = resolve_inside_directory(&self.inner.paths.auth_dir, &file_name)?;
                fs::write(&target, bytes)?;
                imported_files.push(file_name.clone());
                local_names.insert(file_name.to_lowercase());
            }

            if !imported_files.is_empty() {
                return Ok(imported_files);
            }

            if !matching_entries.is_empty() {
                return Ok(Vec::new());
            }

            if attempt < 3 {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }

        Ok(Vec::new())
    }

    async fn resolve_remote_auth_file_enabled_state(
        &self,
        port: u16,
        management_api_key: &str,
        file_name: &str,
    ) -> Result<Option<bool>> {
        let payload = self
            .fetch_management_json(port, management_api_key, "/v0/management/auth-files")
            .await?;
        let entries = extract_remote_auth_file_entries(&payload);
        let normalized_name = file_name.trim().to_lowercase();
        let normalized_enabled_name = to_enabled_auth_name(file_name).trim().to_lowercase();
        let normalized_disabled_name = to_disabled_auth_name(file_name).trim().to_lowercase();

        let target = entries.into_iter().find(|entry| {
            [
                normalize_remote_auth_file_base_name(entry.get("name")),
                normalize_remote_auth_file_base_name(entry.get("id")),
                normalize_remote_auth_file_base_name(entry.get("path")),
            ]
            .into_iter()
            .flatten()
            .map(|value| value.to_lowercase())
            .any(|value| {
                value == normalized_name
                    || value == normalized_enabled_name
                    || value == normalized_disabled_name
            })
        });

        Ok(target.map(|entry| !is_remote_auth_file_disabled(&entry)))
    }

    async fn download_remote_auth_file_bytes(
        &self,
        port: u16,
        management_api_key: &str,
        file_name: &str,
    ) -> Result<Vec<u8>> {
        let encoded_name =
            url::form_urlencoded::byte_serialize(file_name.trim().as_bytes()).collect::<String>();
        self.fetch_management_bytes(
            port,
            management_api_key,
            &format!("/v0/management/auth-files/download?name={encoded_name}"),
        )
        .await
    }

    async fn patch_auth_file_status_via_management(
        &self,
        port: u16,
        management_api_key: &str,
        file_name: &str,
        disabled: bool,
    ) -> Result<()> {
        let request_url = format!(
            "{}/v0/management/auth-files/status",
            build_management_api_base_url(port)
        );
        let body = json!({ "name": file_name, "disabled": disabled });
        let mut last_error = None::<String>;
        for headers in build_management_header_candidates(management_api_key) {
            let response = self
                .inner
                .client
                .patch(&request_url)
                .headers(headers)
                .json(&body)
                .timeout(Duration::from_secs(5))
                .send()
                .await;
            match response {
                Ok(response) if response.status().is_success() => return Ok(()),
                Ok(response) => last_error = Some(format!("HTTP {}", response.status().as_u16())),
                Err(error) => last_error = Some(error.to_string()),
            }
        }
        Err(anyhow!(
            "{}",
            last_error.unwrap_or_else(|| "管理接口请求失败。".to_string())
        ))
    }

    async fn fetch_management_text(
        &self,
        port: u16,
        management_api_key: &str,
        endpoint_path: &str,
    ) -> Result<String> {
        let request_url = format!("{}{}", build_management_api_base_url(port), endpoint_path);
        let mut last_error = None::<String>;
        for headers in build_management_header_candidates(management_api_key) {
            let response = self
                .inner
                .client
                .get(&request_url)
                .headers(headers)
                .timeout(Duration::from_secs(5))
                .send()
                .await;
            match response {
                Ok(response) if response.status().is_success() => {
                    return Ok(response.text().await?)
                }
                Ok(response) => last_error = Some(format!("HTTP {}", response.status().as_u16())),
                Err(error) => last_error = Some(error.to_string()),
            }
        }
        Err(anyhow!(
            "{}",
            last_error.unwrap_or_else(|| "管理接口请求失败。".to_string())
        ))
    }

    async fn fetch_management_json(
        &self,
        port: u16,
        management_api_key: &str,
        endpoint_path: &str,
    ) -> Result<Value> {
        Ok(serde_json::from_str(
            &self
                .fetch_management_text(port, management_api_key, endpoint_path)
                .await?,
        )?)
    }

    async fn fetch_management_bytes(
        &self,
        port: u16,
        management_api_key: &str,
        endpoint_path: &str,
    ) -> Result<Vec<u8>> {
        let request_url = format!("{}{}", build_management_api_base_url(port), endpoint_path);
        let mut last_error = None::<String>;
        for headers in build_management_header_candidates(management_api_key) {
            let response = self
                .inner
                .client
                .get(&request_url)
                .headers(headers)
                .timeout(Duration::from_secs(10))
                .send()
                .await;
            match response {
                Ok(response) if response.status().is_success() => {
                    return Ok(response.bytes().await?.to_vec())
                }
                Ok(response) => last_error = Some(format!("HTTP {}", response.status().as_u16())),
                Err(error) => last_error = Some(error.to_string()),
            }
        }
        Err(anyhow!(
            "{}",
            last_error.unwrap_or_else(|| "管理接口请求失败。".to_string())
        ))
    }

    async fn post_management_api_call(
        &self,
        port: u16,
        management_api_key: &str,
        request: &Value,
    ) -> Result<ManagementApiCallResponse> {
        let request_url = format!(
            "{}/v0/management/api-call",
            build_management_api_base_url(port)
        );
        let mut last_error = None::<String>;
        for headers in build_management_header_candidates(management_api_key) {
            let response = self
                .inner
                .client
                .post(&request_url)
                .headers(headers)
                .json(request)
                .timeout(Duration::from_secs(15))
                .send()
                .await;
            match response {
                Ok(response) => {
                    let status_code = response.status().as_u16();
                    let body_text = response.text().await.unwrap_or_default();
                    let body = serde_json::from_str::<Value>(&body_text)
                        .unwrap_or_else(|_| Value::String(body_text.clone()));
                    if status_code >= 200 && status_code < 300 {
                        return Ok(ManagementApiCallResponse {
                            status_code,
                            body,
                            body_text,
                        });
                    }
                    last_error = Some(get_api_call_error_message(&ManagementApiCallResponse {
                        status_code,
                        body,
                        body_text,
                    }));
                }
                Err(error) => last_error = Some(error.to_string()),
            }
        }
        Err(anyhow!(
            "{}",
            last_error.unwrap_or_else(|| "管理接口请求失败。".to_string())
        ))
    }

    fn ingest_usage_logs_to_store(&self) -> Result<PersistedUsageState> {
        let mut store = self.read_persisted_usage_state()?;
        let mut existing_ids = store
            .records
            .iter()
            .map(|record| record.record_id.clone())
            .collect::<HashSet<_>>();
        let mut processed = store
            .processed_file_ids
            .iter()
            .cloned()
            .collect::<HashSet<_>>();
        let mut changed = false;

        if let Ok(entries) = fs::read_dir(&self.inner.paths.logs_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default();
                if !entry
                    .file_type()
                    .map(|file_type| file_type.is_file())
                    .unwrap_or(false)
                    || !is_usage_log_file_name(name)
                {
                    continue;
                }

                let metadata = match fs::metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(_) => continue,
                };
                let modified = match metadata.modified() {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let file_age = SystemTime::now()
                    .duration_since(modified)
                    .unwrap_or_default()
                    .as_millis() as u64;
                if file_age < MIN_USAGE_LOG_FILE_AGE_MS {
                    continue;
                }
                let file_id = build_usage_log_file_id(
                    name,
                    metadata.len(),
                    system_time_to_millis(Some(modified)).unwrap_or(0),
                );
                if processed.contains(&file_id) {
                    let _ = fs::remove_file(&path);
                    continue;
                }
                let raw = match fs::read_to_string(&path) {
                    Ok(raw) => raw,
                    Err(_) => continue,
                };
                let record = parse_usage_log_record(
                    name,
                    &raw,
                    system_time_to_millis(Some(modified)).unwrap_or(0) as i64,
                );
                if let Some(record) = record {
                    if !existing_ids.contains(&file_id) {
                        store.records.push(PersistedUsageRecord {
                            record_id: file_id.clone(),
                            ..record
                        });
                        existing_ids.insert(file_id.clone());
                    }
                    store.processed_file_ids.push(file_id.clone());
                    processed.insert(file_id);
                    changed = true;
                    let _ = fs::remove_file(&path);
                }
            }
        }

        if store.processed_file_ids.len() > MAX_USAGE_PROCESSED_FILE_IDS {
            let keep_from = store.processed_file_ids.len() - MAX_USAGE_PROCESSED_FILE_IDS;
            store.processed_file_ids = store.processed_file_ids[keep_from..].to_vec();
            changed = true;
        }
        if changed {
            self.write_persisted_usage_state(&store)?;
        }
        Ok(store)
    }

    fn build_usage_summary_from_logs(&self, query: Option<&Value>) -> Result<Option<Value>> {
        let store = self.ingest_usage_logs_to_store()?;
        Ok(build_usage_summary_from_records(&store.records, query))
    }

    fn resolve_binary_path(&self, gui_state: &GuiState) -> Result<String> {
        if !gui_state.proxy_binary_path.is_empty()
            && Path::new(&gui_state.proxy_binary_path).exists()
        {
            return Ok(gui_state.proxy_binary_path.clone());
        }
        for candidate in &self.inner.paths.binary_candidates {
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().to_string());
            }
        }
        Ok(String::new())
    }

    fn get_binary_version_info(
        &self,
        binary_path: &str,
    ) -> Result<(Option<String>, Option<String>)> {
        let metadata = fs::metadata(binary_path)?;
        let mtime_ms = system_time_to_millis(metadata.modified().ok()).unwrap_or(0);
        if let Some(cache) = self.inner.binary_version_cache.lock().unwrap().clone() {
            if cache.path == binary_path && cache.mtime_ms == mtime_ms {
                return Ok((cache.version, cache.build_at));
            }
        }

        let output = {
            let mut help_command = Command::new(binary_path);
            apply_windows_command_flags(&mut help_command);
            help_command.arg("--help").output().or_else(|_| {
                let mut fallback_command = Command::new(binary_path);
                apply_windows_command_flags(&mut fallback_command);
                fallback_command.output()
            })?
        };
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let version =
            regex_capture(&combined, r"CLIProxyAPI\s+Version:\s*([^\s,]+)").or_else(|| {
                regex_capture(
                    &combined,
                    r"version[^0-9]*([0-9]+(?:\.[0-9]+)+(?:[-+][^\s,]+)?)",
                )
            });
        let build_at = regex_capture(&combined, r"BuiltAt:\s*([^\s,]+)");
        *self.inner.binary_version_cache.lock().unwrap() = Some(BinaryVersionCacheEntry {
            path: binary_path.to_string(),
            mtime_ms,
            version: version.clone(),
            build_at: build_at.clone(),
        });
        Ok((version, build_at))
    }

    fn sync_proxy_binary_local_state(&self, binary_path: &str) -> Result<()> {
        let mut binary = self.inner.proxy_binary.lock().unwrap();
        binary.path = binary_path.to_string();
        if binary_path.is_empty() || !Path::new(binary_path).exists() {
            binary.current_version = None;
            binary.current_build_at = None;
            binary.last_updated_at = None;
            binary.update_available = compute_proxy_binary_update_available(
                false,
                binary.current_version.clone(),
                binary.latest_version.clone(),
            );
            return Ok(());
        }
        let metadata = fs::metadata(binary_path)?;
        let (version, build_at) = self.get_binary_version_info(binary_path)?;
        binary.current_version = version.clone();
        binary.current_build_at = build_at;
        binary.last_updated_at = system_time_to_iso(metadata.modified().ok());
        binary.update_available =
            compute_proxy_binary_update_available(true, version, binary.latest_version.clone());
        Ok(())
    }

    async fn refresh_proxy_binary_state(&self) -> Result<()> {
        let gui_state = self.read_gui_state()?;
        let effective_binary_path = self.resolve_binary_path(&gui_state)?;
        self.sync_proxy_binary_local_state(&effective_binary_path)?;
        let descriptor = fetch_latest_release_descriptor(&self.inner.client).await?;
        let mut binary = self.inner.proxy_binary.lock().unwrap();
        binary.latest_tag = Some(descriptor.tag.clone());
        binary.latest_version = Some(descriptor.version.clone());
        binary.last_checked_at = Some(now_iso());
        binary.last_error = None;
        binary.update_available = compute_proxy_binary_update_available(
            !effective_binary_path.is_empty(),
            binary.current_version.clone(),
            Some(descriptor.version),
        );
        Ok(())
    }

    async fn update_proxy_binary_internal(&self) -> Result<String> {
        let was_running = self.is_proxy_running();
        if was_running {
            self.stop_proxy().await?;
        }
        let installed_path = self.install_proxy_binary().await?;
        if was_running {
            self.start_proxy().await?;
            self.append_log("info", "app", "CLIProxyAPI 更新完成，代理已自动重新启动。");
        }
        Ok(installed_path)
    }

    async fn install_proxy_binary(&self) -> Result<String> {
        let descriptor = fetch_latest_release_descriptor(&self.inner.client).await?;
        let gui_state = self.read_gui_state()?;
        let effective = self.resolve_binary_path(&gui_state)?;
        let target = if !effective.is_empty() {
            PathBuf::from(&effective)
        } else if !gui_state.proxy_binary_path.is_empty() {
            PathBuf::from(gui_state.proxy_binary_path.clone())
        } else {
            self.inner
                .paths
                .base_dir
                .join(&descriptor.default_target_file_name)
        };
        self.append_log(
            "info",
            "app",
            &format!(
                "开始下载 CLIProxyAPI {}：{}",
                descriptor.version, descriptor.asset_name
            ),
        );

        let temp_dir = TempDir::new()?;
        let archive_path = temp_dir.path().join(&descriptor.asset_name);
        let payload_result = self
            .inner
            .client
            .get(&descriptor.download_url)
            .timeout(Duration::from_secs(120))
            .send()
            .await;
        match payload_result {
            Ok(response) => {
                let payload = response.error_for_status()?.bytes().await?;
                fs::write(&archive_path, payload)?;
            }
            Err(error) => {
                self.append_log(
                    "warn",
                    "app",
                    &format!("直接下载 CLIProxyAPI 失败，回退到 curl：{error}"),
                );
                let status = {
                    let mut curl_command = Command::new("curl");
                    apply_windows_command_flags(&mut curl_command);
                    curl_command
                        .arg("-L")
                        .arg("--fail")
                        .arg("-o")
                        .arg(&archive_path)
                        .arg(&descriptor.download_url)
                        .status()
                        .with_context(|| "failed to execute curl for CLIProxyAPI download")?
                };
                if !status.success() {
                    return Err(anyhow!(
                        "CLIProxyAPI 下载失败，curl 退出码 {:?}",
                        status.code()
                    ));
                }
            }
        }

        let extract_dir = temp_dir.path().join("extract");
        fs::create_dir_all(&extract_dir)?;
        extract_archive(&archive_path, &extract_dir, &descriptor.archive_kind)?;
        let extracted_binary =
            find_extracted_binary(&extract_dir, &descriptor.binary_names)?.to_path_buf();
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&extracted_binary, &target)?;
        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&target)?.permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&target, permissions)?;
        }

        self.write_gui_state_partial(GuiState {
            proxy_binary_path: target.to_string_lossy().to_string(),
            ..self.read_gui_state()?
        })?;
        self.sync_proxy_binary_local_state(&target.to_string_lossy())?;
        {
            let mut binary = self.inner.proxy_binary.lock().unwrap();
            if binary.current_version.is_none() {
                binary.current_version = Some(descriptor.version.clone());
            }
            binary.latest_tag = Some(descriptor.tag.clone());
            binary.latest_version = Some(descriptor.version.clone());
            binary.last_checked_at = Some(now_iso());
            binary.last_error = None;
            binary.update_available = compute_proxy_binary_update_available(
                true,
                binary.current_version.clone(),
                binary.latest_version.clone(),
            );
        }
        self.append_log(
            "info",
            "app",
            &format!(
                "CLIProxyAPI 已更新到 {}：{}",
                descriptor.version,
                target.to_string_lossy()
            ),
        );
        Ok(target.to_string_lossy().to_string())
    }

    async fn ensure_proxy_binary_installed(&self) -> Result<String> {
        let gui_state = self.read_gui_state()?;
        let effective = self.resolve_binary_path(&gui_state)?;
        if !effective.is_empty() {
            self.sync_proxy_binary_local_state(&effective)?;
            return Ok(effective);
        }
        Err(anyhow!(
            "没有找到可用的 CLIProxyAPI 二进制，请重新构建应用或在设置页手动指定。"
        ))
    }

    fn start_watchers(&self) -> Result<()> {
        let backend = self.clone();
        let mut base_watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
            if let Ok(event) = event {
                backend.handle_fs_event(event);
            }
        })?;
        base_watcher.watch(&self.inner.paths.base_dir, RecursiveMode::NonRecursive)?;

        let backend = self.clone();
        let mut auth_watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
            if let Ok(event) = event {
                backend.handle_fs_event(event);
            }
        })?;
        auth_watcher.watch(&self.inner.paths.auth_dir, RecursiveMode::NonRecursive)?;

        let backend = self.clone();
        let mut logs_watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
            if let Ok(event) = event {
                backend.handle_fs_event(event);
            }
        })?;
        logs_watcher.watch(&self.inner.paths.logs_dir, RecursiveMode::NonRecursive)?;

        let mut watchers = self.inner.watchers.lock().unwrap();
        watchers.push(base_watcher);
        watchers.push(auth_watcher);
        watchers.push(logs_watcher);
        Ok(())
    }

    fn handle_fs_event(&self, event: Event) {
        let mut touched_state = false;
        let mut reload_logs = false;
        let mut ingest_usage = false;
        for path in event.paths {
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if file_name == MAIN_LOG_NAME {
                reload_logs = true;
            }
            if file_name == "proxy-config.yaml" || file_name == "gui-state.json" {
                touched_state = true;
            }
            if is_candidate_auth_file_name_v2(file_name)
                && path.starts_with(&self.inner.paths.auth_dir)
            {
                touched_state = true;
            }
            if is_usage_log_file_name(file_name) {
                ingest_usage = true;
                touched_state = true;
            }
        }
        if reload_logs {
            let _ = self.reload_logs_from_disk();
        }
        if ingest_usage {
            let _ = self.ingest_usage_logs_to_store();
        }
        if touched_state {
            self.emit_state_changed();
        }
    }

    fn sync_launch_at_login(&self, enabled: bool) -> Result<()> {
        let autolaunch = self.inner.app.autolaunch();
        if enabled {
            autolaunch.enable()?;
        } else {
            autolaunch.disable()?;
        }
        Ok(())
    }

    async fn build_codex_quota_summary(
        &self,
        record: &Value,
        port: Option<u16>,
        management_api_key: Option<&str>,
        auth_index: Option<&str>,
        local_payload: Option<&Value>,
    ) -> Result<Value> {
        let mut last_error = None::<String>;

        if let (Some(port), Some(management_api_key), Some(auth_index)) =
            (port, management_api_key, auth_index)
        {
            let mut headers = codex_request_headers();
            if let Some(account_id) =
                local_payload.and_then(resolve_codex_chatgpt_account_id_from_payload)
            {
                headers.insert("Chatgpt-Account-Id".to_string(), account_id);
            }
            let request = json!({
              "authIndex": auth_index,
              "method": "GET",
              "url": CODEX_USAGE_URL,
              "header": headers,
            });
            let mut result = self
                .post_management_api_call(port, management_api_key, &request)
                .await?;
            if !(200..300).contains(&result.status_code) {
                if let Some(account_id) = self
                    .resolve_codex_chatgpt_account_id_via_api(port, management_api_key, auth_index)
                    .await?
                {
                    let mut retry_headers = codex_request_headers();
                    retry_headers.insert("Chatgpt-Account-Id".to_string(), account_id);
                    result = self
                        .post_management_api_call(
                            port,
                            management_api_key,
                            &json!({
                              "authIndex": auth_index,
                              "method": "GET",
                              "url": CODEX_USAGE_URL,
                              "header": retry_headers,
                            }),
                        )
                        .await?;
                }
            }
            if (200..300).contains(&result.status_code) {
                let summary =
                    build_codex_quota_summary(record, &parse_management_api_body(&result.body));
                if !array(summary.get("items")).is_empty() {
                    return Ok(summary);
                }
                last_error = Some("管理端返回的 Codex 额度为空。".to_string());
            } else {
                last_error = Some(get_api_call_error_message(&result));
            }
        }

        if let Some(local_payload) = local_payload {
            if let Ok(summary) = self
                .build_codex_quota_summary_direct(record, local_payload)
                .await
            {
                if !array(summary.get("items")).is_empty() {
                    return Ok(summary);
                }
                last_error = Some("直连 Codex 配额接口返回为空。".to_string());
            }
        }

        Err(anyhow!(
            "{}",
            last_error.unwrap_or_else(|| "未获取到可用额度数据。".to_string())
        ))
    }

    async fn resolve_codex_chatgpt_account_id_via_api(
        &self,
        port: u16,
        management_api_key: &str,
        auth_index: &str,
    ) -> Result<Option<String>> {
        for url in CODEX_ACCOUNT_DISCOVERY_URLS {
            let request = json!({
              "authIndex": auth_index,
              "method": "GET",
              "url": url,
              "header": codex_request_headers(),
            });
            let result = self
                .post_management_api_call(port, management_api_key, &request)
                .await;
            if let Ok(result) = result {
                if (200..300).contains(&result.status_code) {
                    if let Some(account_id) =
                        resolve_codex_chatgpt_account_id_from_accounts_payload(&result.body)
                    {
                        return Ok(Some(account_id));
                    }
                }
            }
        }
        Ok(None)
    }

    async fn build_codex_quota_summary_direct(
        &self,
        record: &Value,
        local_payload: &Value,
    ) -> Result<Value> {
        let access_token = resolve_codex_access_token_from_payload(local_payload)
            .ok_or_else(|| anyhow!("当前 Codex 认证文件缺少 access_token。"))?;
        let mut account_id = resolve_codex_chatgpt_account_id_from_payload(local_payload);

        let mut result = self
            .request_codex_usage_direct(&access_token, account_id.as_deref())
            .await?;
        if !(200..300).contains(&result.status_code) {
            account_id = self
                .resolve_codex_chatgpt_account_id_via_direct_api(&access_token)
                .await?
                .or(account_id);
            if let Some(account_id) = account_id.as_deref() {
                result = self
                    .request_codex_usage_direct(&access_token, Some(account_id))
                    .await?;
            }
        }
        if !(200..300).contains(&result.status_code) {
            return Err(anyhow!("{}", get_api_call_error_message(&result)));
        }

        Ok(build_codex_quota_summary(
            record,
            &parse_management_api_body(&result.body),
        ))
    }

    async fn request_codex_usage_direct(
        &self,
        access_token: &str,
        chatgpt_account_id: Option<&str>,
    ) -> Result<ManagementApiCallResponse> {
        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {}", access_token.trim()))?,
        );
        headers.insert("content-type", HeaderValue::from_static("application/json"));
        headers.insert(
            "user-agent",
            HeaderValue::from_static("codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal"),
        );
        if let Some(account_id) = chatgpt_account_id.filter(|value| !value.trim().is_empty()) {
            headers.insert(
                "chatgpt-account-id",
                HeaderValue::from_str(account_id.trim())?,
            );
        }

        let response = self
            .inner
            .client
            .get(CODEX_USAGE_URL)
            .headers(headers)
            .timeout(Duration::from_secs(15))
            .send()
            .await?;
        let status_code = response.status().as_u16();
        let body_text = response.text().await.unwrap_or_default();
        let body = serde_json::from_str::<Value>(&body_text)
            .unwrap_or_else(|_| Value::String(body_text.clone()));

        Ok(ManagementApiCallResponse {
            status_code,
            body,
            body_text,
        })
    }

    async fn resolve_codex_chatgpt_account_id_via_direct_api(
        &self,
        access_token: &str,
    ) -> Result<Option<String>> {
        for url in CODEX_ACCOUNT_DISCOVERY_URLS {
            let mut headers = HeaderMap::new();
            headers.insert(
                "authorization",
                HeaderValue::from_str(&format!("Bearer {}", access_token.trim()))?,
            );
            headers.insert("content-type", HeaderValue::from_static("application/json"));
            headers.insert(
                "user-agent",
                HeaderValue::from_static(
                    "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
                ),
            );

            let response = self
                .inner
                .client
                .get(*url)
                .headers(headers)
                .timeout(Duration::from_secs(15))
                .send()
                .await;
            if let Ok(response) = response {
                if !response.status().is_success() {
                    continue;
                }
                let body_text = response.text().await.unwrap_or_default();
                let body = serde_json::from_str::<Value>(&body_text)
                    .unwrap_or_else(|_| Value::String(body_text.clone()));
                if let Some(account_id) =
                    resolve_codex_chatgpt_account_id_from_accounts_payload(&body)
                {
                    return Ok(Some(account_id));
                }
            }
        }
        Ok(None)
    }

    async fn build_claude_quota_summary(
        &self,
        record: &Value,
        port: u16,
        management_api_key: &str,
        auth_index: &str,
    ) -> Result<Value> {
        let usage = self
            .post_management_api_call(
                port,
                management_api_key,
                &json!({
                  "authIndex": auth_index,
                  "method": "GET",
                  "url": CLAUDE_USAGE_URL,
                  "header": claude_request_headers(),
                }),
            )
            .await?;
        if !(200..300).contains(&usage.status_code) {
            return Err(anyhow!("{}", get_api_call_error_message(&usage)));
        }
        let profile = self
            .post_management_api_call(
                port,
                management_api_key,
                &json!({
                  "authIndex": auth_index,
                  "method": "GET",
                  "url": CLAUDE_PROFILE_URL,
                  "header": claude_request_headers(),
                }),
            )
            .await
            .ok();
        Ok(build_claude_quota_summary(
            record,
            &parse_management_api_body(&usage.body),
            profile
                .as_ref()
                .filter(|result| (200..300).contains(&result.status_code))
                .map(|result| parse_management_api_body(&result.body)),
        ))
    }

    async fn build_gemini_quota_summary(
        &self,
        record: &Value,
        port: u16,
        management_api_key: &str,
        auth_index: &str,
        local_payload: Option<&Value>,
    ) -> Result<Value> {
        let project_id = local_payload
            .and_then(resolve_gemini_cli_project_id_from_payload)
            .ok_or_else(|| anyhow!("当前 Gemini CLI 认证文件缺少项目 ID。"))?;
        let quota = self
            .post_management_api_call(
                port,
                management_api_key,
                &json!({
                  "authIndex": auth_index,
                  "method": "POST",
                  "url": GEMINI_CLI_QUOTA_URL,
                  "header": gemini_request_headers(),
                  "data": serde_json::to_string(&json!({ "project": project_id }))?,
                }),
            )
            .await?;
        if !(200..300).contains(&quota.status_code) {
            return Err(anyhow!("{}", get_api_call_error_message(&quota)));
        }
        let code_assist = self
            .post_management_api_call(
                port,
                management_api_key,
                &json!({
                  "authIndex": auth_index,
                  "method": "POST",
                  "url": GEMINI_CLI_CODE_ASSIST_URL,
                  "header": gemini_request_headers(),
                  "data": serde_json::to_string(&json!({
                    "cloudaicompanionProject": project_id,
                    "metadata": {
                      "ideType": "IDE_UNSPECIFIED",
                      "platform": "PLATFORM_UNSPECIFIED",
                      "pluginType": "GEMINI",
                      "duetProject": project_id,
                    }
                  }))?,
                }),
            )
            .await
            .ok();
        Ok(build_gemini_quota_summary(
            record,
            &parse_management_api_body(&quota.body),
            code_assist
                .as_ref()
                .filter(|result| (200..300).contains(&result.status_code))
                .map(|result| parse_management_api_body(&result.body)),
        ))
    }

    async fn build_antigravity_quota_summary(
        &self,
        record: &Value,
        port: u16,
        management_api_key: &str,
        auth_index: &str,
        local_payload: Option<&Value>,
    ) -> Result<Value> {
        let project_id = local_payload
            .and_then(resolve_antigravity_project_id_from_payload)
            .unwrap_or_else(|| "bamboo-precept-lgxtn".to_string());
        let mut last_error = None::<String>;
        for url in ANTIGRAVITY_QUOTA_URLS {
            let result = self
                .post_management_api_call(
                    port,
                    management_api_key,
                    &json!({
                      "authIndex": auth_index,
                      "method": "POST",
                      "url": url,
                      "header": antigravity_request_headers(),
                      "data": serde_json::to_string(&json!({ "project": project_id }))?,
                    }),
                )
                .await;
            match result {
                Ok(result) if (200..300).contains(&result.status_code) => {
                    return Ok(build_antigravity_quota_summary(
                        record,
                        &parse_management_api_body(&result.body),
                        &project_id,
                    ))
                }
                Ok(result) => last_error = Some(get_api_call_error_message(&result)),
                Err(error) => last_error = Some(error.to_string()),
            }
        }
        Err(anyhow!(
            "{}",
            last_error.unwrap_or_else(|| "未获取到可用额度数据。".to_string())
        ))
    }

    async fn build_kimi_quota_summary(
        &self,
        record: &Value,
        port: u16,
        management_api_key: &str,
        auth_index: &str,
    ) -> Result<Value> {
        let mut last_error = None::<String>;
        for url in KIMI_USAGE_URLS {
            let result = self
                .post_management_api_call(
                    port,
                    management_api_key,
                    &json!({
                      "authIndex": auth_index,
                      "method": "GET",
                      "url": url,
                      "header": kimi_request_headers(),
                    }),
                )
                .await;
            match result {
                Ok(result) if (200..300).contains(&result.status_code) => {
                    return Ok(build_kimi_quota_summary(
                        record,
                        &parse_management_api_body(&result.body),
                    ))
                }
                Ok(result) => last_error = Some(get_api_call_error_message(&result)),
                Err(error) => last_error = Some(error.to_string()),
            }
        }
        Err(anyhow!(
            "{}",
            last_error.unwrap_or_else(|| "未获取到可用额度数据。".to_string())
        ))
    }
}

fn resolve_paths(app: &AppHandle) -> ResolvedPaths {
    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    let base_dir = app
        .path()
        .app_local_data_dir()
        .or_else(|_| app.path().app_data_dir())
        .or_else(|_| app.path().app_config_dir())
        .unwrap_or_else(|_| install_dir.clone());
    let resource_dir = app.path().resource_dir().ok();
    let resource_roots = resource_dir
        .as_ref()
        .map(|dir| vec![dir.clone(), dir.join("resources")])
        .unwrap_or_default();
    let binary_names = proxy_binary_names();
    let mut seen = HashSet::new();
    let mut binary_candidates = Vec::new();

    for name in &binary_names {
        push_unique_path(&mut binary_candidates, &mut seen, install_dir.join(name));
        push_unique_path(
            &mut binary_candidates,
            &mut seen,
            install_dir.join("bin").join(name),
        );

        for resource_root in &resource_roots {
            push_unique_path(&mut binary_candidates, &mut seen, resource_root.join(name));
            push_unique_path(
                &mut binary_candidates,
                &mut seen,
                resource_root.join("bin").join(name),
            );
        }
    }

    ResolvedPaths {
        config_path: base_dir.join("proxy-config.yaml"),
        gui_state_path: base_dir.join("gui-state.json"),
        auth_dir: base_dir.join(AUTH_DIRECTORY_NAME),
        logs_dir: base_dir.join("logs"),
        usage_stats_path: base_dir.join(USAGE_STATS_FILE_NAME),
        base_dir,
        install_dir,
        binary_candidates,
    }
}

fn push_unique_path(paths: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, candidate: PathBuf) {
    if seen.insert(candidate.clone()) {
        paths.push(candidate);
    }
}

fn proxy_binary_names() -> Vec<&'static str> {
    if cfg!(target_os = "windows") {
        vec![
            "cli-proxy-api.exe",
            "cli-proxy-api-aarch64-pc-windows-msvc.exe",
            "cli-proxy-api-x86_64-pc-windows-msvc.exe",
            "CLIProxyAPI.exe",
            "cli-proxy-api-plus.exe",
            "CLIProxyAPIPlus.exe",
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "cli-proxy-api",
            "cli-proxy-api-aarch64-apple-darwin",
            "cliproxyapi-aarch64-apple-darwin",
            "cli-proxy-api-x86_64-apple-darwin",
            "cliproxyapi-x86_64-apple-darwin",
            "CLIProxyAPI",
            "cli-proxy-api-plus",
            "CLIProxyAPIPlus",
        ]
    } else {
        vec![
            "cli-proxy-api",
            "CLIProxyAPI",
            "cli-proxy-api-plus",
            "CLIProxyAPIPlus",
        ]
    }
}

fn create_default_config(paths: &ResolvedPaths) -> Value {
    json!({
      "port": DEFAULT_PORT,
      "auth-dir": normalize_yaml_path(&paths.auth_dir),
      "api-keys": [DEFAULT_PROXY_API_KEY],
      "debug": false,
      "logging-to-file": true,
      "logs-max-total-size-mb": DEFAULT_LOGS_MAX_TOTAL_SIZE_MB,
      "usage-statistics-enabled": true,
      "request-log": true,
      "request-retry": DEFAULT_REQUEST_RETRY,
      "max-retry-interval": DEFAULT_MAX_RETRY_INTERVAL,
      "streaming": {
        "keepalive-seconds": DEFAULT_STREAM_KEEPALIVE_SECONDS,
        "bootstrap-retries": DEFAULT_STREAM_BOOTSTRAP_RETRIES,
      },
      "nonstream-keepalive-interval": DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS,
      "routing": {
        "strategy": "round-robin"
      },
      "remote-management": {
        "allow-remote": true,
        "secret-key": DEFAULT_MANAGEMENT_API_KEY,
        "disable-control-panel": false,
      },
      "payload": {
        "default": [
          build_managed_thinking_entry(SONNET_THINKING_MODELS, 8192),
          build_managed_thinking_entry(OPUS_THINKING_MODELS, 8192),
          build_managed_reasoning_effort_entry("xhigh"),
        ]
      },
      DESKTOP_METADATA_KEY: {
        "use-system-proxy": false,
        "manual-proxy-url": "",
        "proxy-username": "",
        "proxy-password": "",
        "thinking-budget": {
          "mode": "medium",
          "custom-budget": DEFAULT_THINKING_CUSTOM,
        }
      }
    })
}

fn build_managed_thinking_entry(model_names: &[&str], token_budget: u32) -> Value {
    json!({
      "models": model_names.iter().map(|name| json!({ "name": name, "protocol": "claude" })).collect::<Vec<_>>(),
      "params": {
        "thinking.budget_tokens": token_budget
      }
    })
}

fn build_managed_reasoning_effort_entry(reasoning_effort: &str) -> Value {
    json!({
      "params": {
        "reasoning.effort": reasoning_effort,
        "_managedBy": MANAGED_REASONING_EFFORT_MARKER,
      }
    })
}

fn parse_config_object(text: &str) -> Result<Value> {
    let yaml: serde_yaml::Value = serde_yaml::from_str(text)?;
    if yaml.is_null() {
        return Ok(json!({}));
    }
    let json = serde_json::to_value(yaml)?;
    if json.is_object() {
        Ok(json)
    } else {
        Err(anyhow!("YAML 根节点必须是对象。"))
    }
}

fn stringify_config_object(config: &Value) -> Result<String> {
    let yaml: serde_yaml::Value = serde_json::from_value(config.clone())?;
    let serialized = serde_yaml::to_string(&yaml)?;
    Ok(ensure_trailing_newline(
        serialized
            .strip_prefix("---\n")
            .unwrap_or(&serialized)
            .to_string(),
    ))
}

fn ensure_required_config_fields(config: &mut Value, paths: &ResolvedPaths) {
    let root = match root_object_mut(config) {
        Ok(root) => root,
        Err(_) => return,
    };
    root.insert(
        "port".to_string(),
        Value::Number(Number::from(clamp_port(
            read_number(root.get("port"), DEFAULT_PORT as f64) as u16,
        ))),
    );
    let api_keys = array(root.get("api-keys"))
        .iter()
        .filter_map(|item| normalized_string(Some(item)))
        .collect::<Vec<_>>();
    root.insert(
        "api-keys".to_string(),
        Value::Array(if api_keys.is_empty() {
            vec![Value::String(DEFAULT_PROXY_API_KEY.to_string())]
        } else {
            api_keys.into_iter().map(Value::String).collect()
        }),
    );
    root.insert(
        "auth-dir".to_string(),
        Value::String(normalize_yaml_path(&paths.auth_dir)),
    );
    root.insert(
        "request-log".to_string(),
        Value::Bool(read_bool(root.get("request-log"), true)),
    );
    root.insert(
        "logging-to-file".to_string(),
        Value::Bool(read_bool(root.get("logging-to-file"), true)),
    );
    root.insert(
        "usage-statistics-enabled".to_string(),
        Value::Bool(read_bool(root.get("usage-statistics-enabled"), true)),
    );
    root.insert(
        "logs-max-total-size-mb".to_string(),
        Value::Number(Number::from(read_number(
            root.get("logs-max-total-size-mb"),
            DEFAULT_LOGS_MAX_TOTAL_SIZE_MB as f64,
        ) as i64)),
    );
    root.insert(
        "request-retry".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            root.get("request-retry"),
            DEFAULT_REQUEST_RETRY as f64,
        ) as i64))),
    );
    root.insert(
        "max-retry-interval".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            root.get("max-retry-interval"),
            DEFAULT_MAX_RETRY_INTERVAL as f64,
        ) as i64))),
    );
    root.insert(
        "nonstream-keepalive-interval".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            root.get("nonstream-keepalive-interval"),
            DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS as f64,
        ) as i64))),
    );
    let streaming = ensure_object_mut(root, "streaming");
    streaming.insert(
        "keepalive-seconds".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            streaming.get("keepalive-seconds"),
            DEFAULT_STREAM_KEEPALIVE_SECONDS as f64,
        ) as i64))),
    );
    streaming.insert(
        "bootstrap-retries".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            streaming.get("bootstrap-retries"),
            DEFAULT_STREAM_BOOTSTRAP_RETRIES as f64,
        ) as i64))),
    );
    let routing = ensure_object_mut(root, "routing");
    routing.insert(
        "strategy".to_string(),
        Value::String(read_string(routing.get("strategy"), "round-robin")),
    );
    let remote_management = ensure_object_mut(root, "remote-management");
    remote_management.insert(
        "allow-remote".to_string(),
        Value::Bool(read_bool(remote_management.get("allow-remote"), true)),
    );
    remote_management.insert(
        "secret-key".to_string(),
        Value::String(
            normalized_string(remote_management.get("secret-key"))
                .unwrap_or_else(|| DEFAULT_MANAGEMENT_API_KEY.to_string()),
        ),
    );
    remote_management.insert(
        "disable-control-panel".to_string(),
        Value::Bool(read_bool(
            remote_management.get("disable-control-panel"),
            false,
        )),
    );
}

fn get_desktop_metadata(config: &Value) -> Map<String, Value> {
    object(config.get(DESKTOP_METADATA_KEY))
}

fn sync_gui_state_management_api_key(backend: &Backend, config: &Value) -> Result<()> {
    let config_key = normalized_string(
        config
            .get("remote-management")
            .and_then(|value| value.get("secret-key")),
    );
    if let Some(config_key) = config_key {
        if !is_hashed_management_api_key(&config_key) {
            let mut gui_state = backend.read_gui_state()?;
            gui_state.management_api_key = config_key;
            backend.write_gui_state_partial(gui_state)?;
        }
    }
    Ok(())
}

fn resolve_management_api_key(config: &Value, gui_state: &GuiState) -> String {
    let config_key = normalized_string(
        config
            .get("remote-management")
            .and_then(|value| value.get("secret-key")),
    );
    if let Some(config_key) = config_key {
        if !is_hashed_management_api_key(&config_key) {
            return config_key;
        }
    }
    if !gui_state.management_api_key.trim().is_empty() {
        return gui_state.management_api_key.trim().to_string();
    }
    DEFAULT_MANAGEMENT_API_KEY.to_string()
}

fn apply_proxy_credentials(proxy_url: &str, username: &str, password: &str) -> String {
    let trimmed_url = proxy_url.trim();
    if trimmed_url.is_empty() {
        return String::new();
    }

    if username.trim().is_empty() || password.trim().is_empty() {
        return trimmed_url.to_string();
    }

    if let Ok(mut url) = Url::parse(trimmed_url) {
        let _ = url.set_username(username.trim());
        let _ = url.set_password(Some(password.trim()));
        return url.to_string();
    }

    trimmed_url.to_string()
}

fn resolve_effective_proxy_url(config: &Value) -> Option<String> {
    let desktop = get_desktop_metadata(config);
    let proxy_username = read_string(desktop.get("proxy-username"), "");
    let proxy_password = read_string(desktop.get("proxy-password"), "");
    let base_proxy_url = if read_bool(desktop.get("use-system-proxy"), false) {
        detect_system_proxy_url().unwrap_or_default()
    } else {
        read_string(
            desktop.get("manual-proxy-url"),
            &read_string(config.get("proxy-url"), ""),
        )
    };

    let proxy_url = apply_proxy_credentials(&base_proxy_url, &proxy_username, &proxy_password);
    (!proxy_url.trim().is_empty()).then_some(proxy_url)
}

fn extract_known_settings(config: &Value, gui_state: &GuiState) -> Value {
    let desktop = get_desktop_metadata(config);
    let streaming = object(config.get("streaming"));
    let port = clamp_port(read_number(config.get("port"), DEFAULT_PORT as f64) as u16);
    let api_keys = array(config.get("api-keys"));
    let proxy_api_key = api_keys
        .iter()
        .find_map(|item| normalized_string(Some(item)))
        .unwrap_or_else(|| DEFAULT_PROXY_API_KEY.to_string());
    let (thinking_mode, thinking_custom) = extract_thinking_budget(config);
    json!({
      "port": port,
      "useSystemProxy": read_bool(desktop.get("use-system-proxy"), false),
      "proxyUrl": read_string(desktop.get("manual-proxy-url"), &read_string(config.get("proxy-url"), "")),
      "proxyUsername": read_string(desktop.get("proxy-username"), ""),
      "proxyPassword": read_string(desktop.get("proxy-password"), ""),
      "proxyApiKey": proxy_api_key,
      "managementApiKey": resolve_management_api_key(config, gui_state),
      "requestRetry": clamp_non_negative_integer(read_number(config.get("request-retry"), DEFAULT_REQUEST_RETRY as f64) as i64),
      "maxRetryInterval": clamp_non_negative_integer(read_number(config.get("max-retry-interval"), DEFAULT_MAX_RETRY_INTERVAL as f64) as i64),
      "streamKeepaliveSeconds": clamp_non_negative_integer(read_number(streaming.get("keepalive-seconds"), DEFAULT_STREAM_KEEPALIVE_SECONDS as f64) as i64),
      "streamBootstrapRetries": clamp_non_negative_integer(read_number(streaming.get("bootstrap-retries"), DEFAULT_STREAM_BOOTSTRAP_RETRIES as f64) as i64),
      "nonStreamKeepaliveIntervalSeconds": clamp_non_negative_integer(read_number(config.get("nonstream-keepalive-interval"), DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS as f64) as i64),
      "thinkingBudgetMode": thinking_mode,
      "thinkingBudgetCustom": thinking_custom,
      "reasoningEffort": extract_reasoning_effort(config, gui_state),
      "autoSyncOnStop": gui_state.auto_sync_on_stop,
      "launchAtLogin": gui_state.launch_at_login,
      "autoStartProxyOnLaunch": gui_state.auto_start_proxy_on_launch,
      "minimizeToTrayOnClose": gui_state.minimize_to_tray_on_close,
      "apiBaseUrl": build_api_base_url(port),
      "managementBaseUrl": build_management_base_url(port),
    })
}

fn extract_thinking_budget(config: &Value) -> (String, i64) {
    let desktop = get_desktop_metadata(config);
    let thinking_budget = object(desktop.get("thinking-budget"));
    let fallback_mode = read_string(thinking_budget.get("mode"), "medium");
    let fallback_custom = read_number(
        thinking_budget.get("custom-budget"),
        DEFAULT_THINKING_CUSTOM as f64,
    ) as i64;
    let payload = object(config.get("payload"));
    let payload_defaults = array(payload.get("default"));
    for entry in payload_defaults {
        if is_managed_thinking_entry(&entry) {
            let params = object(entry.get("params"));
            let tokens = read_number(
                params.get("thinking.budget_tokens"),
                resolve_thinking_budget_tokens(&fallback_mode, fallback_custom) as f64,
            ) as i64;
            return (
                thinking_mode_from_tokens(tokens, &fallback_mode),
                if thinking_mode_from_tokens(tokens, &fallback_mode) == "custom" {
                    tokens
                } else {
                    fallback_custom
                },
            );
        }
    }
    (fallback_mode, fallback_custom)
}

fn resolve_thinking_budget_tokens(mode: &str, custom_budget: i64) -> i64 {
    match mode {
        "low" => 2048,
        "medium" => 8192,
        "high" => 32768,
        _ => std::cmp::max(1024, custom_budget.max(DEFAULT_THINKING_CUSTOM as i64)),
    }
}

fn thinking_mode_from_tokens(token_budget: i64, _fallback_mode: &str) -> String {
    match token_budget {
        2048 => "low".to_string(),
        8192 => "medium".to_string(),
        32768 => "high".to_string(),
        _ => "custom".to_string(),
    }
}

fn is_managed_thinking_entry(entry: &Value) -> bool {
    let params = object(entry.get("params"));
    if !params.contains_key("thinking.budget_tokens") {
        return false;
    }
    let models = array(entry.get("models"));
    let managed = SONNET_THINKING_MODELS
        .iter()
        .chain(OPUS_THINKING_MODELS.iter())
        .copied()
        .collect::<HashSet<_>>();
    let names = models
        .iter()
        .filter_map(|model| normalized_string(model.get("name")))
        .collect::<Vec<_>>();
    !names.is_empty() && names.iter().all(|name| managed.contains(name.as_str()))
}

fn extract_reasoning_effort(config: &Value, gui_state: &GuiState) -> String {
    let payload = object(config.get("payload"));
    let defaults = array(payload.get("default"));
    for entry in defaults {
        let params = object(entry.get("params"));
        if read_string(params.get("_managedBy"), "") == MANAGED_REASONING_EFFORT_MARKER {
            let effort = read_string(params.get("reasoning.effort"), "");
            if ["none", "minimal", "low", "medium", "high", "xhigh"].contains(&effort.as_str()) {
                return effort;
            }
        }
    }
    let fallback = gui_state.reasoning_effort.to_lowercase();
    if ["none", "minimal", "low", "medium", "high", "xhigh"].contains(&fallback.as_str()) {
        fallback
    } else {
        "xhigh".to_string()
    }
}

fn apply_known_settings(backend: &Backend, config: &mut Value, input: &Value) -> Result<()> {
    ensure_required_config_fields(config, &backend.inner.paths);
    {
        let root = root_object_mut(config)?;
        let desktop = ensure_object_mut(root, DESKTOP_METADATA_KEY);
        desktop.insert(
            "use-system-proxy".to_string(),
            Value::Bool(read_bool(input.get("useSystemProxy"), false)),
        );
        desktop.insert(
            "proxy-username".to_string(),
            Value::String(read_string(input.get("proxyUsername"), "")),
        );
        desktop.insert(
            "proxy-password".to_string(),
            Value::String(read_string(input.get("proxyPassword"), "")),
        );
        desktop.insert(
            "manual-proxy-url".to_string(),
            Value::String(read_string(input.get("proxyUrl"), "")),
        );
    }
    let effective_proxy_url = resolve_effective_proxy_url(config);
    let root = root_object_mut(config)?;
    root.insert(
        "port".to_string(),
        Value::Number(Number::from(clamp_port(
            read_number(input.get("port"), DEFAULT_PORT as f64) as u16,
        ))),
    );
    root.insert(
        "api-keys".to_string(),
        Value::Array(vec![Value::String(
            normalized_string(input.get("proxyApiKey"))
                .unwrap_or_else(|| DEFAULT_PROXY_API_KEY.to_string()),
        )]),
    );
    let remote_management = ensure_object_mut(root, "remote-management");
    remote_management.insert(
        "allow-remote".to_string(),
        Value::Bool(read_bool(remote_management.get("allow-remote"), true)),
    );
    remote_management.insert(
        "disable-control-panel".to_string(),
        Value::Bool(read_bool(
            remote_management.get("disable-control-panel"),
            false,
        )),
    );
    remote_management.insert(
        "secret-key".to_string(),
        Value::String(
            normalized_string(input.get("managementApiKey"))
                .unwrap_or_else(|| DEFAULT_MANAGEMENT_API_KEY.to_string()),
        ),
    );

    let manual_proxy_url = normalized_string(input.get("proxyUrl"));
    if let Some(proxy_url) = manual_proxy_url {
        root.insert("proxy-url".to_string(), Value::String(proxy_url));
    } else {
        root.remove("proxy-url");
    }

    if let Some(proxy_url) = effective_proxy_url {
        root.insert("proxy-url".to_string(), Value::String(proxy_url));
    }

    root.insert(
        "request-retry".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            input.get("requestRetry"),
            DEFAULT_REQUEST_RETRY as f64,
        ) as i64))),
    );
    root.insert(
        "max-retry-interval".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            input.get("maxRetryInterval"),
            DEFAULT_MAX_RETRY_INTERVAL as f64,
        ) as i64))),
    );
    root.insert(
        "nonstream-keepalive-interval".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            input.get("nonStreamKeepaliveIntervalSeconds"),
            DEFAULT_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS as f64,
        ) as i64))),
    );

    let streaming = ensure_object_mut(root, "streaming");
    streaming.insert(
        "keepalive-seconds".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            input.get("streamKeepaliveSeconds"),
            DEFAULT_STREAM_KEEPALIVE_SECONDS as f64,
        ) as i64))),
    );
    streaming.insert(
        "bootstrap-retries".to_string(),
        Value::Number(Number::from(clamp_non_negative_integer(read_number(
            input.get("streamBootstrapRetries"),
            DEFAULT_STREAM_BOOTSTRAP_RETRIES as f64,
        ) as i64))),
    );

    apply_thinking_budget(
        config,
        &read_string(input.get("thinkingBudgetMode"), "medium"),
        read_number(
            input.get("thinkingBudgetCustom"),
            DEFAULT_THINKING_CUSTOM as f64,
        ) as i64,
    );
    apply_reasoning_effort(config, &read_string(input.get("reasoningEffort"), "xhigh"));
    Ok(())
}

fn apply_thinking_budget(config: &mut Value, mode: &str, custom_budget: i64) {
    let token_budget = resolve_thinking_budget_tokens(mode, custom_budget);
    let payload = ensure_object_mut(root_object_mut(config).unwrap(), "payload");
    let defaults = array(payload.get("default"))
        .into_iter()
        .filter(|entry| !is_managed_thinking_entry(entry))
        .collect::<Vec<_>>();
    payload.insert(
        "default".to_string(),
        Value::Array(
            vec![
                build_managed_thinking_entry(SONNET_THINKING_MODELS, token_budget as u32),
                build_managed_thinking_entry(OPUS_THINKING_MODELS, token_budget as u32),
            ]
            .into_iter()
            .chain(defaults)
            .collect(),
        ),
    );
    let desktop = ensure_object_mut(root_object_mut(config).unwrap(), DESKTOP_METADATA_KEY);
    desktop.insert(
        "thinking-budget".to_string(),
        json!({
          "mode": mode,
          "custom-budget": std::cmp::max(1024, custom_budget.max(DEFAULT_THINKING_CUSTOM as i64)),
        }),
    );
}

fn apply_reasoning_effort(config: &mut Value, reasoning_effort: &str) {
    let payload = ensure_object_mut(root_object_mut(config).unwrap(), "payload");
    let defaults = array(payload.get("default"))
        .into_iter()
        .filter(|entry| {
            let params = object(entry.get("params"));
            read_string(params.get("_managedBy"), "") != MANAGED_REASONING_EFFORT_MARKER
        })
        .collect::<Vec<_>>();
    let normalized = reasoning_effort.trim().to_lowercase();
    payload.insert(
        "default".to_string(),
        Value::Array(if normalized == "none" {
            defaults
        } else {
            std::iter::once(build_managed_reasoning_effort_entry(&normalized))
                .chain(defaults)
                .collect()
        }),
    );
}

fn read_providers(config: &Value) -> Value {
    Value::Array(
        array(config.get("openai-compatibility"))
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let api_key_entries = array(entry.get("api-key-entries"));
                let first_api_key = api_key_entries
                    .first()
                    .and_then(|value| normalized_string(value.get("api-key")))
                    .unwrap_or_default();
                json!({
                  "index": index,
                  "name": read_string(entry.get("name"), &format!("provider-{}", index + 1)),
                  "baseUrl": read_string(entry.get("base-url"), ""),
                  "apiKey": first_api_key,
                  "models": normalize_provider_models(entry.get("models")),
                })
            })
            .collect(),
    )
}

fn empty_ai_providers() -> Value {
    json!({
      "gemini": [],
      "codex": [],
      "claude": [],
      "vertex": [],
      "openaiCompatibility": [],
      "ampcode": Value::Null,
    })
}

fn read_ai_providers(config: &Value) -> Value {
    json!({
      "gemini": read_provider_key_section(config, "gemini-api-key", false),
      "codex": read_provider_key_section(config, "codex-api-key", true),
      "claude": read_provider_key_section(config, "claude-api-key", true),
      "vertex": read_provider_key_section(config, "vertex-api-key", true),
      "openaiCompatibility": read_openai_compatibility_providers(config),
      "ampcode": read_ampcode_config(config),
    })
}

fn read_provider_key_section(config: &Value, section_name: &str, websockets: bool) -> Value {
    Value::Array(
    array(config.get(section_name))
      .iter()
      .enumerate()
      .map(|(index, entry)| {
        json!({
          "index": index,
          "apiKey": read_string(entry.get("api-key"), ""),
          "priority": normalized_number(entry.get("priority")),
          "prefix": read_string(entry.get("prefix"), ""),
          "baseUrl": read_string(entry.get("base-url"), ""),
          "proxyUrl": read_string(entry.get("proxy-url"), ""),
          "headers": read_header_entries(entry.get("headers")),
          "models": normalize_provider_models(entry.get("models")),
          "excludedModels": read_string_array(entry.get("excluded-models")),
          "websockets": if websockets { normalized_bool(entry.get("websockets")).map(Value::Bool).unwrap_or(Value::Null) } else { Value::Null },
        })
      })
      .collect(),
  )
}

fn read_openai_compatibility_providers(config: &Value) -> Value {
    Value::Array(
        array(config.get("openai-compatibility"))
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                json!({
                  "index": index,
                  "name": read_string(entry.get("name"), &format!("provider-{}", index + 1)),
                  "prefix": read_string(entry.get("prefix"), ""),
                  "baseUrl": read_string(entry.get("base-url"), ""),
                  "headers": read_header_entries(entry.get("headers")),
                  "models": normalize_provider_models(entry.get("models")),
                  "apiKeyEntries": read_provider_api_key_entries(entry.get("api-key-entries")),
                  "priority": normalized_number(entry.get("priority")),
                  "testModel": read_string(entry.get("test-model"), ""),
                })
            })
            .collect(),
    )
}

fn read_ampcode_config(config: &Value) -> Value {
    let ampcode = object(config.get("ampcode"));
    if ampcode.is_empty() {
        Value::Null
    } else {
        json!({
          "upstreamUrl": read_string(ampcode.get("upstream-url"), ""),
          "upstreamApiKey": read_string(ampcode.get("upstream-api-key"), ""),
          "upstreamApiKeys": array(ampcode.get("upstream-api-keys")).iter().filter_map(|entry| {
            let upstream_api_key = normalized_string(entry.get("upstream-api-key"))?;
            let api_keys = read_string_array(entry.get("api-keys"));
            if api_keys.is_empty() {
              return None;
            }
            Some(json!({
              "upstreamApiKey": upstream_api_key,
              "apiKeys": api_keys,
            }))
          }).collect::<Vec<_>>(),
          "modelMappings": array(ampcode.get("model-mappings")).iter().filter_map(|entry| {
            let from = normalized_string(entry.get("from"))?;
            let to = normalized_string(entry.get("to"))?;
            Some(json!({ "from": from, "to": to }))
          }).collect::<Vec<_>>(),
          "forceModelMappings": read_bool(ampcode.get("force-model-mappings"), false),
        })
    }
}

fn apply_provider(config: &mut Value, input: &Value) -> Result<()> {
    let root = root_object_mut(config)?;
    let providers = ensure_array_mut(root, "openai-compatibility");
    let index = normalized_number(input.get("index")).map(|value| value as usize);
    let models = normalize_provider_models(input.get("models"));
    let entry = json!({
      "name": normalized_string(input.get("name")).ok_or_else(|| anyhow!("提供商名称不能为空。"))?,
      "base-url": normalized_string(input.get("baseUrl")).ok_or_else(|| anyhow!("Base URL 不能为空。"))?,
      "schema-cleaner": true,
      "api-key-entries": [
        {
          "api-key": normalized_string(input.get("apiKey")).ok_or_else(|| anyhow!("API Key 不能为空。"))?,
        }
      ],
      "models": models,
    });
    if let Some(index) = index {
        if index < providers.len() {
            providers[index] = entry;
        } else {
            providers.push(entry);
        }
    } else {
        providers.push(entry);
    }
    Ok(())
}

fn delete_provider_at_index(config: &mut Value, index: usize) -> Result<()> {
    let root = root_object_mut(config)?;
    let providers = ensure_array_mut(root, "openai-compatibility");
    if index >= providers.len() {
        return Err(anyhow!("提供商索引不存在。"));
    }
    providers.remove(index);
    Ok(())
}

fn apply_ai_provider(config: &mut Value, input: &Value) -> Result<()> {
    let kind = read_string(input.get("kind"), "");
    if kind.is_empty() {
        return Err(anyhow!("缺少 kind。"));
    }
    if kind == "ampcode" {
        let ampcode = object(input.get("config"));
        let root = root_object_mut(config)?;
        root.insert(
            "ampcode".to_string(),
            json!({
              "upstream-url": normalized_string(ampcode.get("upstreamUrl")),
              "upstream-api-key": normalized_string(ampcode.get("upstreamApiKey")),
              "upstream-api-keys": array(ampcode.get("upstreamApiKeys")).iter().filter_map(|entry| {
                let upstream_api_key = normalized_string(entry.get("upstreamApiKey"))?;
                let api_keys = read_string_array(entry.get("apiKeys"));
                if api_keys.is_empty() {
                  return None;
                }
                Some(json!({
                  "upstream-api-key": upstream_api_key,
                  "api-keys": api_keys,
                }))
              }).collect::<Vec<_>>(),
              "model-mappings": array(ampcode.get("modelMappings")).iter().filter_map(|entry| {
                let from = normalized_string(entry.get("from"))?;
                let to = normalized_string(entry.get("to"))?;
                Some(json!({ "from": from, "to": to }))
              }).collect::<Vec<_>>(),
              "force-model-mappings": read_bool(ampcode.get("forceModelMappings"), false),
            }),
        );
        return Ok(());
    }

    if kind == "openai-compatibility" {
        let root = root_object_mut(config)?;
        let entries = ensure_array_mut(root, "openai-compatibility");
        let index = normalized_number(input.get("index")).map(|value| value as usize);
        let api_key_entries = build_provider_api_key_entries(input.get("apiKeyEntries"));
        if api_key_entries.is_empty() {
            return Err(anyhow!("OpenAI 兼容提供商至少需要一个 API Key。"));
        }
        let entry = json!({
          "name": normalized_string(input.get("name")).ok_or_else(|| anyhow!("OpenAI 兼容提供商需要名称。"))?,
          "base-url": normalized_string(input.get("baseUrl")).ok_or_else(|| anyhow!("OpenAI 兼容提供商需要 Base URL。"))?,
          "schema-cleaner": true,
          "prefix": normalized_string(input.get("prefix")),
          "headers": build_headers_object(input.get("headers")),
          "models": normalize_provider_models(input.get("models")),
          "api-key-entries": api_key_entries,
          "priority": normalized_number(input.get("priority")),
          "test-model": normalized_string(input.get("testModel")),
        });
        upsert_section_entry(entries, index, entry);
        return Ok(());
    }

    let section_name = match kind.as_str() {
        "gemini" => "gemini-api-key",
        "codex" => "codex-api-key",
        "claude" => "claude-api-key",
        "vertex" => "vertex-api-key",
        _ => return Err(anyhow!("未知 AI provider kind: {kind}")),
    };
    let root = root_object_mut(config)?;
    let entries = ensure_array_mut(root, section_name);
    let index = normalized_number(input.get("index")).map(|value| value as usize);
    let api_key =
        normalized_string(input.get("apiKey")).ok_or_else(|| anyhow!("API Key 不能为空。"))?;
    let mut entry = json!({
      "api-key": api_key,
      "priority": normalized_number(input.get("priority")),
      "prefix": normalized_string(input.get("prefix")),
      "base-url": normalized_string(input.get("baseUrl")),
      "proxy-url": normalized_string(input.get("proxyUrl")),
      "headers": build_headers_object(input.get("headers")),
      "models": normalize_provider_models(input.get("models")),
      "excluded-models": read_string_array(input.get("excludedModels")),
    });
    if kind != "gemini" && read_bool(input.get("websockets"), false) {
        entry["websockets"] = Value::Bool(true);
    }
    upsert_section_entry(entries, index, entry);
    Ok(())
}

fn delete_ai_provider(config: &mut Value, input: &Value) -> Result<()> {
    let kind = read_string(input.get("kind"), "");
    if kind == "ampcode" {
        root_object_mut(config)?.remove("ampcode");
        return Ok(());
    }
    let index = normalized_number(input.get("index"))
        .map(|value| value as usize)
        .ok_or_else(|| anyhow!("缺少要删除的配置索引。"))?;
    let section_name = match kind.as_str() {
        "gemini" => "gemini-api-key",
        "codex" => "codex-api-key",
        "claude" => "claude-api-key",
        "vertex" => "vertex-api-key",
        "openai-compatibility" => "openai-compatibility",
        _ => return Err(anyhow!("未知 AI provider kind: {kind}")),
    };
    let root = root_object_mut(config)?;
    let entries = ensure_array_mut(root, section_name);
    if index >= entries.len() {
        return Err(anyhow!("配置索引不存在。"));
    }
    entries.remove(index);
    if entries.is_empty() {
        root.remove(section_name);
    }
    Ok(())
}

fn upsert_section_entry(entries: &mut Vec<Value>, index: Option<usize>, entry: Value) {
    if let Some(index) = index {
        if index < entries.len() {
            entries[index] = entry;
            return;
        }
    }
    entries.push(entry);
}

fn parse_provider_models_payload(payload: &Value) -> Vec<String> {
    let data = if let Some(array) = payload.get("data").and_then(Value::as_array) {
        array.clone()
    } else {
        payload.as_array().cloned().unwrap_or_default()
    };
    let mut models = HashSet::new();
    for entry in data {
        if let Some(model) = normalized_string(Some(&entry)) {
            models.insert(model);
            continue;
        }
        if let Some(id) = normalized_string(entry.get("id")) {
            models.insert(id);
        }
        if let Some(model) = normalized_string(entry.get("model")) {
            models.insert(model);
        }
        if let Some(name) = normalized_string(entry.get("name")) {
            models.insert(name);
        }
    }
    let mut models = models.into_iter().collect::<Vec<_>>();
    models.sort();
    models
}

fn normalize_provider_models_url(base_url: String) -> Result<String> {
    let normalized = base_url.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return Err(anyhow!("请先填写 Base URL。"));
    }
    Ok(if normalized.to_lowercase().ends_with("/models") {
        normalized
    } else {
        format!("{normalized}/models")
    })
}

fn build_local_auth_file_details(
    payload: Option<&Value>,
    provider: &str,
    file_type: &str,
) -> (Vec<Value>, Option<String>) {
    let Some(payload) = payload else {
        return (Vec::new(), None);
    };
    let metadata = object(payload.get("metadata"));
    let attributes = object(payload.get("attributes"));
    let account = object(payload.get("account"));
    let user = object(payload.get("user"));
    let organization = object(payload.get("organization"));
    let installed = object(payload.get("installed"));
    let web = object(payload.get("web"));
    let email = normalized_string(payload.get("email"))
        .or_else(|| normalized_string(account.get("email")))
        .or_else(|| normalized_string(user.get("email")))
        .or_else(|| normalized_string(installed.get("client_email")))
        .or_else(|| normalized_string(payload.get("client_email")));
    let account_name = normalized_string(payload.get("account"))
        .or_else(|| normalized_string(payload.get("username")))
        .or_else(|| normalized_string(payload.get("name")))
        .or_else(|| normalized_string(account.get("name")))
        .or_else(|| normalized_string(account.get("display_name")))
        .or_else(|| normalized_string(user.get("name")))
        .or_else(|| normalized_string(user.get("display_name")));
    let organization_name = normalized_string(organization.get("name"))
        .or_else(|| normalized_string(payload.get("organization_name")));
    let plan_type = resolve_codex_plan_type_from_payload(payload)
        .or_else(|| normalized_string(payload.get("plan_type")))
        .map(|value| value.to_lowercase());
    let chatgpt_account_id = resolve_codex_chatgpt_account_id_from_payload(payload);
    let gemini_project_id = resolve_gemini_cli_project_id_from_payload(payload);
    let antigravity_project_id = resolve_antigravity_project_id_from_payload(payload);

    let mut details = Vec::new();
    push_auth_file_detail(&mut details, "文件类型", Some(file_type.to_string()));
    push_auth_file_detail(&mut details, "邮箱", email);
    push_auth_file_detail(&mut details, "账户", account_name);
    push_auth_file_detail(&mut details, "组织", organization_name);
    push_auth_file_detail(&mut details, "套餐", plan_type.clone());
    if provider == "codex" || file_type == "codex" || provider == "openai" {
        push_auth_file_detail(&mut details, "ChatGPT 账户 ID", chatgpt_account_id);
    }
    if provider == "gemini" || file_type == "gemini-cli" {
        push_auth_file_detail(&mut details, "项目 ID", gemini_project_id);
    }
    if provider == "antigravity" || file_type == "antigravity" {
        push_auth_file_detail(&mut details, "项目 ID", antigravity_project_id);
    }
    push_auth_file_detail(
        &mut details,
        "标签",
        normalized_string(payload.get("label"))
            .or_else(|| normalized_string(metadata.get("label"))),
    );
    push_auth_file_detail(
        &mut details,
        "备注",
        normalized_string(payload.get("note"))
            .or_else(|| normalized_string(attributes.get("note"))),
    );
    push_auth_file_detail(
        &mut details,
        "优先级",
        normalized_string(payload.get("priority"))
            .or_else(|| normalized_string(attributes.get("priority"))),
    );
    push_auth_file_detail(
        &mut details,
        "服务账号",
        normalized_string(installed.get("client_email"))
            .or_else(|| normalized_string(web.get("client_email"))),
    );
    (details, plan_type)
}

fn push_auth_file_detail(target: &mut Vec<Value>, label: &str, value: Option<String>) {
    let Some(value) = value else { return };
    if value.trim().is_empty() {
        return;
    }
    if target.iter().any(|item| {
        read_string(item.get("label"), "") == label && read_string(item.get("value"), "") == value
    }) {
        return;
    }
    target.push(json!({ "label": label, "value": value }));
}

fn merge_auth_file_detail_items(groups: &[Vec<Value>]) -> Vec<Value> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();

    for group in groups {
        for item in group {
            let label = read_string(item.get("label"), "").trim().to_string();
            let value = read_string(item.get("value"), "").trim().to_string();

            if label.is_empty() || value.is_empty() {
                continue;
            }

            let key = format!("{label}\u{0000}{value}");
            if seen.insert(key) {
                merged.push(json!({ "label": label, "value": value }));
            }
        }
    }

    merged
}

fn build_remote_auth_file_details(
    entry: &Value,
    provider: &str,
    file_type: &str,
) -> (Vec<Value>, Option<String>) {
    let base = build_local_auth_file_details(Some(entry), provider, file_type);
    let mut details = base.0.clone();

    push_auth_file_detail(
        &mut details,
        "认证索引",
        normalize_auth_index(entry.get("auth_index").or_else(|| entry.get("authIndex"))),
    );
    push_auth_file_detail(&mut details, "标签", normalized_string(entry.get("label")));
    push_auth_file_detail(&mut details, "来源", normalized_string(entry.get("source")));
    push_auth_file_detail(&mut details, "状态", normalized_string(entry.get("status")));
    push_auth_file_detail(
        &mut details,
        "状态说明",
        normalized_string(
            entry
                .get("status_message")
                .or_else(|| entry.get("statusMessage")),
        ),
    );
    push_auth_file_detail(
        &mut details,
        "创建时间",
        normalized_string(entry.get("created_at").or_else(|| entry.get("createdAt"))),
    );
    push_auth_file_detail(
        &mut details,
        "更新时间",
        normalized_string(
            entry
                .get("updated_at")
                .or_else(|| entry.get("updatedAt"))
                .or_else(|| entry.get("modtime")),
        ),
    );

    (details, base.1)
}

fn merge_remote_auth_file_record(
    local_record: Value,
    remote_entry: Option<Value>,
    usage_stats_by_auth_index: &HashMap<String, AuthFileUsageStats>,
) -> Value {
    let Some(remote_entry) = remote_entry else {
        return local_record;
    };
    let provider = normalized_string(remote_entry.get("provider"))
        .unwrap_or_else(|| read_string(local_record.get("provider"), "unknown"));
    let file_type = normalized_string(remote_entry.get("type"))
        .unwrap_or_else(|| read_string(local_record.get("type"), &provider));
    let auth_index = normalize_auth_index(
        remote_entry
            .get("auth_index")
            .or_else(|| remote_entry.get("authIndex")),
    );
    let usage = auth_index
        .as_ref()
        .and_then(|value| usage_stats_by_auth_index.get(value))
        .cloned()
        .unwrap_or_default();
    let remote_details = build_remote_auth_file_details(&remote_entry, &provider, &file_type);
    let local_details = array(local_record.get("detailItems"));
    let mut next = local_record;
    next["provider"] = Value::String(provider.clone());
    next["type"] = Value::String(file_type.clone());
    next["authIndex"] = auth_index.clone().map(Value::String).unwrap_or(Value::Null);
    next["label"] = normalized_string(remote_entry.get("label"))
        .map(Value::String)
        .unwrap_or_else(|| next.get("label").cloned().unwrap_or(Value::Null));
    next["source"] = normalized_string(remote_entry.get("source"))
        .map(Value::String)
        .unwrap_or_else(|| next.get("source").cloned().unwrap_or(Value::Null));
    next["enabled"] = Value::Bool(!is_remote_auth_file_disabled(&remote_entry));
    next["status"] = normalized_string(remote_entry.get("status"))
        .map(Value::String)
        .unwrap_or_else(|| next.get("status").cloned().unwrap_or(Value::Null));
    next["statusMessage"] = normalized_string(
        remote_entry
            .get("status_message")
            .or_else(|| remote_entry.get("statusMessage")),
    )
    .map(Value::String)
    .unwrap_or_else(|| next.get("statusMessage").cloned().unwrap_or(Value::Null));
    next["runtimeOnly"] = Value::Bool(read_bool(
        remote_entry
            .get("runtime_only")
            .or_else(|| remote_entry.get("runtimeOnly")),
        false,
    ));
    next["unavailable"] = Value::Bool(read_bool(remote_entry.get("unavailable"), false));
    next["createdAt"] = normalized_string(
        remote_entry
            .get("created_at")
            .or_else(|| remote_entry.get("createdAt")),
    )
    .map(Value::String)
    .unwrap_or(Value::Null);
    next["updatedAt"] = normalized_string(
        remote_entry
            .get("updated_at")
            .or_else(|| remote_entry.get("updatedAt"))
            .or_else(|| remote_entry.get("modtime")),
    )
    .map(Value::String)
    .unwrap_or(Value::Null);
    next["successCount"] = Value::Number(Number::from(usage.success_count));
    next["failureCount"] = Value::Number(Number::from(usage.failure_count));
    next["totalRequests"] = Value::Number(Number::from(usage.total_requests));
    next["lastUsedAt"] = usage.last_used_at.map(Value::String).unwrap_or(Value::Null);
    next["planType"] = remote_details
        .1
        .map(Value::String)
        .unwrap_or_else(|| next.get("planType").cloned().unwrap_or(Value::Null));
    next["detailItems"] = Value::Array(merge_auth_file_detail_items(&[
        local_details,
        remote_details.0,
    ]));
    next
}

#[derive(Debug, Clone, Default)]
struct AuthFileUsageStats {
    total_requests: i64,
    success_count: i64,
    failure_count: i64,
    last_used_at: Option<String>,
}

fn extract_remote_auth_file_entries(payload: &Value) -> Vec<Value> {
    if let Some(array) = payload.as_array() {
        return array.clone();
    }
    for key in ["files", "auth_files", "authFiles"] {
        if let Some(array) = payload.get(key).and_then(Value::as_array) {
            return array.clone();
        }
    }
    Vec::new()
}

fn index_remote_auth_files_by_name(entries: &[Value]) -> HashMap<String, Value> {
    let mut indexed = HashMap::new();
    for entry in entries {
        for candidate in [
            normalize_remote_auth_file_base_name(entry.get("name")),
            normalize_remote_auth_file_base_name(entry.get("id")),
            normalize_remote_auth_file_base_name(entry.get("path")),
        ]
        .into_iter()
        .flatten()
        {
            indexed.insert(candidate.to_lowercase(), entry.clone());
        }
    }
    indexed
}

fn collect_usage_stats_by_auth_index(payload: &Value) -> HashMap<String, AuthFileUsageStats> {
    let mut result = HashMap::new();
    let root = payload.get("usage").unwrap_or(payload);
    let apis = object(root.get("apis"));
    for (_, api_entry) in apis {
        let models = object(api_entry.get("models"));
        for (_, model_entry) in models {
            for detail in array(model_entry.get("details")) {
                let Some(auth_index) = normalize_auth_index(
                    detail.get("auth_index").or_else(|| detail.get("authIndex")),
                ) else {
                    continue;
                };
                let stats = result
                    .entry(auth_index)
                    .or_insert_with(AuthFileUsageStats::default);
                let failed = read_bool(detail.get("failed"), false);
                stats.total_requests += 1;
                stats.success_count += if failed { 0 } else { 1 };
                stats.failure_count += if failed { 1 } else { 0 };
                let timestamp = normalized_string(detail.get("timestamp"));
                if newer_iso(timestamp.clone(), stats.last_used_at.clone()) {
                    stats.last_used_at = timestamp;
                }
            }
        }
    }
    result
}

fn empty_usage_summary(error: Option<String>, query: Option<&Value>) -> Value {
    let resolved = resolve_usage_summary_query(query);
    json!({
      "available": false,
      "rangePreset": resolved.0,
      "rangeLabel": resolved.1,
      "rangeStartAt": resolved.2,
      "rangeEndAt": resolved.3,
      "rangeGranularity": resolved.4,
      "usedDetailRange": false,
      "totalRequests": 0,
      "successCount": 0,
      "failureCount": 0,
      "totalTokens": 0,
      "netTokens": 0,
      "billableInputTokens": 0,
      "inputTokens": 0,
      "outputTokens": 0,
      "cachedTokens": 0,
      "reasoningTokens": 0,
      "requestsByDay": [],
      "tokensByDay": [],
      "topModels": [],
      "lastUpdatedAt": Value::Null,
      "error": error,
    })
}

fn build_usage_summary(payload: &Value, query: Option<&Value>) -> Value {
    let resolved = resolve_usage_summary_query(query);
    let root = if payload.get("usage").map(Value::is_object).unwrap_or(false) {
        payload.get("usage").unwrap_or(payload)
    } else {
        payload
    };
    let apis = object(root.get("apis"));

    let mut model_map = BTreeMap::<String, UsageModelSummary>::new();
    let mut requests = BTreeMap::<String, i64>::new();
    let mut tokens = BTreeMap::<String, i64>::new();
    let mut total_requests = 0i64;
    let mut success_count = 0i64;
    let mut failure_count = 0i64;
    let mut total_tokens = 0i64;
    let mut net_tokens = 0i64;
    let mut billable_input_tokens = 0i64;
    let mut input_tokens = 0i64;
    let mut output_tokens = 0i64;
    let mut cached_tokens = 0i64;
    let mut cache_creation_tokens = 0i64;
    let mut reasoning_tokens = 0i64;

    for (_, api_entry) in apis {
        let models = object(api_entry.get("models"));
        for (model_name, model_entry) in models {
            let details = array(model_entry.get("details"));
            if !details.is_empty() {
                for detail in details {
                    let timestamp = normalized_string(detail.get("timestamp"));
                    let timestamp_ms = parse_usage_timestamp(timestamp.clone());
                    if !is_usage_timestamp_within_range(timestamp_ms, &resolved) {
                        continue;
                    }
                    let tokens_obj = object(detail.get("tokens"));
                    let input = first_finite_number(&[
                        detail.get("input_tokens"),
                        tokens_obj.get("input_tokens"),
                        tokens_obj.get("prompt_tokens"),
                    ])
                    .unwrap_or(0.0) as i64;
                    let output = first_finite_number(&[
                        detail.get("output_tokens"),
                        tokens_obj.get("output_tokens"),
                        tokens_obj.get("completion_tokens"),
                    ])
                    .unwrap_or(0.0) as i64;
                    let cached = first_finite_number(&[
                        detail.get("cached_tokens"),
                        tokens_obj.get("cached_tokens"),
                        tokens_obj.get("cache_tokens"),
                        tokens_obj
                            .get("input_tokens_details")
                            .and_then(|value| value.get("cached_tokens")),
                    ])
                    .unwrap_or(0.0) as i64;
                    let cache_creation = first_finite_number(&[
                        detail.get("cache_creation_tokens"),
                        detail.get("cache_creation_input_tokens"),
                        tokens_obj.get("cache_creation_tokens"),
                        tokens_obj.get("cache_creation_input_tokens"),
                        tokens_obj
                            .get("input_tokens_details")
                            .and_then(|value| value.get("cache_creation_tokens")),
                        tokens_obj
                            .get("input_tokens_details")
                            .and_then(|value| value.get("cache_creation_input_tokens")),
                    ])
                    .unwrap_or(0.0) as i64;
                    let reasoning = first_finite_number(&[
                        detail.get("reasoning_tokens"),
                        tokens_obj.get("reasoning_tokens"),
                        tokens_obj
                            .get("output_tokens_details")
                            .and_then(|value| value.get("reasoning_tokens")),
                    ])
                    .unwrap_or(0.0) as i64;
                    let total = first_finite_number(&[
                        detail.get("total_tokens"),
                        tokens_obj.get("total_tokens"),
                    ])
                    .unwrap_or((input + output) as f64) as i64;
                    let failed = read_bool(detail.get("failed"), false);
                    let billable = (input - cached).max(0);
                    let net = (total - cached).max(0);
                    let model = model_map
                        .entry(model_name.clone())
                        .or_insert_with(|| UsageModelSummary::new(&model_name));
                    model.requests += 1;
                    model.success_count += if failed { 0 } else { 1 };
                    model.failure_count += if failed { 1 } else { 0 };
                    model.total_tokens += total;
                    model.net_tokens += net;
                    model.billable_input_tokens += billable;
                    model.input_tokens += input;
                    model.output_tokens += output;
                    model.cached_tokens += cached;
                    model.cache_creation_tokens += cache_creation;
                    model.reasoning_tokens += reasoning;

                    total_requests += 1;
                    success_count += if failed { 0 } else { 1 };
                    failure_count += if failed { 1 } else { 0 };
                    total_tokens += total;
                    net_tokens += net;
                    billable_input_tokens += billable;
                    input_tokens += input;
                    output_tokens += output;
                    cached_tokens += cached;
                    cache_creation_tokens += cache_creation;
                    reasoning_tokens += reasoning;
                    record_usage_bucket(&mut requests, timestamp_ms, &resolved.4, 1);
                    record_usage_bucket(&mut tokens, timestamp_ms, &resolved.4, net);
                }
            } else if !resolved.5 {
                let request_count = read_number(model_entry.get("total_requests"), 0.0) as i64;
                let success =
                    read_number(model_entry.get("success_count"), request_count as f64) as i64;
                let failure = read_number(model_entry.get("failure_count"), 0.0) as i64;
                let input = first_finite_number(&[
                    model_entry.get("input_tokens"),
                    model_entry.get("prompt_tokens"),
                ])
                .unwrap_or(0.0) as i64;
                let output = first_finite_number(&[
                    model_entry.get("output_tokens"),
                    model_entry.get("completion_tokens"),
                ])
                .unwrap_or(0.0) as i64;
                let cached = first_finite_number(&[
                    model_entry.get("cached_tokens"),
                    model_entry.get("cache_tokens"),
                    model_entry
                        .get("input_tokens_details")
                        .and_then(|value| value.get("cached_tokens")),
                ])
                .unwrap_or(0.0) as i64;
                let cache_creation = first_finite_number(&[
                    model_entry.get("cache_creation_tokens"),
                    model_entry.get("cache_creation_input_tokens"),
                    model_entry
                        .get("input_tokens_details")
                        .and_then(|value| value.get("cache_creation_tokens")),
                    model_entry
                        .get("input_tokens_details")
                        .and_then(|value| value.get("cache_creation_input_tokens")),
                ])
                .unwrap_or(0.0) as i64;
                let reasoning = first_finite_number(&[
                    model_entry.get("reasoning_tokens"),
                    model_entry
                        .get("output_tokens_details")
                        .and_then(|value| value.get("reasoning_tokens")),
                ])
                .unwrap_or(0.0) as i64;
                let total = first_finite_number(&[model_entry.get("total_tokens")])
                    .unwrap_or((input + output) as f64) as i64;
                let billable = (input - cached).max(0);
                let net = (total - cached).max(0);
                let model = model_map
                    .entry(model_name.clone())
                    .or_insert_with(|| UsageModelSummary::new(&model_name));
                model.requests += request_count;
                model.success_count += success;
                model.failure_count += failure;
                model.total_tokens += total;
                model.net_tokens += net;
                model.billable_input_tokens += billable;
                model.input_tokens += input;
                model.output_tokens += output;
                model.cached_tokens += cached;
                model.cache_creation_tokens += cache_creation;
                model.reasoning_tokens += reasoning;

                total_requests += request_count;
                success_count += success;
                failure_count += failure;
                total_tokens += total;
                net_tokens += net;
                billable_input_tokens += billable;
                input_tokens += input;
                output_tokens += output;
                cached_tokens += cached;
                cache_creation_tokens += cache_creation;
                reasoning_tokens += reasoning;
            }
        }
    }

    json!({
      "available": total_requests > 0 || total_tokens > 0 || !model_map.is_empty(),
      "rangePreset": resolved.0,
      "rangeLabel": resolved.1,
      "rangeStartAt": resolved.2,
      "rangeEndAt": resolved.3,
      "rangeGranularity": resolved.4,
      "usedDetailRange": !requests.is_empty() || !tokens.is_empty(),
      "totalRequests": total_requests,
      "successCount": success_count,
      "failureCount": failure_count,
      "totalTokens": total_tokens,
      "netTokens": net_tokens,
      "billableInputTokens": billable_input_tokens,
      "inputTokens": input_tokens,
      "outputTokens": output_tokens,
      "cachedTokens": cached_tokens,
      "cacheCreationTokens": cache_creation_tokens,
      "reasoningTokens": reasoning_tokens,
      "requestsByDay": usage_points_from_map(&requests),
      "tokensByDay": usage_points_from_map(&tokens),
      "topModels": model_map.into_values().collect::<Vec<_>>(),
      "lastUpdatedAt": now_iso(),
      "error": Value::Null,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageModelSummary {
    model: String,
    requests: i64,
    success_count: i64,
    failure_count: i64,
    total_tokens: i64,
    net_tokens: i64,
    billable_input_tokens: i64,
    input_tokens: i64,
    output_tokens: i64,
    cached_tokens: i64,
    cache_creation_tokens: i64,
    reasoning_tokens: i64,
}

impl UsageModelSummary {
    fn new(model: &str) -> Self {
        Self {
            model: model.to_string(),
            requests: 0,
            success_count: 0,
            failure_count: 0,
            total_tokens: 0,
            net_tokens: 0,
            billable_input_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
            cached_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_tokens: 0,
        }
    }
}

fn build_usage_summary_from_records(
    records: &[PersistedUsageRecord],
    query: Option<&Value>,
) -> Option<Value> {
    if records.is_empty() {
        return None;
    }
    let resolved = resolve_usage_summary_query(query);
    let mut model_map = BTreeMap::<String, UsageModelSummary>::new();
    let mut requests = BTreeMap::<String, i64>::new();
    let mut tokens = BTreeMap::<String, i64>::new();
    let mut total_requests = 0i64;
    let mut success_count = 0i64;
    let mut failure_count = 0i64;
    let mut total_tokens = 0i64;
    let mut net_tokens = 0i64;
    let mut billable_input_tokens = 0i64;
    let mut input_tokens = 0i64;
    let mut output_tokens = 0i64;
    let mut cached_tokens = 0i64;
    let mut cache_creation_tokens = 0i64;
    let mut reasoning_tokens = 0i64;
    for record in records {
        if !is_usage_timestamp_within_range(record.timestamp_ms, &resolved) {
            continue;
        }
        let model = model_map
            .entry(record.model.clone())
            .or_insert_with(|| UsageModelSummary::new(&record.model));
        let net = (record.total_tokens - record.cached_tokens).max(0);
        let billable = (record.input_tokens - record.cached_tokens).max(0);
        model.requests += 1;
        model.success_count += if record.failed { 0 } else { 1 };
        model.failure_count += if record.failed { 1 } else { 0 };
        model.total_tokens += record.total_tokens;
        model.net_tokens += net;
        model.billable_input_tokens += billable;
        model.input_tokens += record.input_tokens;
        model.output_tokens += record.output_tokens;
        model.cached_tokens += record.cached_tokens;
        model.cache_creation_tokens += record.cache_creation_tokens;
        model.reasoning_tokens += record.reasoning_tokens;

        total_requests += 1;
        success_count += if record.failed { 0 } else { 1 };
        failure_count += if record.failed { 1 } else { 0 };
        total_tokens += record.total_tokens;
        net_tokens += net;
        billable_input_tokens += billable;
        input_tokens += record.input_tokens;
        output_tokens += record.output_tokens;
        cached_tokens += record.cached_tokens;
        cache_creation_tokens += record.cache_creation_tokens;
        reasoning_tokens += record.reasoning_tokens;
        record_usage_bucket(&mut requests, record.timestamp_ms, &resolved.4, 1);
        record_usage_bucket(&mut tokens, record.timestamp_ms, &resolved.4, net);
    }
    if total_requests == 0 {
        return None;
    }
    Some(json!({
      "available": true,
      "rangePreset": resolved.0,
      "rangeLabel": resolved.1,
      "rangeStartAt": resolved.2,
      "rangeEndAt": resolved.3,
      "rangeGranularity": resolved.4,
      "usedDetailRange": true,
      "totalRequests": total_requests,
      "successCount": success_count,
      "failureCount": failure_count,
      "totalTokens": total_tokens,
      "netTokens": net_tokens,
      "billableInputTokens": billable_input_tokens,
      "inputTokens": input_tokens,
      "outputTokens": output_tokens,
      "cachedTokens": cached_tokens,
      "cacheCreationTokens": cache_creation_tokens,
      "reasoningTokens": reasoning_tokens,
      "requestsByDay": usage_points_from_map(&requests),
      "tokensByDay": usage_points_from_map(&tokens),
      "topModels": model_map.into_values().collect::<Vec<_>>(),
      "lastUpdatedAt": now_iso(),
      "error": Value::Null,
    }))
}

fn should_use_usage_log_fallback(summary: &Value) -> bool {
    !read_bool(summary.get("available"), false)
        || (read_number(summary.get("totalRequests"), 0.0) <= 0.0
            && read_number(summary.get("totalTokens"), 0.0) <= 0.0
            && array(summary.get("topModels")).is_empty())
}

fn resolve_usage_summary_query(
    query: Option<&Value>,
) -> (String, String, Option<String>, Option<String>, String, bool) {
    let preset = read_string(query.and_then(|value| value.get("preset")), "all");
    let now = Utc::now();
    match preset.as_str() {
        "24h" => (
            "24h".to_string(),
            "近 24 小时".to_string(),
            Some((now - chrono::Duration::hours(24)).to_rfc3339()),
            Some(now.to_rfc3339()),
            "hour".to_string(),
            true,
        ),
        "7d" => (
            "7d".to_string(),
            "近 7 天".to_string(),
            Some((now - chrono::Duration::days(7)).to_rfc3339()),
            Some(now.to_rfc3339()),
            "day".to_string(),
            true,
        ),
        "30d" => (
            "30d".to_string(),
            "近 30 天".to_string(),
            Some((now - chrono::Duration::days(30)).to_rfc3339()),
            Some(now.to_rfc3339()),
            "day".to_string(),
            true,
        ),
        "custom" => {
            let start = parse_usage_timestamp(normalized_string(
                query.and_then(|value| value.get("startAt")),
            ))
            .map(timestamp_ms_to_iso);
            let end = parse_usage_timestamp(normalized_string(
                query.and_then(|value| value.get("endAt")),
            ))
            .map(timestamp_ms_to_iso);
            let duration = start
                .as_ref()
                .zip(end.as_ref())
                .and_then(|(start, end)| {
                    parse_usage_timestamp(Some(start.clone()))
                        .zip(parse_usage_timestamp(Some(end.clone())))
                })
                .map(|(start, end)| end - start);
            (
                "custom".to_string(),
                "自定义时间段".to_string(),
                start,
                end,
                if duration.unwrap_or(i64::MAX) <= 48 * 60 * 60 * 1000 {
                    "hour".to_string()
                } else {
                    "day".to_string()
                },
                true,
            )
        }
        _ => (
            "all".to_string(),
            "全部时间".to_string(),
            None,
            None,
            "day".to_string(),
            false,
        ),
    }
}

fn is_usage_timestamp_within_range(
    timestamp_ms: Option<i64>,
    resolved: &(String, String, Option<String>, Option<String>, String, bool),
) -> bool {
    if !resolved.5 {
        return true;
    }
    let Some(timestamp_ms) = timestamp_ms else {
        return false;
    };
    if let Some(start) = resolved
        .2
        .as_ref()
        .and_then(|value| parse_usage_timestamp(Some(value.clone())))
    {
        if timestamp_ms < start {
            return false;
        }
    }
    if let Some(end) = resolved
        .3
        .as_ref()
        .and_then(|value| parse_usage_timestamp(Some(value.clone())))
    {
        if timestamp_ms > end {
            return false;
        }
    }
    true
}

fn record_usage_bucket(
    buckets: &mut BTreeMap<String, i64>,
    timestamp_ms: Option<i64>,
    granularity: &str,
    amount: i64,
) {
    let Some(timestamp_ms) = timestamp_ms else {
        return;
    };
    let label = format_usage_bucket_label(timestamp_ms, granularity);
    *buckets.entry(label).or_insert(0) += amount;
}

fn usage_points_from_map(map: &BTreeMap<String, i64>) -> Vec<Value> {
    map.iter()
        .map(|(label, value)| json!({ "label": label, "value": value }))
        .collect()
}

fn is_usage_log_file_name(file_name: &str) -> bool {
    file_name.starts_with("v1-responses-")
        || file_name.starts_with("v1-chat-completions-")
        || file_name.starts_with("v1-completions-")
}

fn build_usage_log_file_id(file_name: &str, size: u64, mtime_ms: u64) -> String {
    format!("{file_name}:{size}:{mtime_ms}")
}

fn parse_usage_log_record(
    file_name: &str,
    raw: &str,
    fallback_timestamp_ms: i64,
) -> Option<PersistedUsageRecord> {
    let timestamp = parse_usage_log_timestamp(raw, fallback_timestamp_ms);
    let request_payload = parse_usage_log_request_payload(raw);
    let response_body = extract_usage_log_response_body(raw)?;
    let mut usage_payload = None::<Value>;
    let mut model =
        normalized_string(request_payload.get("model")).unwrap_or_else(|| "unknown".to_string());
    let mut failed = false;

    if file_name.starts_with("v1-responses-") {
        let lines = response_body.lines().collect::<Vec<_>>();
        for (index, line) in lines.iter().enumerate() {
            if line.trim() != "event: response.completed" {
                continue;
            }
            let payload =
                parse_usage_log_json_line(lines.get(index + 1).copied().unwrap_or_default())?;
            let response = object(payload.get("response"));
            let usage = response.get("usage").cloned().unwrap_or(Value::Null);
            if usage.is_object() {
                usage_payload = Some(usage);
                model = normalized_string(response.get("model")).unwrap_or(model);
                failed = read_bool(response.get("failed"), false)
                    || response.get("error").map(Value::is_object).unwrap_or(false)
                    || read_string(response.get("status"), "").to_lowercase() == "failed";
            }
        }
    } else {
        if response_body.trim_start().starts_with('{') {
            if let Ok(payload) = serde_json::from_str::<Value>(response_body.trim()) {
                if payload.get("usage").map(Value::is_object).unwrap_or(false) {
                    usage_payload = payload.get("usage").cloned();
                    model = normalized_string(payload.get("model")).unwrap_or(model);
                    failed = payload.get("error").map(Value::is_object).unwrap_or(false);
                }
            }
        }
        if usage_payload.is_none() {
            for line in response_body.lines() {
                if let Some(payload) = parse_usage_log_json_line(line) {
                    if payload.get("usage").map(Value::is_object).unwrap_or(false) {
                        usage_payload = payload.get("usage").cloned();
                        model = normalized_string(payload.get("model")).unwrap_or(model);
                        failed =
                            failed || payload.get("error").map(Value::is_object).unwrap_or(false);
                    }
                }
            }
        }
    }

    let usage_payload = usage_payload?;
    let input = first_finite_number(&[
        usage_payload.get("input_tokens"),
        usage_payload.get("prompt_tokens"),
    ])
    .unwrap_or(0.0) as i64;
    let output = first_finite_number(&[
        usage_payload.get("output_tokens"),
        usage_payload.get("completion_tokens"),
    ])
    .unwrap_or(0.0) as i64;
    let cached = first_finite_number(&[
        usage_payload.get("cached_tokens"),
        usage_payload.get("cache_tokens"),
        usage_payload
            .get("input_tokens_details")
            .and_then(|value| value.get("cached_tokens")),
    ])
    .unwrap_or(0.0) as i64;
    let cache_creation = first_finite_number(&[
        usage_payload.get("cache_creation_tokens"),
        usage_payload.get("cache_creation_input_tokens"),
        usage_payload
            .get("input_tokens_details")
            .and_then(|value| value.get("cache_creation_tokens")),
        usage_payload
            .get("input_tokens_details")
            .and_then(|value| value.get("cache_creation_input_tokens")),
    ])
    .unwrap_or(0.0) as i64;
    let reasoning = first_finite_number(&[
        usage_payload.get("reasoning_tokens"),
        usage_payload
            .get("output_tokens_details")
            .and_then(|value| value.get("reasoning_tokens")),
    ])
    .unwrap_or(0.0) as i64;
    let total = first_finite_number(&[usage_payload.get("total_tokens")])
        .unwrap_or((input + output) as f64) as i64;
    Some(PersistedUsageRecord {
        record_id: String::new(),
        model,
        timestamp: Some(timestamp.clone()),
        timestamp_ms: parse_usage_timestamp(Some(timestamp)),
        total_tokens: total,
        input_tokens: input,
        output_tokens: output,
        cached_tokens: cached,
        cache_creation_tokens: cache_creation,
        reasoning_tokens: reasoning,
        failed,
    })
}

fn parse_usage_log_json_line(line: &str) -> Option<Value> {
    let trimmed = line.trim();
    if !trimmed.starts_with("data: ") {
        return None;
    }
    let payload = trimmed.trim_start_matches("data: ").trim();
    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }
    serde_json::from_str(payload).ok()
}

fn extract_usage_log_response_body(raw: &str) -> Option<&str> {
    let response_section = extract_usage_log_section(raw, "=== RESPONSE ===", None)?;
    let marker = "Body:\n";
    response_section
        .find(marker)
        .map(|index| &response_section[index + marker.len()..])
}

fn parse_usage_log_timestamp(raw: &str, fallback_timestamp_ms: i64) -> String {
    raw.lines()
        .find_map(|line| line.strip_prefix("Timestamp:").map(str::trim))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| timestamp_ms_to_iso(fallback_timestamp_ms))
}

fn parse_usage_log_request_payload(raw: &str) -> Value {
    extract_usage_log_section(raw, "=== REQUEST BODY ===", Some("=== RESPONSE ==="))
        .and_then(|section| serde_json::from_str(section).ok())
        .unwrap_or_else(|| json!({}))
}

fn extract_usage_log_section<'a>(
    raw: &'a str,
    start_marker: &str,
    end_marker: Option<&str>,
) -> Option<&'a str> {
    let start_index = raw.find(start_marker)?;
    let content_start = start_index + start_marker.len();
    let end_index = end_marker.and_then(|marker| {
        raw[content_start..]
            .find(marker)
            .map(|offset| content_start + offset)
    });
    Some(raw[content_start..end_index.unwrap_or(raw.len())].trim())
}

fn fetch_release_asset_descriptor(tag: &str) -> Result<ReleaseAssetDescriptor> {
    let normalized_tag = if tag.starts_with('v') {
        tag.to_string()
    } else {
        format!("v{tag}")
    };
    let version = normalized_tag.trim_start_matches('v').to_string();
    let arch = std::env::consts::ARCH;
    let target = if cfg!(target_os = "windows") {
        match arch {
            "x86_64" => "amd64",
            "aarch64" => "arm64",
            other => return Err(anyhow!("Windows 自动更新暂不支持当前架构: {other}")),
        }
    } else if cfg!(target_os = "macos") {
        match arch {
            "x86_64" => "amd64",
            "aarch64" => "arm64",
            other => return Err(anyhow!("macOS 自动更新暂不支持当前架构: {other}")),
        }
    } else {
        return Err(anyhow!("当前平台暂不支持自动更新。"));
    };
    if cfg!(target_os = "windows") {
        let asset_name = format!("CLIProxyAPI_{version}_windows_{target}.zip");
        Ok(ReleaseAssetDescriptor {
            tag: normalized_tag.clone(),
            version,
            asset_name: asset_name.clone(),
            archive_kind: "zip".to_string(),
            default_target_file_name: "cli-proxy-api.exe".to_string(),
            binary_names: proxy_binary_names()
                .into_iter()
                .map(str::to_string)
                .collect(),
            download_url: format!(
        "https://github.com/{CLIPROXY_REPOSITORY}/releases/download/{normalized_tag}/{asset_name}"
      ),
        })
    } else {
        let asset_name = format!("CLIProxyAPI_{version}_darwin_{target}.tar.gz");
        Ok(ReleaseAssetDescriptor {
            tag: normalized_tag.clone(),
            version,
            asset_name: asset_name.clone(),
            archive_kind: "tar.gz".to_string(),
            default_target_file_name: "cli-proxy-api".to_string(),
            binary_names: proxy_binary_names()
                .into_iter()
                .map(str::to_string)
                .collect(),
            download_url: format!(
        "https://github.com/{CLIPROXY_REPOSITORY}/releases/download/{normalized_tag}/{asset_name}"
      ),
        })
    }
}

async fn fetch_latest_release_descriptor(client: &Client) -> Result<ReleaseAssetDescriptor> {
    let response = client
        .get(CLIPROXY_RELEASES_LATEST_API_URL)
        .header("accept", "application/vnd.github+json")
        .send()
        .await?;
    if response.status().is_success() {
        let body_text = response.text().await?;
        if let Ok(payload) = serde_json::from_str::<Value>(&body_text) {
            let tag = normalized_string(payload.get("tag_name"))
                .or_else(|| normalized_string(payload.get("name")))
                .or_else(|| normalized_string(payload.get("tag")))
                .ok_or_else(|| anyhow!("缺少 tag_name"))?;
            let mut descriptor = fetch_release_asset_descriptor(&tag)?;
            if let Some(assets) = payload.get("assets").and_then(Value::as_array) {
                for asset in assets {
                    let name = normalized_string(asset.get("name"));
                    let url = normalized_string(
                        asset
                            .get("browser_download_url")
                            .or_else(|| asset.get("browserDownloadUrl")),
                    );
                    if let (Some(name), Some(url)) = (name, url) {
                        if name == descriptor.asset_name {
                            descriptor.download_url = url;
                            descriptor.asset_name = name;
                            break;
                        }
                    }
                }
            }
            return Ok(descriptor);
        }
        // Fall through to redirect-based latest release resolution.
    }

    let response = client.get(CLIPROXY_RELEASES_LATEST_URL).send().await?;
    let url = response.url().as_str().to_string();
    let tag = regex_capture(&url, r"/releases/tag/([^/?#]+)")
        .ok_or_else(|| anyhow!("无法解析 CLIProxyAPI 最新发布版本。"))?;
    fetch_release_asset_descriptor(&tag)
}

fn extract_archive(archive_path: &Path, destination: &Path, archive_kind: &str) -> Result<()> {
    if archive_kind == "zip" {
        let file = fs::File::open(archive_path)?;
        let mut archive = ZipArchive::new(file)?;
        for index in 0..archive.len() {
            let mut file = archive.by_index(index)?;
            let out_path = destination.join(file.name());
            if file.is_dir() {
                fs::create_dir_all(&out_path)?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut output = fs::File::create(&out_path)?;
                std::io::copy(&mut file, &mut output)?;
            }
        }
        return Ok(());
    }
    let file = fs::File::open(archive_path)?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    archive.unpack(destination)?;
    Ok(())
}

fn find_extracted_binary<'a>(root: &'a Path, binary_names: &[String]) -> Result<&'a Path> {
    let wanted = binary_names
        .iter()
        .map(|name| name.to_lowercase())
        .collect::<HashSet<_>>();
    let mut queue = vec![root.to_path_buf()];
    while let Some(current) = queue.pop() {
        for entry in fs::read_dir(&current)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                queue.push(path);
                continue;
            }
            let file_name = entry
                .file_name()
                .to_string_lossy()
                .to_string()
                .to_lowercase();
            if wanted.contains(&file_name) {
                return Ok(Box::leak(path.into_boxed_path()));
            }
        }
    }
    Err(anyhow!(
        "下载包已解压，但没有找到可执行的 CLIProxyAPI 文件。"
    ))
}

fn build_api_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/v1")
}

fn build_management_api_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn build_management_base_url(port: u16) -> String {
    format!("{}/management.html", build_management_api_base_url(port))
}

fn build_management_header_candidates(management_api_key: &str) -> Vec<HeaderMap> {
    dedupe_strings(&[
        Some(management_api_key.to_string()),
        Some(DEFAULT_MANAGEMENT_API_KEY.to_string()),
    ])
    .into_iter()
    .flat_map(|key| {
        let mut key_header = HeaderMap::new();
        key_header.insert(
            "x-management-key",
            HeaderValue::from_str(&key)
                .unwrap_or_else(|_| HeaderValue::from_static(DEFAULT_MANAGEMENT_API_KEY)),
        );
        let mut bearer_header = HeaderMap::new();
        bearer_header.insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {key}"))
                .unwrap_or_else(|_| HeaderValue::from_static("Bearer cliproxy-management")),
        );
        vec![key_header, bearer_header]
    })
    .collect()
}

fn generic_quota_summary(
    record: &Value,
    provider: &str,
    provider_label: &str,
    note: Option<String>,
) -> Value {
    let mut metas =
        vec![json!({ "label": "认证文件", "value": read_string(record.get("displayName"), "") })];
    if let Some(auth_index) = normalized_string(record.get("authIndex")) {
        metas.push(json!({ "label": "认证索引", "value": auth_index }));
    }
    if let Some(plan_type) = normalized_string(record.get("planType")) {
        metas.push(json!({ "label": "套餐", "value": plan_type }));
    }
    if let Some(note) = note {
        metas.push(json!({ "label": "说明", "value": note }));
    }
    json!({
      "provider": provider,
      "providerLabel": provider_label,
      "fetchedAt": now_iso(),
      "planType": record.get("planType").cloned().unwrap_or(Value::Null),
      "metas": metas,
      "items": [],
    })
}

fn build_codex_quota_summary(record: &Value, payload: &Value) -> Value {
    let mut summary = generic_quota_summary(record, "codex", "Codex", None);
    if let Some(plan_type) =
        normalized_string(payload.get("plan_type").or_else(|| payload.get("planType")))
    {
        summary["planType"] = Value::String(plan_type.clone());
        let metas = ensure_array_mut_value(&mut summary, "metas");
        if !metas
            .iter()
            .any(|item| read_string(item.get("label"), "") == "套餐")
        {
            metas.push(json!({ "label": "套餐", "value": plan_type }));
        }
    }

    let mut items = Vec::new();
    for (label, section) in [
        (
            "主额度",
            object(
                payload
                    .get("rate_limit")
                    .or_else(|| payload.get("rateLimit")),
            ),
        ),
        (
            "Code Review",
            object(
                payload
                    .get("code_review_rate_limit")
                    .or_else(|| payload.get("codeReviewRateLimit")),
            ),
        ),
    ] {
        if section.is_empty() {
            continue;
        }

        let (five_hour_window, weekly_window) = classify_codex_quota_windows(&section);
        if let Some(window) = five_hour_window {
            items.push(build_quota_item(
                &format!("{}-five-hour", normalize_quota_item_id(label)),
                &format!("{label} 5 小时"),
                remaining_percent_from_quota_window(
                    window,
                    section
                        .get("limit_reached")
                        .or_else(|| section.get("limitReached")),
                    section.get("allowed"),
                ),
                format_codex_reset_label(window),
                quota_amount_text(window),
            ));
        }
        if let Some(window) = weekly_window {
            items.push(build_quota_item(
                &format!("{}-weekly", normalize_quota_item_id(label)),
                &format!("{label} 7 天"),
                remaining_percent_from_quota_window(
                    window,
                    section
                        .get("limit_reached")
                        .or_else(|| section.get("limitReached")),
                    section.get("allowed"),
                ),
                format_codex_reset_label(window),
                quota_amount_text(window),
            ));
        }
    }

    for (index, additional_limit) in array(
        payload
            .get("additional_rate_limits")
            .or_else(|| payload.get("additionalRateLimits")),
    )
    .iter()
    .enumerate()
    {
        let limit_name = normalized_string(
            additional_limit
                .get("limit_name")
                .or_else(|| additional_limit.get("limitName"))
                .or_else(|| additional_limit.get("metered_feature"))
                .or_else(|| additional_limit.get("meteredFeature")),
        )
        .unwrap_or_else(|| format!("附加额度 {}", index + 1));
        let section = object(
            additional_limit
                .get("rate_limit")
                .or_else(|| additional_limit.get("rateLimit")),
        );
        if section.is_empty() {
            continue;
        }

        let (five_hour_window, weekly_window) = classify_codex_quota_windows(&section);
        let id_prefix = normalize_quota_item_id(&limit_name);
        if let Some(window) = five_hour_window {
            items.push(build_quota_item(
                &format!("{id_prefix}-five-hour-{index}"),
                &format!("{limit_name} 5 小时"),
                remaining_percent_from_quota_window(
                    window,
                    section
                        .get("limit_reached")
                        .or_else(|| section.get("limitReached")),
                    section.get("allowed"),
                ),
                format_codex_reset_label(window),
                quota_amount_text(window),
            ));
        }
        if let Some(window) = weekly_window {
            items.push(build_quota_item(
                &format!("{id_prefix}-weekly-{index}"),
                &format!("{limit_name} 7 天"),
                remaining_percent_from_quota_window(
                    window,
                    section
                        .get("limit_reached")
                        .or_else(|| section.get("limitReached")),
                    section.get("allowed"),
                ),
                format_codex_reset_label(window),
                quota_amount_text(window),
            ));
        }
    }

    summary["items"] = Value::Array(items);
    summary
}

fn build_claude_quota_summary(
    record: &Value,
    usage_payload: &Value,
    profile_payload: Option<Value>,
) -> Value {
    let plan_type = profile_payload
        .as_ref()
        .and_then(resolve_claude_plan_type_from_profile)
        .or_else(|| normalized_string(record.get("planType")));
    let mut summary = generic_quota_summary(record, "claude", "Claude", None);
    if let Some(plan_type) = plan_type.clone() {
        summary["planType"] = Value::String(plan_type);
    }
    let mut items = Vec::new();
    for (key, label, id) in CLAUDE_USAGE_WINDOW_KEYS {
        let section = object(usage_payload.get(*key));
        if section.is_empty() || !section.contains_key("utilization") {
            continue;
        }
        items.push(build_quota_item(
            id,
            label,
            to_remaining_percent_from_used(section.get("utilization")),
            format_quota_reset_time(section.get("resets_at").or_else(|| section.get("resetsAt"))),
            None,
        ));
    }
    summary["items"] = Value::Array(items);
    summary
}

fn build_gemini_quota_summary(
    record: &Value,
    quota_payload: &Value,
    _code_assist_payload: Option<Value>,
) -> Value {
    let mut summary = generic_quota_summary(record, "gemini-cli", "Gemini CLI", None);
    let project_id = resolve_gemini_cli_project_id_from_payload(quota_payload);
    if let Some(project_id) = project_id {
        let metas = ensure_array_mut_value(&mut summary, "metas");
        metas.push(json!({ "label": "项目 ID", "value": project_id }));
    }
    let mut grouped = HashMap::<String, (Option<f64>, Option<String>, Option<i64>)>::new();
    for bucket in array(quota_payload.get("buckets")) {
        let model_id = normalized_string(bucket.get("modelId").or_else(|| bucket.get("model_id")))
            .unwrap_or_else(|| "unknown".to_string());
        let remaining_fraction = normalized_quota_fraction(
            bucket
                .get("remainingFraction")
                .or_else(|| bucket.get("remaining_fraction")),
        );
        let remaining_amount = normalized_number(
            bucket
                .get("remainingAmount")
                .or_else(|| bucket.get("remaining_amount")),
        )
        .map(|value| value as i64);
        let reset_time =
            normalized_string(bucket.get("resetTime").or_else(|| bucket.get("reset_time")));
        let entry = grouped.entry(model_id).or_insert((
            remaining_fraction,
            reset_time.clone(),
            remaining_amount,
        ));
        if let Some(fraction) = remaining_fraction {
            entry.0 = Some(entry.0.unwrap_or(fraction).min(fraction));
        }
        if entry.1.is_none() {
            entry.1 = reset_time;
        }
        if let Some(amount) = remaining_amount {
            entry.2 = Some(entry.2.unwrap_or(amount).min(amount));
        }
    }
    let items = grouped
        .into_iter()
        .map(
            |(model, (remaining_fraction, reset_time, remaining_amount))| {
                build_quota_item(
                    &model,
                    &model,
                    normalize_percent_value(remaining_fraction),
                    format_quota_reset_time_value(reset_time),
                    remaining_amount.map(|amount| format!("{amount} 次")),
                )
            },
        )
        .collect::<Vec<_>>();
    summary["items"] = Value::Array(items);
    summary
}

fn build_antigravity_quota_summary(record: &Value, payload: &Value, project_id: &str) -> Value {
    let mut summary = generic_quota_summary(record, "antigravity", "Antigravity", None);
    let metas = ensure_array_mut_value(&mut summary, "metas");
    metas.push(json!({ "label": "项目 ID", "value": project_id }));
    let mut items = Vec::new();
    let models = object(payload.get("models"));
    for (model_id, entry) in models {
        let quota_info = object(entry.get("quotaInfo").or_else(|| entry.get("quota_info")));
        let remaining_fraction = normalized_quota_fraction(
            quota_info
                .get("remainingFraction")
                .or_else(|| quota_info.get("remaining_fraction"))
                .or_else(|| quota_info.get("remaining")),
        );
        if remaining_fraction.is_none() {
            continue;
        }
        let display_name =
            normalized_string(entry.get("displayName")).unwrap_or_else(|| model_id.clone());
        items.push(build_quota_item(
            &model_id,
            &display_name,
            normalize_percent_value(remaining_fraction),
            format_quota_reset_time(
                quota_info
                    .get("resetTime")
                    .or_else(|| quota_info.get("reset_time")),
            ),
            None,
        ));
    }
    summary["items"] = Value::Array(items);
    summary
}

fn build_kimi_quota_summary(record: &Value, payload: &Value) -> Value {
    let mut summary = generic_quota_summary(record, "kimi", "Kimi", None);
    let mut items = Vec::new();
    if let Some(usage) = payload.get("usage") {
        if let Some(item) = build_kimi_quota_item("summary", "总额度", usage) {
            items.push(item);
        }
    }
    for (index, limit) in array(payload.get("limits")).iter().enumerate() {
        let detail = if limit.get("detail").map(Value::is_object).unwrap_or(false) {
            limit.get("detail").unwrap()
        } else {
            limit
        };
        let label = normalized_string(limit.get("name"))
            .or_else(|| normalized_string(detail.get("name")))
            .or_else(|| normalized_string(limit.get("title")))
            .or_else(|| normalized_string(detail.get("title")))
            .unwrap_or_else(|| format!("额度 {}", index + 1));
        if let Some(item) = build_kimi_quota_item(&format!("limit-{}", index + 1), &label, detail) {
            items.push(item);
        }
    }
    summary["items"] = Value::Array(items);
    summary
}

fn build_kimi_quota_item(id: &str, label: &str, data: &Value) -> Option<Value> {
    let limit = normalized_number(data.get("limit"));
    let used = normalized_number(data.get("used")).or_else(|| {
        let remaining = normalized_number(data.get("remaining"))?;
        Some(limit.unwrap_or(remaining) - remaining)
    });
    if limit.is_none() && used.is_none() {
        return None;
    }
    let remaining_percent = match (limit, used) {
        (Some(limit), Some(used)) if limit > 0.0 => {
            Some(((limit - used) / limit * 100.0).round().clamp(0.0, 100.0))
        }
        (Some(_), Some(_)) => Some(0.0),
        _ => None,
    };
    Some(build_quota_item(
        id,
        label,
        remaining_percent,
        format_kimi_reset_hint(data),
        match (used, limit) {
            (Some(used), Some(limit)) => Some(format!(
                "{} / {}",
                used.round() as i64,
                limit.round() as i64
            )),
            _ => None,
        },
    ))
}

fn build_quota_item(
    id: &str,
    label: &str,
    remaining_percent: Option<f64>,
    reset_text: Option<String>,
    amount_text: Option<String>,
) -> Value {
    json!({
      "id": id,
      "label": label,
      "remainingPercent": remaining_percent.map(|value| value.round() as i64),
      "amountText": amount_text,
      "resetText": reset_text,
    })
}

fn quota_amount_text(window: &Map<String, Value>) -> Option<String> {
    let limit = normalized_number(window.get("limit"));
    let used = normalized_number(window.get("used"));
    match (used, limit) {
        (Some(used), Some(limit)) => Some(format!(
            "{} / {}",
            used.round() as i64,
            limit.round() as i64
        )),
        _ => None,
    }
}

fn remaining_percent_from_quota_window(
    window: &Map<String, Value>,
    limit_reached: Option<&Value>,
    allowed: Option<&Value>,
) -> Option<f64> {
    let explicit = normalize_percent_like(window.get("remaining_percent"))
        .or_else(|| normalize_percent_like(window.get("remainingPercent")))
        .or_else(|| normalize_percent_like(window.get("remaining_percentage")))
        .or_else(|| normalize_percent_like(window.get("remainingPercentage")))
        .or_else(|| {
            normalized_quota_fraction(window.get("remaining_fraction")).map(|value| value * 100.0)
        });
    if explicit.is_some() {
        return explicit;
    }

    let remaining_count = normalized_number(window.get("remaining"));
    let limit_count = normalized_number(window.get("limit"));
    if let (Some(remaining), Some(limit)) = (remaining_count, limit_count) {
        if limit > 0.0 {
            return Some(((remaining / limit) * 100.0).clamp(0.0, 100.0));
        }
    }

    if let Some(used) = normalize_percent_like(window.get("used_percent"))
        .or_else(|| normalize_percent_like(window.get("usedPercent")))
        .or_else(|| normalize_percent_like(window.get("used_percentage")))
        .or_else(|| normalize_percent_like(window.get("usedPercentage")))
        .or_else(|| normalize_percent_like(window.get("utilization")))
    {
        return Some((100.0 - used).clamp(0.0, 100.0));
    }

    let used_count = normalized_number(window.get("used"));
    if let (Some(used), Some(limit)) = (used_count, limit_count) {
        if limit > 0.0 {
            return Some((100.0 - ((used / limit) * 100.0)).clamp(0.0, 100.0));
        }
    }

    if matches!(normalized_bool(allowed), Some(false)) || read_bool(limit_reached, false) {
        return Some(0.0);
    }
    None
}

fn codex_limit_window_seconds(window: &Map<String, Value>) -> Option<i64> {
    normalized_number(
        window
            .get("limit_window_seconds")
            .or_else(|| window.get("limitWindowSeconds")),
    )
    .map(|value| value.round() as i64)
}

fn classify_codex_quota_windows<'a>(
    section: &'a Map<String, Value>,
) -> (
    Option<&'a Map<String, Value>>,
    Option<&'a Map<String, Value>>,
) {
    let direct_five_hour = section
        .get("five_hour_window")
        .or_else(|| section.get("fiveHourWindow"))
        .and_then(Value::as_object);
    let direct_weekly = section
        .get("weekly_window")
        .or_else(|| section.get("weeklyWindow"))
        .and_then(Value::as_object);
    if direct_five_hour.is_some() || direct_weekly.is_some() {
        return (direct_five_hour, direct_weekly);
    }

    let primary_window = section
        .get("primary_window")
        .or_else(|| section.get("primaryWindow"))
        .and_then(Value::as_object);
    let secondary_window = section
        .get("secondary_window")
        .or_else(|| section.get("secondaryWindow"))
        .and_then(Value::as_object);
    let mut five_hour_window = None::<&Map<String, Value>>;
    let mut weekly_window = None::<&Map<String, Value>>;

    for window in [primary_window, secondary_window].into_iter().flatten() {
        match codex_limit_window_seconds(window) {
            Some(18_000) if five_hour_window.is_none() => five_hour_window = Some(window),
            Some(604_800) if weekly_window.is_none() => weekly_window = Some(window),
            _ => {}
        }
    }

    if five_hour_window.is_none() {
        if let Some(window) = primary_window {
            if !weekly_window
                .map(|existing| std::ptr::eq(existing, window))
                .unwrap_or(false)
            {
                five_hour_window = Some(window);
            }
        }
    }
    if weekly_window.is_none() {
        if let Some(window) = secondary_window {
            if !five_hour_window
                .map(|existing| std::ptr::eq(existing, window))
                .unwrap_or(false)
            {
                weekly_window = Some(window);
            }
        }
    }

    (five_hour_window, weekly_window)
}

fn normalize_quota_item_id(value: &str) -> String {
    let normalized = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() {
                char
            } else {
                '-'
            }
        })
        .collect::<String>();
    normalized.trim_matches('-').to_string()
}

fn to_remaining_percent_from_used(value: Option<&Value>) -> Option<f64> {
    normalize_percent_like(value).map(|used| (100.0 - used).clamp(0.0, 100.0))
}

fn normalize_percent_value(value: Option<f64>) -> Option<f64> {
    value.map(|value| if value <= 1.0 { value * 100.0 } else { value }.clamp(0.0, 100.0))
}

fn normalize_percent_like(value: Option<&Value>) -> Option<f64> {
    let value = value?;
    if let Some(text) = normalized_string(Some(value)) {
        if let Some(stripped) = text.strip_suffix('%') {
            return stripped.trim().parse::<f64>().ok();
        }
    }
    let value = normalized_number(Some(value))?;
    Some(value.clamp(0.0, 100.0))
}

fn format_codex_reset_label(window: &Map<String, Value>) -> Option<String> {
    if let Some(reset_at) =
        normalized_number(window.get("reset_at").or_else(|| window.get("resetAt")))
    {
        return format_unix_seconds_label(reset_at as i64);
    }
    if let Some(reset_after_seconds) = normalized_number(
        window
            .get("reset_after_seconds")
            .or_else(|| window.get("resetAfterSeconds")),
    ) {
        return format_unix_seconds_label(Utc::now().timestamp() + reset_after_seconds as i64);
    }
    None
}

fn format_unix_seconds_label(value: i64) -> Option<String> {
    if value <= 0 {
        return None;
    }
    Some(
        Utc.timestamp_opt(value, 0)
            .single()?
            .format("%m/%d %H:%M")
            .to_string(),
    )
}

fn format_quota_reset_time(value: Option<&Value>) -> Option<String> {
    format_quota_reset_time_value(normalized_string(value))
}

fn format_quota_reset_time_value(value: Option<String>) -> Option<String> {
    let value = value?;
    let parsed = chrono::DateTime::parse_from_rfc3339(&value).ok()?;
    Some(parsed.with_timezone(&Utc).format("%m/%d %H:%M").to_string())
}

fn format_kimi_reset_hint(data: &Value) -> Option<String> {
    for key in ["reset_at", "resetAt", "reset_time", "resetTime"] {
        if let Some(value) = format_quota_reset_time(data.get(key)) {
            return Some(value);
        }
    }
    let relative = normalized_number(
        data.get("reset_in")
            .or_else(|| data.get("resetIn"))
            .or_else(|| data.get("ttl")),
    )?;
    let seconds = relative as i64;
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    if hours > 0 && minutes > 0 {
        return Some(format!("{hours}h {minutes}m"));
    }
    if hours > 0 {
        return Some(format!("{hours}h"));
    }
    if minutes > 0 {
        return Some(format!("{minutes}m"));
    }
    Some("<1m".to_string())
}

fn resolve_claude_plan_type_from_profile(profile: &Value) -> Option<String> {
    let account = object(profile.get("account"));
    let has_max = normalize_flag_value(account.get("has_claude_max"));
    let has_pro = normalize_flag_value(account.get("has_claude_pro"));
    match (has_max, has_pro) {
        (Some(true), _) => Some("max".to_string()),
        (_, Some(true)) => Some("pro".to_string()),
        (Some(false), Some(false)) => Some("free".to_string()),
        _ => None,
    }
}

fn parse_management_api_body(body: &Value) -> Value {
    if body.is_object() {
        body.clone()
    } else if let Some(text) = body.as_str() {
        serde_json::from_str(text).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    }
}

fn get_api_call_error_message(result: &ManagementApiCallResponse) -> String {
    normalized_string(result.body.get("error_description"))
        .or_else(|| normalized_string(result.body.get("error")))
        .or_else(|| normalized_string(result.body.get("message")))
        .or_else(|| normalized_string(result.body.get("detail")))
        .or_else(|| normalized_string(Some(&Value::String(result.body_text.clone()))))
        .unwrap_or_else(|| format!("HTTP {}", result.status_code))
}

fn codex_request_headers() -> HashMap<String, String> {
    HashMap::from([
        ("Authorization".to_string(), "Bearer $TOKEN$".to_string()),
        ("Content-Type".to_string(), "application/json".to_string()),
        (
            "User-Agent".to_string(),
            "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal".to_string(),
        ),
    ])
}

fn claude_request_headers() -> HashMap<String, String> {
    HashMap::from([
        ("Authorization".to_string(), "Bearer $TOKEN$".to_string()),
        ("Content-Type".to_string(), "application/json".to_string()),
        ("anthropic-beta".to_string(), "oauth-2025-04-20".to_string()),
    ])
}

fn gemini_request_headers() -> HashMap<String, String> {
    HashMap::from([
        ("Authorization".to_string(), "Bearer $TOKEN$".to_string()),
        ("Content-Type".to_string(), "application/json".to_string()),
    ])
}

fn antigravity_request_headers() -> HashMap<String, String> {
    HashMap::from([
        ("Authorization".to_string(), "Bearer $TOKEN$".to_string()),
        ("Content-Type".to_string(), "application/json".to_string()),
        (
            "User-Agent".to_string(),
            "antigravity/1.11.5 windows/amd64".to_string(),
        ),
    ])
}

fn kimi_request_headers() -> HashMap<String, String> {
    HashMap::new()
}

fn detect_provider_from_file_name(file_name: &str) -> String {
    let normalized = file_name.to_lowercase();
    for (needle, provider) in [
        ("gemini", "gemini"),
        ("codex", "codex"),
        ("openai", "openai"),
        ("chatgpt", "openai"),
        ("gpt", "openai"),
        ("claude", "claude"),
        ("vertex", "vertex"),
        ("qwen", "qwen"),
        ("iflow", "iflow"),
        ("kimi", "kimi"),
        ("kiro", "kiro"),
        ("copilot", "copilot"),
        ("antigravity", "antigravity"),
    ] {
        if normalized.contains(needle) {
            return provider.to_string();
        }
    }
    "unknown".to_string()
}

fn get_provider_import_label(provider_id: &str) -> String {
    PROVIDER_IMPORTS
        .iter()
        .find(|(id, _)| *id == provider_id)
        .map(|(_, label)| (*label).to_string())
        .unwrap_or_else(|| "其他".to_string())
}

fn ai_provider_kind_label(kind: &str) -> &'static str {
    match kind {
        "gemini" => "Gemini",
        "codex" => "Codex",
        "claude" => "Claude",
        "vertex" => "Vertex",
        "openai-compatibility" => "OpenAI Compatibility",
        "ampcode" => "Ampcode",
        _ => "Provider",
    }
}

fn normalize_auth_provider_hint(value: Option<&Value>) -> Option<String> {
    let normalized = normalized_string(value)?.to_lowercase();
    for (needle, provider) in [
        ("anthropic", "claude"),
        ("claude", "claude"),
        ("codex", "codex"),
        ("openai", "openai"),
        ("chatgpt", "openai"),
        ("gemini", "gemini"),
        ("vertex", "vertex"),
        ("qwen", "qwen"),
        ("iflow", "iflow"),
        ("kimi", "kimi"),
        ("kiro", "kiro"),
        ("copilot", "copilot"),
        ("antigravity", "antigravity"),
    ] {
        if normalized.contains(needle) {
            return Some(provider.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn used_percent_one_is_not_treated_as_full_usage() {
        let window = serde_json::Map::from_iter([(
            "used_percent".to_string(),
            Value::Number(Number::from(1)),
        )]);
        assert_eq!(
            remaining_percent_from_quota_window(&window, None, None),
            Some(99.0)
        );
    }

    #[test]
    fn utilization_one_is_not_treated_as_full_usage() {
        assert_eq!(
            to_remaining_percent_from_used(Some(&Value::Number(Number::from(1)))),
            Some(99.0)
        );
    }

    #[test]
    fn remaining_fraction_one_is_full_remaining() {
        let window = serde_json::Map::from_iter([(
            "remaining_fraction".to_string(),
            Value::Number(Number::from(1)),
        )]);
        assert_eq!(
            remaining_percent_from_quota_window(&window, None, None),
            Some(100.0)
        );
    }

    #[test]
    fn remaining_count_uses_limit_ratio_instead_of_raw_percent() {
        let window = serde_json::Map::from_iter([
            ("remaining".to_string(), Value::Number(Number::from(1))),
            ("limit".to_string(), Value::Number(Number::from(20))),
        ]);
        assert_eq!(
            remaining_percent_from_quota_window(&window, None, None),
            Some(5.0)
        );
    }

    #[test]
    fn allowed_false_forces_zero_remaining() {
        let window = serde_json::Map::new();
        assert_eq!(
            remaining_percent_from_quota_window(&window, None, Some(&Value::Bool(false)),),
            Some(0.0)
        );
    }

    #[test]
    fn codex_primary_secondary_windows_are_supported() {
        let record = json!({
            "displayName": "codex-auth.json",
            "planType": Value::Null,
        });
        let payload = json!({
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": {
                    "limit_window_seconds": 18000,
                    "used_percent": 25,
                    "reset_after_seconds": 3600
                },
                "secondary_window": {
                    "limit_window_seconds": 604800,
                    "used_percent": 50,
                    "reset_after_seconds": 7200
                }
            },
            "additional_rate_limits": [{
                "limit_name": "Responses API",
                "rate_limit": {
                    "primary_window": {
                        "limit_window_seconds": 18000,
                        "used_percent": 10,
                        "reset_after_seconds": 3600
                    },
                    "secondary_window": {
                        "limit_window_seconds": 604800,
                        "used_percent": 20,
                        "reset_after_seconds": 7200
                    }
                }
            }]
        });

        let summary = build_codex_quota_summary(&record, &payload);
        let items = array(summary.get("items"));
        assert_eq!(read_string(summary.get("planType"), ""), "plus");
        assert_eq!(items.len(), 4);
        assert_eq!(read_string(items[0].get("label"), ""), "主额度 5 小时");
        assert_eq!(
            items[0].get("remainingPercent").and_then(Value::as_i64),
            Some(75)
        );
        assert_eq!(read_string(items[1].get("label"), ""), "主额度 7 天");
        assert_eq!(
            items[1].get("remainingPercent").and_then(Value::as_i64),
            Some(50)
        );
        assert_eq!(
            read_string(items[2].get("label"), ""),
            "Responses API 5 小时"
        );
        assert_eq!(
            items[2].get("remainingPercent").and_then(Value::as_i64),
            Some(90)
        );
        assert_eq!(read_string(items[3].get("label"), ""), "Responses API 7 天");
        assert_eq!(
            items[3].get("remainingPercent").and_then(Value::as_i64),
            Some(80)
        );
    }

    #[test]
    fn merge_remote_auth_file_record_keeps_plan_and_details() {
        let local_record = json!({
            "name": "codex-auth.json",
            "displayName": "codex-auth.json",
            "path": "/tmp/codex-auth.json",
            "provider": "codex",
            "type": "codex",
            "enabled": true,
            "size": 128,
            "modifiedAt": "2026-04-11T00:00:00.000Z",
            "authIndex": Value::Null,
            "label": Value::Null,
            "source": Value::Null,
            "status": Value::Null,
            "statusMessage": Value::Null,
            "runtimeOnly": false,
            "unavailable": false,
            "createdAt": Value::Null,
            "updatedAt": Value::Null,
            "successCount": 0,
            "failureCount": 0,
            "totalRequests": 0,
            "lastUsedAt": Value::Null,
            "planType": Value::Null,
            "detailItems": [
                { "label": "文件类型", "value": "codex" },
                { "label": "邮箱", "value": "local@example.com" }
            ],
        });
        let remote_entry = json!({
            "name": "codex-auth.json",
            "provider": "codex",
            "type": "codex",
            "auth_index": 17,
            "label": "主账号",
            "source": "file",
            "status": "ready",
            "status_message": "ok",
            "plan_type": "plus",
            "email": "remote@example.com",
            "updated_at": "2026-04-11T01:00:00.000Z"
        });
        let usage_stats = HashMap::from([(
            "17".to_string(),
            AuthFileUsageStats {
                total_requests: 9,
                success_count: 8,
                failure_count: 1,
                last_used_at: Some("2026-04-11T02:00:00.000Z".to_string()),
            },
        )]);

        let merged = merge_remote_auth_file_record(local_record, Some(remote_entry), &usage_stats);
        let detail_items = array(merged.get("detailItems"));

        assert_eq!(read_string(merged.get("authIndex"), ""), "17");
        assert_eq!(read_string(merged.get("planType"), ""), "plus");
        assert_eq!(read_string(merged.get("status"), ""), "ready");
        assert_eq!(read_string(merged.get("statusMessage"), ""), "ok");
        assert_eq!(merged.get("totalRequests").and_then(Value::as_i64), Some(9));
        assert!(detail_items.iter().any(|item| {
            read_string(item.get("label"), "") == "邮箱"
                && read_string(item.get("value"), "") == "local@example.com"
        }));
        assert!(detail_items.iter().any(|item| {
            read_string(item.get("label"), "") == "邮箱"
                && read_string(item.get("value"), "") == "remote@example.com"
        }));
        assert!(detail_items.iter().any(|item| {
            read_string(item.get("label"), "") == "认证索引"
                && read_string(item.get("value"), "") == "17"
        }));
    }

    #[test]
    fn apply_proxy_credentials_injects_username_and_password() {
        let url = apply_proxy_credentials("http://127.0.0.1:7890", "alice", "secret");
        assert_eq!(url, "http://alice:secret@127.0.0.1:7890/");
    }

    #[test]
    fn apply_proxy_credentials_keeps_url_when_credentials_missing() {
        let url = apply_proxy_credentials("socks5://127.0.0.1:1080", "", "");
        assert_eq!(url, "socks5://127.0.0.1:1080");
    }

    #[test]
    fn reasoning_effort_none_removes_managed_entry() {
        let mut config = json!({
            "payload": {
                "default": [
                    build_managed_reasoning_effort_entry("xhigh"),
                    json!({"params": {"temperature": 0.2}})
                ]
            }
        });
        apply_reasoning_effort(&mut config, "none");
        let payload = object(config.get("payload"));
        let defaults = array(payload.get("default"));
        assert_eq!(defaults.len(), 1);
        let params = object(defaults[0].get("params"));
        assert_eq!(read_string(params.get("_managedBy"), ""), "");
    }
}

fn payload_contains_auth_hints(payload: &Value) -> bool {
    [
        "access_token",
        "refresh_token",
        "id_token",
        "session_token",
        "client_secret",
        "private_key",
        "private_key_id",
        "device_code",
        "BXAuth",
        "bxauth",
        "chatgpt_account_id",
        "chatgptAccountId",
        "workspace_id",
        "workspaceId",
        "account_id",
        "accountId",
    ]
    .iter()
    .any(|key| normalized_string(payload.get(*key)).is_some())
}

fn looks_like_auth_file_payload(file_name: &str, payload: Option<&Value>) -> bool {
    let Some(payload) = payload else {
        return false;
    };
    let metadata = payload
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let attributes = payload
        .get("attributes")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let tokens = payload.get("tokens").cloned().unwrap_or_else(|| json!({}));
    let account = payload.get("account").cloned().unwrap_or_else(|| json!({}));
    let user = payload.get("user").cloned().unwrap_or_else(|| json!({}));
    let installed = payload
        .get("installed")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let web = payload.get("web").cloned().unwrap_or_else(|| json!({}));
    let cookies = payload.get("cookies").cloned().unwrap_or_else(|| json!({}));
    let provider_hints = [
        normalize_auth_provider_hint(Some(&Value::String(detect_provider_from_file_name(
            file_name,
        )))),
        normalize_auth_provider_hint(payload.get("type")),
        normalize_auth_provider_hint(payload.get("provider")),
        normalize_auth_provider_hint(metadata.get("type")),
        normalize_auth_provider_hint(metadata.get("provider")),
        normalize_auth_provider_hint(attributes.get("type")),
        normalize_auth_provider_hint(attributes.get("provider")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    let payload_objects = [
        &payload,
        &metadata,
        &attributes,
        &tokens,
        &account,
        &user,
        &installed,
        &web,
        &cookies,
    ];
    let has_auth_hints = payload_objects
        .into_iter()
        .any(|entry| payload_contains_auth_hints(entry));
    let has_google_shape = normalized_string(payload.get("type"))
        .map(|value| value == "service_account" || value == "authorized_user")
        .unwrap_or(false)
        || normalized_string(payload.get("client_email")).is_some()
        || normalized_string(installed.get("client_email")).is_some();
    let has_secret = normalized_string(payload.get("private_key")).is_some()
        || normalized_string(payload.get("private_key_id")).is_some()
        || normalized_string(payload.get("client_secret")).is_some()
        || normalized_string(payload.get("refresh_token")).is_some();
    let has_cookie_auth = normalized_string(payload.get("BXAuth")).is_some()
        || normalized_string(payload.get("bxauth")).is_some()
        || normalized_string(cookies.get("BXAuth")).is_some()
        || normalized_string(cookies.get("bxauth")).is_some();
    let has_identity = normalized_string(payload.get("email")).is_some()
        || normalized_string(account.get("email")).is_some()
        || normalized_string(user.get("email")).is_some()
        || normalized_string(payload.get("account")).is_some()
        || normalized_string(account.get("name")).is_some()
        || resolve_codex_chatgpt_account_id_from_payload(payload).is_some()
        || resolve_codex_plan_type_from_payload(payload).is_some()
        || resolve_gemini_cli_project_id_from_payload(payload).is_some();
    has_auth_hints
        || (has_google_shape && has_secret)
        || has_cookie_auth
        || (!provider_hints.is_empty() && has_identity)
}

fn resolve_codex_chatgpt_account_id_from_payload(payload: &Value) -> Option<String> {
    let candidates = collect_codex_payload_objects(payload);
    for candidate in candidates {
        if let Some(account_id) = read_codex_named_account_id(&candidate) {
            return Some(account_id);
        }
    }
    None
}

fn resolve_codex_access_token_from_payload(payload: &Value) -> Option<String> {
    let metadata = object(payload.get("metadata"));
    let tokens = object(payload.get("tokens"));
    let attributes = object(payload.get("attributes"));

    for candidate in [
        payload.get("access_token"),
        payload.get("accessToken"),
        tokens.get("access_token"),
        tokens.get("accessToken"),
        metadata.get("access_token"),
        metadata.get("accessToken"),
        attributes.get("access_token"),
        attributes.get("accessToken"),
    ] {
        if let Some(value) = normalized_string(candidate) {
            return Some(value);
        }
    }

    None
}

fn collect_codex_payload_objects(payload: &Value) -> Vec<Value> {
    let metadata = payload
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let attributes = payload
        .get("attributes")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let tokens = payload.get("tokens").cloned().unwrap_or_else(|| json!({}));
    let candidates = vec![
        payload.clone(),
        metadata.clone(),
        attributes.clone(),
        tokens.clone(),
        payload.get("id_token").cloned().unwrap_or(Value::Null),
        payload.get("access_token").cloned().unwrap_or(Value::Null),
        payload.get("token").cloned().unwrap_or(Value::Null),
        metadata.get("id_token").cloned().unwrap_or(Value::Null),
        attributes.get("id_token").cloned().unwrap_or(Value::Null),
    ];
    candidates
        .into_iter()
        .filter_map(|candidate| parse_object_like_value(&candidate))
        .collect()
}

fn read_codex_named_account_id(candidate: &Value) -> Option<String> {
    let account = object(candidate.get("account"));
    let workspace = object(candidate.get("workspace"));
    let auth_claim = candidate
        .get("https://api.openai.com/auth")
        .and_then(parse_object_like_value_ref);
    for key in [
        "chatgpt_account_id",
        "chatgptAccountId",
        "account_id",
        "accountId",
        "workspace_id",
        "workspaceId",
    ] {
        if let Some(value) = normalized_string(candidate.get(key))
            .or_else(|| normalized_string(account.get(key)))
            .or_else(|| normalized_string(workspace.get(key)))
            .or_else(|| {
                auth_claim
                    .as_ref()
                    .and_then(|claim| normalized_string(claim.get(key)))
            })
        {
            return Some(value);
        }
    }
    None
}

fn resolve_codex_chatgpt_account_id_from_accounts_payload(payload: &Value) -> Option<String> {
    let accounts = object(payload.get("accounts"));
    for (key, value) in accounts {
        if let Some(account_id) = read_codex_named_account_id(&value).or(Some(key.clone())) {
            return Some(account_id);
        }
    }
    None
}

fn resolve_codex_plan_type_from_payload(payload: &Value) -> Option<String> {
    for candidate in [
        payload.clone(),
        payload
            .get("metadata")
            .cloned()
            .unwrap_or_else(|| json!({})),
        payload
            .get("attributes")
            .cloned()
            .unwrap_or_else(|| json!({})),
    ] {
        if let Some(plan_type) = normalized_string(candidate.get("plan_type"))
            .or_else(|| normalized_string(candidate.get("planType")))
            .map(|value| value.to_lowercase())
        {
            return Some(plan_type);
        }
        if let Some(id_token) = candidate
            .get("id_token")
            .and_then(parse_object_like_value_ref)
        {
            if let Some(plan_type) = normalized_string(id_token.get("plan_type"))
                .or_else(|| normalized_string(id_token.get("planType")))
                .map(|value| value.to_lowercase())
            {
                return Some(plan_type);
            }
        }
    }
    None
}

fn resolve_gemini_cli_project_id_from_payload(payload: &Value) -> Option<String> {
    for candidate in [
        payload.get("account"),
        payload.get("project_id"),
        payload.get("projectId"),
        payload
            .get("installed")
            .and_then(|value| value.get("project_id")),
        payload
            .get("installed")
            .and_then(|value| value.get("projectId")),
        payload.get("web").and_then(|value| value.get("project_id")),
        payload.get("web").and_then(|value| value.get("projectId")),
    ] {
        let direct = normalized_string(candidate);
        if let Some(value) = direct {
            if let Some(start) = value.rfind('(') {
                if let Some(end) = value.rfind(')') {
                    if end > start + 1 {
                        return Some(value[start + 1..end].trim().to_string());
                    }
                }
            }
            if !value.contains('@') && !value.contains(' ') {
                return Some(value);
            }
        }
    }
    None
}

fn resolve_antigravity_project_id_from_payload(payload: &Value) -> Option<String> {
    normalized_string(payload.get("project_id"))
        .or_else(|| normalized_string(payload.get("projectId")))
        .or_else(|| {
            normalized_string(
                payload
                    .get("installed")
                    .and_then(|value| value.get("project_id")),
            )
        })
        .or_else(|| {
            normalized_string(
                payload
                    .get("installed")
                    .and_then(|value| value.get("projectId")),
            )
        })
        .or_else(|| normalized_string(payload.get("web").and_then(|value| value.get("project_id"))))
        .or_else(|| normalized_string(payload.get("web").and_then(|value| value.get("projectId"))))
}

fn resolve_quota_provider(record: &Value) -> Option<String> {
    let candidates = [
        normalized_string(record.get("provider")),
        normalized_string(record.get("type")),
        normalized_string(record.get("displayName")),
    ]
    .into_iter()
    .flatten()
    .map(|value| value.to_lowercase())
    .collect::<Vec<_>>();
    if candidates.iter().any(|value| value.contains("antigravity")) {
        return Some("antigravity".to_string());
    }
    if candidates.iter().any(|value| value.contains("claude")) {
        return Some("claude".to_string());
    }
    if candidates.iter().any(|value| {
        value.contains("codex") || value.contains("openai") || value.contains("chatgpt")
    }) {
        return Some("codex".to_string());
    }
    if candidates.iter().any(|value| value.contains("gemini")) {
        return Some("gemini".to_string());
    }
    if candidates.iter().any(|value| value.contains("kimi")) {
        return Some("kimi".to_string());
    }
    None
}

fn build_imported_auth_file_name(source_path: &Path, provider_hint: Option<&str>) -> String {
    let base_name = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("auth")
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '.' || char == '-' || char == '_' {
                char
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let normalized_provider_hint = provider_hint.unwrap_or("").trim().to_lowercase();
    let prefix = if !normalized_provider_hint.is_empty()
        && !base_name.to_lowercase().contains(&normalized_provider_hint)
    {
        format!("{normalized_provider_hint}-")
    } else {
        String::new()
    };
    format!(
        "{prefix}{}.{}",
        if base_name.is_empty() {
            "auth"
        } else {
            &base_name
        },
        source_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("json")
    )
}

fn env_proxy_for_url(target_url: &str) -> Option<String> {
    let parsed = Url::parse(target_url).ok()?;
    let proxy = env_proxy::for_url(&parsed);
    let (host, port) = proxy.host_port()?;
    Some(format!("http://{}:{}", host, port))
}

fn normalize_system_proxy(host: &str, port: u16) -> String {
    let protocol = if host.to_ascii_lowercase().contains("socks") {
        "socks5"
    } else {
        "http"
    };
    format!("{}://{}:{}", protocol, host, port)
}

fn detect_system_proxy_url() -> Option<String> {
    if let Some(proxy) = env_proxy_for_url(DEFAULT_PROXY_CHECK_URL) {
        return Some(proxy);
    }

    match Sysproxy::get_system_proxy() {
        Ok(proxy) if proxy.enable => Some(normalize_system_proxy(&proxy.host, proxy.port)),
        _ => None,
    }
}

fn compute_proxy_binary_update_available(
    has_binary: bool,
    current_version: Option<String>,
    latest_version: Option<String>,
) -> Option<bool> {
    let latest_version = latest_version?;
    if !has_binary {
        return Some(true);
    }
    let current_version = current_version?;
    compare_versions(&latest_version, &current_version).map(|value| value > 0)
}

fn compare_versions(left: &str, right: &str) -> Option<i8> {
    let left_segments = parse_version_segments(left)?;
    let right_segments = parse_version_segments(right)?;
    let max_len = left_segments.len().max(right_segments.len());
    for index in 0..max_len {
        let left_value = *left_segments.get(index).unwrap_or(&0);
        let right_value = *right_segments.get(index).unwrap_or(&0);
        if left_value > right_value {
            return Some(1);
        }
        if left_value < right_value {
            return Some(-1);
        }
    }
    Some(0)
}

fn parse_version_segments(version: &str) -> Option<Vec<i64>> {
    let cleaned = version.trim().trim_start_matches('v');
    if cleaned.is_empty() {
        return None;
    }
    let mut segments = Vec::new();
    for segment in cleaned.split(['.', '-', '+']) {
        if segment.is_empty() {
            continue;
        }
        let value = segment.parse::<i64>().ok()?;
        segments.push(value);
    }
    (!segments.is_empty()).then_some(segments)
}

fn move_file_with_fallback(source: &Path, target: &Path) -> Result<()> {
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source, target)?;
            fs::remove_file(source)?;
            Ok(())
        }
    }
}

fn self_test_enabled() -> bool {
    std::env::var_os("LICH13CPA_SELF_TEST").is_some()
}

fn self_test_should_exit() -> bool {
    std::env::var("LICH13CPA_SELF_TEST_EXIT")
        .map(|value| value != "0")
        .unwrap_or(true)
}

fn self_test_no_open() -> bool {
    std::env::var("LICH13CPA_SELF_TEST_NO_OPEN")
        .map(|value| value != "0")
        .unwrap_or(false)
}

fn self_test_report_path() -> Option<PathBuf> {
    std::env::var_os("LICH13CPA_SELF_TEST_REPORT").map(PathBuf::from)
}

fn self_test_import_files() -> Option<Vec<PathBuf>> {
    let raw = std::env::var("LICH13CPA_SELF_TEST_IMPORT_FILES").ok()?;
    let items = raw
        .split('\n')
        .flat_map(|line| line.split(':'))
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    (!items.is_empty()).then_some(items)
}

fn write_self_test_report(payload: &Value) -> Result<()> {
    let Some(path) = self_test_report_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(payload)?)?;
    Ok(())
}

fn remove_path_if_exists(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn copy_path_recursive(source: &Path, target: &Path) -> Result<()> {
    if !source.exists() {
        return Ok(());
    }
    if source.is_dir() {
        fs::create_dir_all(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_path_recursive(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, target)?;
    }
    Ok(())
}

fn migrate_path_if_missing(source: &Path, target: &Path) -> Result<()> {
    if !source.exists() {
        return Ok(());
    }

    if source.is_dir() {
        fs::create_dir_all(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            migrate_path_if_missing(&entry.path(), &target.join(entry.file_name()))?;
        }
        return Ok(());
    }

    if target.exists() {
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, target)?;
    Ok(())
}

fn start_models_stub_server() -> Result<(String, thread::JoinHandle<()>)> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let handle = thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0_u8; 4096];
            let _ = stream.read(&mut buffer);
            let body = r#"{"data":[{"id":"model-one"},{"id":"model-two"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    Ok((format!("http://127.0.0.1:{port}/v1"), handle))
}

fn parse_persisted_log_line(line: &str) -> Option<LogEntry> {
    let captures = regex::Regex::new(r"^\[(.+?)\] \[(.+?)\/(.+?)\] (.*)$")
        .ok()?
        .captures(line)?;
    let timestamp = captures.get(1)?.as_str().to_string();
    let source = captures.get(2)?.as_str().to_string();
    let level = captures.get(3)?.as_str().to_lowercase();
    let message = captures.get(4)?.as_str().to_string();
    if !["info", "warn", "error", "debug"].contains(&level.as_str()) {
        return None;
    }
    if source != "app" && source != "proxy" {
        return None;
    }
    Some(LogEntry {
        timestamp,
        level,
        source,
        message,
    })
}

fn is_disabled_auth_file(file_name: &str) -> bool {
    let normalized = file_name.to_lowercase();
    normalized.ends_with(".disabled.json") || normalized.ends_with(".json.disabled")
}

fn to_enabled_auth_name(file_name: &str) -> String {
    let normalized = file_name.to_lowercase();
    if normalized.ends_with(".disabled.json") {
        return format!(
            "{}.json",
            &file_name[..file_name.len() - ".disabled.json".len()]
        );
    }
    if normalized.ends_with(".json.disabled") {
        return file_name[..file_name.len() - ".disabled".len()].to_string();
    }
    file_name.to_string()
}

fn to_disabled_auth_name(file_name: &str) -> String {
    if is_disabled_auth_file(file_name) {
        return file_name.to_string();
    }
    if file_name.to_lowercase().ends_with(".json") {
        return format!(
            "{}.disabled.json",
            &file_name[..file_name.len() - ".json".len()]
        );
    }
    format!("{file_name}.disabled")
}

fn strip_disabled_marker(file_name: &str) -> String {
    to_enabled_auth_name(file_name)
}

fn is_candidate_auth_file_name_v2(file_name: &str) -> bool {
    let normalized = file_name.to_lowercase();
    if normalized == "gui-state.json"
        || normalized == "package.json"
        || normalized == "package-lock.json"
        || normalized.starts_with("_tmp_")
        || normalized.ends_with(".lock.json")
        || normalized.starts_with("tsconfig")
    {
        return false;
    }
    normalized.ends_with(".json")
        || normalized.ends_with(".disabled.json")
        || normalized.ends_with(".json.disabled")
}

fn normalize_remote_auth_file_base_name(value: Option<&Value>) -> Option<String> {
    let raw = normalized_string(value)?;
    let normalized = raw.replace('\\', "/");
    normalized
        .split('/')
        .next_back()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn is_remote_auth_file_disabled(entry: &Value) -> bool {
    read_bool(entry.get("disabled"), false)
        || read_bool(
            entry.get("is_disabled").or_else(|| entry.get("isDisabled")),
            false,
        )
        || matches!(
            normalized_string(entry.get("status"))
                .map(|value| value.to_lowercase())
                .as_deref(),
            Some("disabled") | Some("inactive") | Some("suspended")
        )
}

fn resolve_inside_directory(directory: &Path, file_name: &str) -> Result<PathBuf> {
    let base = directory
        .canonicalize()
        .unwrap_or_else(|_| directory.to_path_buf());
    let target = directory.join(file_name);
    let target = target.canonicalize().unwrap_or(target);
    if target != base && !target.starts_with(&base) {
        return Err(anyhow!("目标文件不在允许的目录内。"));
    }
    Ok(target)
}

fn infer_state_from_url(auth_url: &str) -> Option<String> {
    Url::parse(auth_url)
        .ok()?
        .query_pairs()
        .find_map(|(key, value)| (key == "state").then(|| value.to_string()))
}

fn regex_capture(text: &str, pattern: &str) -> Option<String> {
    regex::Regex::new(pattern)
        .ok()?
        .captures(text)?
        .get(1)
        .map(|value| value.as_str().trim().to_string())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn timestamp_ms_to_iso(timestamp_ms: i64) -> String {
    Utc.timestamp_millis_opt(timestamp_ms)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn system_time_to_iso(value: Option<SystemTime>) -> Option<String> {
    value
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| timestamp_ms_to_iso(duration.as_millis() as i64))
}

fn system_time_to_millis(value: Option<SystemTime>) -> Option<u64> {
    value
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn newer_iso(left: Option<String>, right: Option<String>) -> bool {
    parse_usage_timestamp(left) > parse_usage_timestamp(right)
}

fn parse_usage_timestamp(value: Option<String>) -> Option<i64> {
    let value = value?;
    chrono::DateTime::parse_from_rfc3339(&value)
        .map(|value| value.timestamp_millis())
        .ok()
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(&value, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|value| Utc.from_utc_datetime(&value).timestamp_millis())
        })
}

fn format_usage_bucket_label(timestamp_ms: i64, granularity: &str) -> String {
    let date_time = Utc
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .unwrap_or_else(Utc::now);
    if granularity == "hour" {
        date_time.format("%m/%d %H:00").to_string()
    } else {
        date_time.format("%m/%d").to_string()
    }
}

fn normalize_yaml_path(input_path: &Path) -> String {
    input_path.to_string_lossy().replace('\\', "/")
}

fn ensure_trailing_newline(content: String) -> String {
    if content.ends_with('\n') {
        content
    } else {
        format!("{content}\n")
    }
}

fn clamp_port(value: u16) -> u16 {
    value.clamp(1, 65535)
}

fn clamp_non_negative_integer(value: i64) -> i64 {
    value.max(0)
}

fn is_hashed_management_api_key(value: &str) -> bool {
    regex::Regex::new(r"^\$2[aby]\$\d{2}\$")
        .ok()
        .map(|regex| regex.is_match(value.trim()))
        .unwrap_or(false)
}

fn normalized_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Some(Value::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn read_string(value: Option<&Value>, fallback: &str) -> String {
    normalized_string(value).unwrap_or_else(|| fallback.to_string())
}

fn read_string_from_candidates(
    payload: &Value,
    candidates: &[&str],
    fallback: &str,
) -> Option<String> {
    for candidate in candidates {
        if let Some(value) = normalized_string(payload.get(*candidate)) {
            return Some(value);
        }
    }
    (!fallback.is_empty()).then(|| fallback.to_string())
}

fn read_bool(value: Option<&Value>, fallback: bool) -> bool {
    match value {
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(value)) => value.as_i64().map(|value| value != 0).unwrap_or(fallback),
        Some(Value::String(value)) => match value.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "y" | "on" => true,
            "false" | "0" | "no" | "n" | "off" => false,
            _ => fallback,
        },
        _ => fallback,
    }
}

fn normalized_bool(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::Number(value)) => value.as_i64().map(|value| value != 0),
        Some(Value::String(value)) => match value.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "y" | "on" => Some(true),
            "false" | "0" | "no" | "n" | "off" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn normalize_flag_value(value: Option<&Value>) -> Option<bool> {
    normalized_bool(value)
}

fn read_number(value: Option<&Value>, fallback: f64) -> f64 {
    normalized_number(value).unwrap_or(fallback)
}

fn normalized_number(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(value)) => value.as_f64(),
        Some(Value::String(value)) => value.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn normalized_quota_fraction(value: Option<&Value>) -> Option<f64> {
    if let Some(value) = normalized_number(value) {
        return Some(value);
    }
    if let Some(text) = normalized_string(value) {
        if let Some(stripped) = text.strip_suffix('%') {
            return stripped
                .trim()
                .parse::<f64>()
                .ok()
                .map(|value| value / 100.0);
        }
    }
    None
}

fn normalize_auth_index(value: Option<&Value>) -> Option<String> {
    normalized_string(value)
}

fn first_finite_number(values: &[Option<&Value>]) -> Option<f64> {
    values
        .iter()
        .filter_map(|value| normalized_number(*value))
        .find(|value| value.is_finite())
}

fn dedupe_strings(values: &[Option<String>]) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for value in values.iter().flatten() {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            result.push(trimmed.to_string());
        }
    }
    result
}

fn array(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

fn object(value: Option<&Value>) -> Map<String, Value> {
    value
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn root_object_mut(value: &mut Value) -> Result<&mut Map<String, Value>> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value
        .as_object_mut()
        .ok_or_else(|| anyhow!("config root must be an object"))
}

fn ensure_object_mut<'a>(
    object: &'a mut Map<String, Value>,
    key: &str,
) -> &'a mut Map<String, Value> {
    let value = object
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value.as_object_mut().unwrap()
}

fn ensure_array_mut<'a>(object: &'a mut Map<String, Value>, key: &str) -> &'a mut Vec<Value> {
    let value = object
        .entry(key.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !value.is_array() {
        *value = Value::Array(Vec::new());
    }
    value.as_array_mut().unwrap()
}

fn ensure_array_mut_value<'a>(value: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    let object = value.as_object_mut().unwrap();
    ensure_array_mut(object, key)
}

fn normalize_header_entries(value: Option<&Value>) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for entry in array(value) {
        let key = normalized_string(entry.get("key"));
        let header_value = normalized_string(entry.get("value"));
        if let (Some(key), Some(header_value)) = (key, header_value) {
            result.insert(key, header_value);
        }
    }
    result
}

fn read_header_entries(value: Option<&Value>) -> Value {
    let mut entries = object(value)
        .into_iter()
        .filter_map(|(key, value)| {
            normalized_string(Some(&value)).map(|value| json!({ "key": key, "value": value }))
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| read_string(entry.get("key"), ""));
    Value::Array(entries)
}

fn build_headers_object(value: Option<&Value>) -> Value {
    let normalized = normalize_header_entries(value);
    if normalized.is_empty() {
        Value::Null
    } else {
        Value::Object(
            normalized
                .into_iter()
                .map(|(key, value)| (key, Value::String(value)))
                .collect(),
        )
    }
}

fn normalize_provider_models(value: Option<&Value>) -> Value {
    let mut deduped = BTreeMap::<String, Value>::new();
    for model in array(value) {
        let name = normalized_string(model.get("name"));
        let alias = normalized_string(model.get("alias")).or_else(|| name.clone());
        if let (Some(name), Some(alias)) = (name, alias) {
            deduped.insert(
                alias.to_lowercase(),
                json!({
                  "alias": alias,
                  "name": name,
                }),
            );
        }
    }
    Value::Array(deduped.into_values().collect())
}

fn read_string_array(value: Option<&Value>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for item in array(value) {
        if let Some(item) = normalized_string(Some(&item)) {
            let dedupe_key = item.to_lowercase();
            if seen.insert(dedupe_key) {
                result.push(item);
            }
        }
    }
    result
}

fn read_provider_api_key_entries(value: Option<&Value>) -> Value {
    Value::Array(
        array(value)
            .iter()
            .filter_map(|entry| {
                let api_key = normalized_string(entry.get("api-key"))?;
                Some(json!({
                  "apiKey": api_key,
                  "proxyUrl": read_string(entry.get("proxy-url"), ""),
                  "headers": read_header_entries(entry.get("headers")),
                }))
            })
            .collect(),
    )
}

fn build_provider_api_key_entries(value: Option<&Value>) -> Vec<Value> {
    array(value)
        .into_iter()
        .filter_map(|entry| {
            let api_key = normalized_string(entry.get("apiKey"))?;
            Some(json!({
              "api-key": api_key,
              "proxy-url": normalized_string(entry.get("proxyUrl")),
              "headers": build_headers_object(entry.get("headers")),
            }))
        })
        .collect()
}

fn parse_object_like_value(value: &Value) -> Option<Value> {
    if value.is_object() {
        return Some(value.clone());
    }
    let text = normalized_string(Some(value))?;
    if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
        if parsed.is_object() {
            return Some(parsed);
        }
    }
    let segments = text.split('.').collect::<Vec<_>>();
    if segments.len() < 2 {
        return None;
    }
    let decoded = URL_SAFE.decode(segments[1]).ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    let parsed = serde_json::from_str::<Value>(&decoded).ok()?;
    parsed.is_object().then_some(parsed)
}

fn parse_object_like_value_ref(value: &Value) -> Option<Value> {
    parse_object_like_value(value)
}

fn read_u16(value: u64, fallback: u16) -> u16 {
    u16::try_from(value).unwrap_or(fallback)
}
