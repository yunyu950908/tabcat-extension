# TabCat Extension

TabCat 是一个用于整理 Chrome 标签页的浏览器扩展。它可以一键把未分类标签页按域名归入 Chrome Tab Groups，也提供类似 Raycast 的悬浮式标签页搜索入口，方便在大量已打开标签页之间快速跳转。

当前项目基于 WXT、React 和 TypeScript 构建，目标是保持轻量、可配置、默认可用，并为后续的规则配置和 AI 辅助分组能力留出扩展空间。

## 功能概览

- 一键分组：把未分组标签页按 Root Domain 或 Hostname 聚合到 Chrome Tab Groups。
- 默认 Root Domain 分组：例如 `docs.google.com` 和 `drive.google.com` 默认会归入 `google.com`。
- Hostname 备选模式：可以在设置页改成按完整 hostname 分组。
- 自动加入已有分组：新页面加载完成后，如果存在唯一匹配分组，会自动加入该分组。
- 自动整理顺序：分组后把 grouped tabs 靠左、ungrouped tabs 靠右，并尽量保持原始相对顺序。
- 幂等分组：重复点击 Group tabs 时会复用/合并已有同域名分组，避免生成多个同名 group。
- 快速搜索跳转：使用快捷键唤起当前页面上的悬浮搜索框，过滤已打开 tabs，并用方向键/回车跳转。
- 分组可视化操作：支持 Collapse all、Expand all、Undo 和 Ungroup all。
- 配置页面：支持忽略域名、最小分组数量、窗口范围、固定标签页、规则命名/合并/忽略，以及配置导入导出。

<img width="1706" height="999" alt="image" src="https://github.com/user-attachments/assets/aa0f82ba-249d-45a2-b66c-5d39a7db28a5" />

<img width="1920" height="999" alt="image" src="https://github.com/user-attachments/assets/fcf088c8-7b46-4b22-986c-017fae5583e6" />

## 安装与本地加载

TabCat 目前以开发版方式加载。

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

### Popup 操作

点击 TabCat 图标会打开 popup：

- `Group tabs`：按当前配置分组未分类 tabs。
- `Collapse all`：折叠当前范围内的所有 tab groups。
- `Expand all`：展开当前范围内的所有 tab groups。
- `Undo`：撤销最近一次由 TabCat 创建/加入的分组操作。
- `Ungroup all`：拆散当前范围内的所有 tab groups。
- `Options`：打开设置页。

### 快捷键

默认快捷键定义在 manifest 中：

- `Ctrl+Shift+K`：打开 TabCat tab switcher。在 macOS 上 Chrome 会把 `Ctrl` 映射为 `Command`，实际体验通常是 `Cmd+Shift+K`。
- `Alt+Shift+G`：按当前配置执行 Group tabs。

Chrome 可能会因为已有快捷键冲突而不自动绑定。可以在 `chrome://extensions/shortcuts` 中查看或修改快捷键。

### Tab Switcher

Tab switcher 会优先作为当前页面上的悬浮搜索框打开：

- 输入关键字过滤已打开 tabs。
- 支持匹配标题、URL、hostname/root domain 和 group title。
- 使用 Up/Down 选择结果，Enter 跳转。
- Escape 关闭搜索框。
- 在 `chrome://` 等不能注入脚本的受限页面，会自动回退到独立 popup window。

## 设置说明

设置页可从 popup 的 `Options` 打开。

### Grouping

- `Grouping mode`
  - `Root domain`：默认模式，按根域名分组。
  - `Hostname`：按完整 hostname 分组。
- `Scope`
  - `Current window`：只处理当前窗口。
  - `All windows`：处理所有窗口。
- `Minimum group size`：只有达到该数量的未分组 tabs 才会创建新 group；如果已有匹配 group，单个新 tab 也可以加入。

### Behavior

- `Arrange grouped tabs to the left`：分组后整理顺序。
- `Auto group new tabs`：新 tab 加载后自动加入唯一匹配的已有 group。
- `Include pinned tabs`：允许固定标签页参与分组。
- `Collapse new groups`：新建/更新分组后自动折叠。

### Ignored domains

每行或用逗号分隔一个域名。被忽略域名不会参与自动分组或手动分组。

示例：

```txt
github.com
docs.google.com
localhost
```

### Rules

规则按从上到下执行：

- `Name`：匹配域名时只设置 group title。
- `Merge`：把多个匹配域名合并到一个自定义 group key/title。
- `Ignore`：跳过匹配域名。

匹配方式包括：

- `Exact`：精确匹配 hostname/root domain。
- `Root domain`：按 root domain 匹配。
- `Suffix`：按域名后缀匹配。

### Import / Export

