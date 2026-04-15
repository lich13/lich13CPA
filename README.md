# lich13CPA

`lich13CPA` 是一个基于 Tauri 2 + React + TypeScript + Rust 的 CLIProxyAPI 桌面壳。

当前仓库已经收口为单一 Tauri 路线：

- 前端在 `src/`
- Rust 后端在 `src-tauri/src/`
- Tauri 构建默认会从 `router-for-me/CLIProxyAPI` 的最新 release 拉取对应目标平台二进制
- 拉取到的二进制会被放进 `src-tauri/resources/bin/`，并作为 Tauri bundle resource 一起打包
- 应用内可在设置页切换到 `CLIProxyAPIPlus` 通道，后续“检查更新 / 执行更新”会改走 Plus release

## 本地开发

```bash
npm ci
npm run tauri:dev
```

`tauri:dev` 会先为当前宿主机架构准备 CLIProxyAPI 二进制，再启动 Tauri 开发环境。

## 构建

```bash
npm run tauri:build:mac:arm64
npm run tauri:build:win:x64
npm run tauri:build:win:arm64
```

默认快捷入口：

```bash
npm run tauri:build
npm run tauri:build:debug
```

这两个默认都固定到 `aarch64-apple-darwin`，避免在 Apple Silicon 上因为 Node 进程架构导致产物命名混乱。

## 二进制打包策略

- 不再使用启动时按需下载作为默认路径
- 构建时必须先准备目标平台对应的 CLIProxyAPI 二进制
- 运行时会优先从包内 resource 目录和应用同目录搜索二进制
- 设置页的“更新 CLIProxyAPI”仍然保留，供手动更新使用

## CI

GitHub Actions 当前显式构建三个目标：

- `aarch64-apple-darwin`
- `x86_64-pc-windows-msvc`
- `aarch64-pc-windows-msvc`
