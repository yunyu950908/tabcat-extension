# TabCat Extension

TabCat 是一个隐私优先的 Chrome 标签页整理扩展。它可以把未分组标签页按域名归入 Chrome Tab Groups，也可以通过 `Cmd+Shift+K` 打开类似 Raycast 的标签页搜索入口，在大量已打开标签页之间快速跳转。

TabCat 基于 WXT、React 和 TypeScript 构建。当前版本专注本地整理、快速搜索和可配置规则，不包含远程 AI 调用，也不会主动把标签页标题、URL 或配置发送到外部服务。

## 核心功能

- 一键分组：把未分组标签页按 root domain 或完整 hostname 聚合到 Chrome Tab Groups。
- 自动加入已有分组：新页面加载完成后，如果存在唯一匹配分组，会自动加入该分组。
- 分组整理：支持把 grouped tabs 靠左、ungrouped tabs 靠右，并尽量保持原始相对顺序。
- 幂等操作：重复执行 Group tabs 会复用或合并已有同域名分组，避免生成多个同名 group。
- 快速搜索跳转：用 `Cmd+Shift+K` 打开悬浮搜索框，搜索标题、URL、域名和 group title。
- 分组操作：支持 Collapse all、Expand all、Undo 和 Ungroup all。
- 可配置规则：支持忽略域名、最小分组数量、窗口范围、固定标签页、规则命名/合并/忽略，以及配置导入导出。

## 示例

<img width="1706" height="999" alt="TabCat popup and tab grouping example" src="https://github.com/user-attachments/assets/aa0f82ba-249d-45a2-b66c-5d39a7db28a5" />

<img width="1920" height="999" alt="TabCat settings example" src="https://github.com/user-attachments/assets/fcf088c8-7b46-4b22-986c-017fae5583e6" />

## 隐私优先

TabCat 的默认边界是“只在浏览器本地工作”：

- 不声明 `host_permissions`，不会长期获得所有网站的访问权限。
- 不读取网页正文、DOM 内容、输入框、cookies 或网络请求。
- TabCat 自身不向任何外部服务上传 tab 标题、URL、favicon、group 信息或用户配置。
- 不包含远程 LLM、分析埋点或第三方数据同步逻辑。
- 设置写入 Chrome 提供的 `storage.sync`；是否跨设备同步由用户的 Chrome 同步策略决定。
- 最近一次分组操作只写入 `storage.session`，用于支持 Undo。

TabCat 使用的 Chrome 权限：

- `tabs`：读取 tab 标题、URL、favicon、窗口和分组状态，并激活目标 tab。
- `tabGroups`：创建、更新、移动、折叠和展开 Chrome Tab Groups。
- `storage`：保存用户设置和最近一次分组操作。
- `scripting` + `activeTab`：用户显式触发 tab switcher 时，在当前活动页面临时创建悬浮搜索入口。

## `Cmd+Shift+K` 的工作原理

快捷键默认在 manifest 中声明为 `Ctrl+Shift+K`；在 macOS 上，Chrome 通常会以 `Cmd+Shift+K` 的形式注册和展示。可以在 `chrome://extensions/shortcuts` 中查看或修改。

触发后流程如下：

1. Chrome 把 `open-tab-switcher` command 发送给 MV3 background service worker。
2. Background 查询当前活动 tab，并生成一次性的 overlay close token。
3. TabCat 优先通过 `activeTab` + `scripting` 在当前页面执行一小段脚本，只负责创建 Shadow DOM 容器和 extension iframe。
4. 真正的搜索界面运行在 TabCat 自己的 extension 页面里；它通过 `tabs` 和 `tabGroups` API 读取已打开 tabs，在本地内存中过滤、排序和展示结果。
5. 选中结果后，TabCat 只调用 `tabs.update` 和 `windows.update` 激活目标 tab/window。
6. 按 Escape、点击遮罩或跳转完成后，overlay 会通过带 token 的消息关闭。
7. 如果当前页是 `chrome://`、Chrome Web Store 等不允许脚本注入的受限页面，TabCat 会自动回退到独立 popup window。

这个设计的重点是：快捷键由 Chrome extension command 触发，不依赖网页里的全局键盘监听；页面注入只发生在用户按下快捷键之后，并且注入脚本不读取页面内容。