设置页支持导出当前配置为 JSON，也支持导入 JSON 配置，便于迁移或备份。

## 开发

常用命令：

```sh
pnpm install
pnpm dev
pnpm compile
pnpm test
pnpm build
pnpm zip
```

说明：

- `pnpm dev`：启动 WXT 开发模式。
- `pnpm compile`：TypeScript 类型检查。
- `pnpm test`：运行 Vitest 单元测试。
- `pnpm build`：构建 Chrome MV3 版本到 `.output/chrome-mv3`。
- `pnpm zip`：生成可发布压缩包。

Firefox 相关脚本也保留在 `package.json` 中，但当前主要验证目标是 Chrome MV3。

## 项目结构

```txt
entrypoints/
  background.ts              # MV3 service worker, commands, auto group, overlay injection
  popup/                     # toolbar popup
  options/                   # settings page
  tab-switcher/              # restricted-page fallback switcher window
utils/
  settings.ts                # persisted settings and normalization
  tabGrouping.ts             # grouping, ungrouping, ordering, auto group logic
  tabGroupingMessages.ts     # popup-to-background grouping action messages
  tabSearch.ts               # tab search indexing, ranking, activation
docs/
  mvp-manual-qa.md           # manual QA checklist
```

## 权限与隐私

TabCat 当前使用以下 Chrome 权限：

- `tabs`：读取 tabs 的标题、URL、窗口和分组状态，并激活目标 tab。
- `tabGroups`：创建、更新、移动、折叠和展开 Chrome Tab Groups。
- `storage`：保存用户设置和最近一次分组操作。
- `scripting` + `activeTab`：用户触发 tab switcher 时，在当前活动页面临时注入悬浮搜索框。

隐私边界：

- 不声明 `host_permissions`。
- 不把 tab 标题、URL 或配置发送到外部服务。
- 当前版本不包含远程 LLM 调用。
- Tab switcher 的页面注入只在用户显式触发快捷键时发生。

## QA

自动检查：

```sh
pnpm compile
pnpm test
pnpm build
```

手动验证步骤见 [docs/mvp-manual-qa.md](docs/mvp-manual-qa.md)。

GitHub Actions 会在 pull request 和 push 到 `main` 时自动运行同一组检查。

## 发布 Artifact

发布通过 release PR 进入 `main`，合并后由 GitHub Actions 自动打 tag 和生成 artifact。

1. 从最新 `main` 切 release 分支，分支名使用 `release/vX.Y.Z`。
2. 使用封装好的 release script 升级版本号。
3. 提交并创建 PR。
4. PR 通过 CI 和 release version check 后合并到 `main`。
5. `main` 上检测到 `package.json` version 增加后，release artifact workflow 会自动验证、打 `vX.Y.Z` tag、执行 `pnpm zip` 并上传 GitHub Actions artifact。

示例：

```sh
git switch main
git pull --ff-only
git switch -c release/v0.1.0
pnpm release:minor
git add package.json
git commit -m "Release v0.1.0"
git push -u origin release/v0.1.0
```

可用的版本升级脚本：

- `pnpm release:patch`：例如 `0.1.0` -> `0.1.1`
- `pnpm release:minor`：例如 `0.1.0` -> `0.2.0`
- `pnpm release:major`：例如 `0.1.0` -> `1.0.0`

这些脚本已经固定 `--no-git-tag-version`，tag 由合并到 `main` 后的 workflow 创建。不要直接运行会自动打 tag 的 `pnpm version patch/minor/major`。

补发 artifact 时，也可以手动推送已有版本 tag 或在 GitHub Actions 中手动运行 release artifact workflow。当前 workflow 只上传 artifact，不自动创建 GitHub Release，也不自动发布到 Chrome Web Store。

## Troubleshooting

### `.output/chrome-mv3` 不存在

先执行：

```sh
pnpm build
```

### 快捷键没有生效

打开 `chrome://extensions/shortcuts`，确认 TabCat 的快捷键是否被 Chrome 注册。如果冲突，可以手动换成其他组合。

### 悬浮搜索框没有出现

在 `chrome://`、Chrome Web Store、扩展页面等受限页面，Chrome 不允许注入脚本。TabCat 会回退到独立 popup window。

### 分组结果与预期不一致

检查设置页中的：

- Grouping mode
- Scope
- Minimum group size
- Ignored domains
- Rules
- Include pinned tabs

修改设置后点击 Save，再重新执行 Group tabs。

## Roadmap

计划中的方向：

- 更细粒度的 domain/group 规则配置。
- 更完整的 tab switcher 操作能力。
- 可选的 AI 辅助分组、命名和内容分析。
- 更系统的手动 QA 和端到端验证流程。
