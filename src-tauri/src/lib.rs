mod commands;
mod runtime;

use anyhow::Result;
use tauri::{
    menu::{Menu, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Listener, Manager, WindowEvent,
};
#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
use tauri_plugin_autostart::Builder as AutostartBuilder;
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;

use runtime::{Backend, STATE_CHANGED_EVENT};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main-tray";
const TRAY_SHOW_ID: &str = "tray.show";
const TRAY_START_PROXY_ID: &str = "tray.startProxy";
const TRAY_STOP_PROXY_ID: &str = "tray.stopProxy";
const TRAY_QUIT_ID: &str = "tray.quit";
const OAUTH_CALLBACK_SCHEME: &str = "lich13cpa";
const OAUTH_CALLBACK_PATH: &str = "/oauth/callback";

fn build_autostart_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    #[cfg(target_os = "macos")]
    {
        AutostartBuilder::new()
            .app_name("lich13CPA")
            .macos_launcher(MacosLauncher::LaunchAgent)
            .build()
    }

    #[cfg(not(target_os = "macos"))]
    {
        AutostartBuilder::new().app_name("lich13CPA").build()
    }
}

fn reveal_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        window.show()?;
        window.set_focus()?;
    }

    let backend = app.state::<Backend>();
    let _ = sync_tray(app, &backend);
    Ok(())
}

fn handle_deep_link<R: tauri::Runtime>(app: &tauri::AppHandle<R>, urls: Vec<url::Url>) {
    let backend = app.state::<Backend>();

    for url in urls {
        if url.scheme() != OAUTH_CALLBACK_SCHEME || url.path() != OAUTH_CALLBACK_PATH {
            continue;
        }

        let params = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        let Some(state) = params.get("state") else {
            continue;
        };

        let Some(pending) = backend.pending_oauth() else {
            continue;
        };

        if pending.state != state.as_ref() {
            continue;
        }

        backend.emit_oauth_callback(&pending.provider, &pending.state, url.as_str());
        let _ = reveal_main_window(app);
    }
}

fn main_window_visible<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

fn build_tray_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    backend: &Backend,
) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    let show = MenuItemBuilder::with_id(
        TRAY_SHOW_ID,
        if main_window_visible(app) {
            "隐藏窗口"
        } else {
            "显示窗口"
        },
    )
    .build(app)?;
    let start = MenuItemBuilder::with_id(TRAY_START_PROXY_ID, "启动代理")
        .enabled(!backend.proxy_running())
        .build(app)?;
    let stop = MenuItemBuilder::with_id(TRAY_STOP_PROXY_ID, "停止代理")
        .enabled(backend.proxy_running())
        .build(app)?;
    let quit = MenuItemBuilder::with_id(TRAY_QUIT_ID, "停止代理并退出").build(app)?;

    menu.append(&show)?;
    menu.append(&start)?;
    menu.append(&stop)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn sync_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>, backend: &Backend) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(build_tray_menu(app, backend)?))?;
        let tooltip = if backend.proxy_running() {
            format!("lich13CPA - 代理运行中 ({})", backend.proxy_port())
        } else {
            "lich13CPA - 代理未启动".to_string()
        };
        tray.set_tooltip(Some(tooltip))?;
    }
    Ok(())
}

fn build_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>, backend: Backend) -> Result<()> {
    let menu = build_tray_menu(app, &backend)?;
    let menu_backend = backend.clone();
    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("lich13CPA")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => {
                if main_window_visible(app) {
                    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                        let _ = window.hide();
                    }
                    let backend = app.state::<Backend>();
                    let _ = sync_tray(app, &backend);
                } else {
                    let _ = reveal_main_window(app);
                }
            }
            TRAY_START_PROXY_ID => {
                let backend = menu_backend.clone();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = backend.start_proxy().await {
                        eprintln!("failed to start proxy from tray: {error}");
                    }
                    let _ = sync_tray(&app_handle, &backend);
                });
            }
            TRAY_STOP_PROXY_ID => {
                let backend = menu_backend.clone();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = backend.stop_proxy().await {
                        eprintln!("failed to stop proxy from tray: {error}");
                    }
                    let _ = sync_tray(&app_handle, &backend);
                });
            }
            TRAY_QUIT_ID => {
                let backend = menu_backend.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = backend.stop_proxy_and_quit().await {
                        eprintln!("failed to stop proxy and quit from tray: {error}");
                    }
                });
            }
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = reveal_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;
    sync_tray(app, &backend)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(build_autostart_plugin())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let urls = args
                .iter()
                .filter_map(|arg| url::Url::parse(arg).ok())
                .collect::<Vec<_>>();
            if !urls.is_empty() {
                handle_deep_link(app, urls);
            } else {
                let _ = reveal_main_window(app);
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(ActivationPolicy::Accessory);
                app.set_dock_visibility(false);
            }
            let backend = Backend::new(app.handle().clone())?;
            app.manage(backend.clone());

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls().to_vec();
                    if !urls.is_empty() {
                        handle_deep_link(&handle, urls);
                    }
                });
            }

            let tray_app = app.handle().clone();
            let tray_backend = backend.clone();
            app.listen_any(STATE_CHANGED_EVENT, move |_| {
                let _ = sync_tray(&tray_app, &tray_backend);
            });
            build_tray(&app.handle(), backend.clone())?;
            tauri::async_runtime::block_on(backend.initialize())?;
            backend.restore_main_window_state();
            let _ = sync_tray(&app.handle(), &backend);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }

            let backend = window.app_handle().state::<Backend>();

            match event {
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                    backend.persist_main_window_state();
                }
                _ => {}
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                backend.persist_main_window_state();
                if !backend.quit_requested() && backend.minimize_to_tray_on_close() {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = sync_tray(&window.app_handle(), &backend);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::save_config_text,
            commands::save_known_settings,
            commands::start_proxy,
            commands::stop_proxy,
            commands::sync_runtime_config,
            commands::refresh_usage,
            commands::get_usage_summary,
            commands::get_provider_auth_url,
            commands::check_provider_auth_status,
            commands::check_proxy_binary_update,
            commands::check_app_update,
            commands::update_proxy_binary,
            commands::update_app,
            commands::pick_auth_files,
            commands::delete_auth_file,
            commands::toggle_auth_file,
            commands::get_auth_file_quota,
            commands::save_provider,
            commands::delete_provider,
            commands::save_ai_provider,
            commands::delete_ai_provider,
            commands::fetch_provider_models,
            commands::open_path,
            commands::open_external,
            commands::clear_logs,
            commands::stop_proxy_and_quit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