## TL;DR 安装（Release ZIP）

不想从源码构建时，直接使用 GitHub Release 里的 Chrome 扩展压缩包：

1. 打开 [TabCat latest release](https://github.com/yunyu950908/tabcat-extension/releases/latest)。
2. 下载最新 release assets 里的 `tabcat-extension-*-chrome.zip`。
3. 解压到一个长期保留的位置，例如 `~/Applications/TabCat` 或 `~/Downloads/tabcat-extension`。
4. 在 Chrome 打开 `chrome://extensions`。
5. 开启 Developer mode。
6. 点击 Load unpacked。
7. 选择刚才解压后的扩展目录，也就是包含 `manifest.json` 的目录。
8. 可选：把 TabCat 固定到浏览器工具栏。

可以把下面这段直接交给 LLM 或本机自动化 agent：

```text
请帮我安装 TabCat Chrome 扩展。打开 https://github.com/yunyu950908/tabcat-extension/releases/latest，下载最新 release assets 中名为 tabcat-extension-*-chrome.zip 的压缩包，解压到一个长期保留的位置，然后在 Chrome 的 chrome://extensions 页面开启 Developer mode，点击 Load unpacked，选择解压后包含 manifest.json 的目录。不要从源码构建，也不要运行 pnpm install/pnpm build；只使用 release zip 安装。安装完成后把 TabCat 固定到工具栏，并提醒我后续更新时需要重新下载新版 release zip、解压覆盖或换目录后在 chrome://extensions 中 reload。
```

注意：Chrome 不能直接安装未上架商店的 `zip`；需要先解压，再通过 Load unpacked 加载解压后的目录。

## 从源码本地加载

```sh
pnpm install
pnpm build
```

然后在 Chrome 中加载构建结果：

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择仓库里的 `.output/chrome-mv3` 目录。
5. 可选：把 TabCat 固定到浏览器工具栏。

每次代码更新后，重新执行 `pnpm build`，再在 `chrome://extensions` 中点击扩展的 reload。

## 使用方式

点击 TabCat 图标会打开 popup：

- `Group tabs`：按当前配置分组未分类 tabs。
- `Collapse all` / `Expand all`：折叠或展开当前范围内的 tab groups。
- `Undo`：撤销最近一次由 TabCat 创建或加入的分组操作。
- `Ungroup all`：拆散当前范围内的 tab groups。
- `Options`：打开设置页。

快捷键：

- `Cmd+Shift+K`：打开 tab switcher；Windows/Linux 默认通常为 `Ctrl+Shift+K`。
- `Alt+Shift+G`：按当前配置执行 Group tabs。

Tab switcher 支持：

- 搜索标题、URL、hostname/root domain 和 group title。
- 使用 Up/Down 选择结果，Enter 跳转。
- Escape 关闭搜索框。
- 在受限页面自动回退到独立 popup window。

## 设置

设置页可从 popup 的 `Options` 打开：

- `Grouping mode`：按 root domain 或完整 hostname 分组。
- `Scope`：处理当前窗口或所有窗口。
- `Minimum group size`：达到指定数量才创建新 group；已有匹配 group 时，单个新 tab 也可以加入。
- `Arrange grouped tabs to the left`：分组后整理顺序。
- `Auto group new tabs`：新 tab 加载后自动加入唯一匹配的已有 group。
- `Include pinned tabs`：允许固定标签页参与分组。
- `Collapse new groups`：新建或更新分组后自动折叠。
- `Ignored domains`：跳过指定域名。
- `Rules`：按顺序执行命名、合并或忽略规则，支持 exact、root domain 和 suffix 匹配。
- `Import / Export`：导入或导出 JSON 配置。

## 开发

常用命令：

```sh
pnpm dev
pnpm compile
pnpm test
pnpm build
pnpm zip
```

- `pnpm dev`：启动 WXT 开发模式。
- `pnpm compile`：TypeScript 类型检查。
- `pnpm test`：运行 Vitest 单元测试。
- `pnpm build`：构建 Chrome MV3 版本到 `.output/chrome-mv3`。
- `pnpm zip`：生成可发布压缩包。

手动验证步骤见 [docs/mvp-manual-qa.md](docs/mvp-manual-qa.md)。
