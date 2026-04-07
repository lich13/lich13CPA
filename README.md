# lich13CPA

`lich13CPA` 是一个基于 Electron + React + TypeScript 的 CLIProxyAPI 桌面壳，默认把 `proxy-config.yaml`、`gui-state.json`、认证文件目录和内嵌 `cli-proxy-api` 放在程序同路径附近管理。

## 目录

- `src/`：前端界面
- `electron/`：主进程、托盘、进程管理与本地配置落盘
- `embedded-binaries/`：内嵌 CLIProxyAPI 二进制
- `build/`：应用图标资源
- `scripts/`：构建、图标和最小编译包脚本

## 本地开发

```bash
npm ci
npm run dev:live
```

## Windows 打包

```bash
npm ci
npm run dist:win
```

输出：

- `release/lich13CPA-<version>-win-x64-setup.exe`
- `release/lich13CPA-<version>-win-arm64-setup.exe`

## macOS Apple Silicon 打包

前提：

- macOS Apple Silicon
- 原生 arm64 Node
- Node `20.19+` 或 `22.12+`
- Xcode Command Line Tools

先看 [`MAC_BUILD_COMMANDS.txt`](./MAC_BUILD_COMMANDS.txt)。

最稳的默认命令是只生成 arm64 zip：

```bash
npm ci
npm run dist:mac
```

如果要额外生成 DMG：

```bash
npm run dist:mac:dmg
```

说明：

- `npm run dist:mac` 现在默认只跑 `zip`，避免 electron-builder 在下载 DMG 辅助工具时卡死。
- `scripts/prepare-mac-build.mjs` 会在打包前校验 Node 版本、CPU 架构、Xcode CLT、图标尺寸和内嵌 mac 二进制权限。
- mac 产物默认是 ad-hoc 签名，适合本地使用和自测；如果要对外分发，仍需你自己的 Apple Developer 证书和 notarization。

## 导出 mac 最小编译包

在 Windows 或当前开发机上执行：

```bash
node scripts/create-mac-minimal-package.mjs
```

默认输出到仓库外同级目录：

- `../lich13CPA-<version>-mac-build-minimal`
- `../lich13CPA-<version>-mac-build-minimal.zip`

这个最小包只保留 mac 构建需要的源码、配置和 `embedded-binaries/mac-arm64/cli-proxy-api`。

