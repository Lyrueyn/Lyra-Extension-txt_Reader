# TXT 阅读器 0.1.1（璃鸢镜网页扩展）

这是一个纯前端 TXT 阅读器扩展，采用璃鸢镜网页扩展的目录与清单格式。它不需要 npm，不联网，不上传文件。

- 扩展 ID：`txt`
- 入口：`index.html`
- 声明文件类型：`.txt`
- 运行方式：静态文件；可由璃鸢镜扩展中心安装，也可直接用 Edge 打开
- 当前版本：**0.1.1**

## 在璃鸢镜中使用

安装扩展后，左侧栏会出现 **TXT** Tab：

- 「打开 TXT 文件」直接打开，不复制文件。
- 「添加 TXT 文件」复制到 `data/txt_library`，可留在 TXT 书库中反复打开。
- 从书库卡片打开时，宿主会把文件复制到临时目录，并通过 `?file=document.txt&name=<真实文件名>&mtime=<毫秒时间戳>` 传给扩展；扩展自动加载，不需要再手选一次。
- 加载完成/失败后扩展会发 `{ type: "lyra-book-ready" }`，宿主关闭加载遮罩。
- 阅读位置仍保存在扩展固定虚拟域名下的 localStorage 中。


## 在 Edge 中打开

### 方式一：直接打开本地文件（已验证）

双击 `index.html`，或在 PowerShell 中运行：

```powershell
start msedge "file:///D:/Temp/Lyra-Extension-Txt/index.html"
```

打开后点击「打开 TXT」选择本地文件。`file://` 路径已经过实际 Edge 测试；如果浏览器对 `file://` 来源的 localStorage 策略有差异，推荐使用下面的 HTTP 方式。

### 方式二：本地 HTTP（推荐，来源固定）

```powershell
cd D:\Temp\Lyra-Extension-Txt
python -m http.server 8899
start msedge "http://127.0.0.1:8899/index.html"
```

不需要安装任何包；只需要 Python 附带的 `http.server`。也可以使用任意静态文件服务器，但要保持页面 URL 的来源稳定，否则浏览器会按来源隔离 localStorage。

## 已实现

- 文件选择按钮和窗口拖放，只接受 `.txt`。
- 宿主传入文件：读取 `file` / `path` 查询参数，用 fetch 读取宿主临时文件并自动打开；加载完成/失败后发 `lyra-book-ready`。
- `FileReader` 读取 ArrayBuffer，`TextDecoder` 解码。
- 自动编码识别：
  - UTF-8（包括 UTF-8 BOM）；
  - UTF-16LE / UTF-16BE（BOM）；
  - 无 BOM 时先严格尝试 UTF-8，再在浏览器支持时严格尝试 GB18030（覆盖 GBK）。
- 顶部编码下拉可手动覆盖；切换失败时保留当前正文并显示原因，不会崩溃或静默乱码。
- 二进制拦截：常见文件签名（PNG/JPEG/PDF/ZIP/GIF/RAR/7z/ELF）+ 解码后的控制字符检查；空文件也会明确提示。
- 标题栏、正文页眉显示文件名；空状态、状态栏、错误条和 Toast 提示。
- 阅读排版：字号 14–32px、行距 1.4–2.6、内容宽度 600–1400px。
- 深色/浅色主题、减少动画开关、页码估算开关。
- 滚动进度百分比；页码只是按窗口高度估算的「第 X / Y 页」，不会强制分页。
- 阅读位置按「文件名 + 字节数 + 最后修改时间」保存在 localStorage，同时保存滚动比例和字符偏移；重新选择同一文件时恢复。提供「回到开头」。
- 键盘：PageDown/PageUp、空格、方向键滚动；Esc 关闭设置面板；输入控件聚焦时不会阻断翻屏快捷键。
- 原生按钮、Tab 焦点顺序、`aria-expanded`、可见焦点环。

### 编码细节

自动模式不会尝试无 BOM 的 UTF-16；这类文件可以在编码下拉中手动选择 UTF-16LE/BE。GBK 文本使用 `gb18030` 解码器读取（GB18030 是 GBK 的超集）。如果浏览器不支持对应解码器，该选项会被禁用，并给出提示。

### 阅读位置存储

- 位置键：`lyra-txt-position:v1:<encodeURIComponent(文件名)>:<字节数>:<最后修改时间>`
- 值包含：`fileName`、`size`、`lastModified`、`scrollRatio`、`charOffset`、`updatedAt`
- 阅读偏好键：`lyra-txt-prefs:v1`

不依赖随机域名，也不在宿主 localStorage 之外另造存储。璃鸢镜宿主按扩展 ID 使用固定虚拟域名（`lyra-ext-txt.local`），只要 ID 不变，WebView2 内的来源就稳定。

### 键盘速查

| 按键 | 行为 |
|---|---|
| PageDown / PageUp | 向下/向上翻一屏 |
| 空格 | 向下翻一屏（按钮、选择框等原生控件聚焦时保留原生行为） |
| ↑ ↓ ← → | 小步滚动（range/select 聚焦时保留控件自身方向键行为） |
| Esc | 关闭阅读设置面板 |

## 目录结构

```
extension.json             璃鸢镜扩展清单
index.html                 界面结构
reader.js                  读取、解码、排版、状态、键盘与拖放
reader.css                 深/浅主题和响应式界面
README.md                  本说明
SHA256SUMS.txt             所有文件的 SHA-256（清单文件自身除外）
tests/
  edge-regression.cjs      Playwright + 真实 Edge 回归脚本，自动启动本地 HTTP 服务
  make-fixtures.py         生成 UTF-8/GB18030/UTF-16/BOM/二进制样张
  fixtures/                测试样张（运行扩展不需要）
  evidence/                summary.json / summary.md 与实拍截图（运行扩展不需要）
```

扩展运行时只依赖四个文件：`extension.json`、`index.html`、`reader.js`、`reader.css`。`tests/` 不参与扩展运行。

## 测试

### 实际运行

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\Administrator\deepseek-harness\node_modules\.pnpm\playwright@1.61.1\node_modules\playwright'
$env:LYRA_BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
python .\tests\make-fixtures.py
node .\tests\edge-regression.cjs
```

结果写入 [`tests/evidence/summary.json`](tests/evidence/summary.json) 和 [`tests/evidence/summary.md`](tests/evidence/summary.md)，截图也在 `tests/evidence/`。

### 本次结果

- 浏览器：Microsoft Edge **156.0.4314.42**，通过 Playwright 1.61.1 启动真实 `msedge.exe`，headless=true。
- 环境：Windows，Node v24.18.0，viewport 1440×900。
- **17 项通过，0 项失败；0 个未捕获页面异常，0 个 console.error。**
- 测试页面：本地 HTTP 服务（自动分配端口）和 `file:///D:/Temp/Lyra-Extension-Txt/index.html` 两种来源。
- 覆盖：清单字段、UTF-8、UTF-8 BOM、GB18030、手动编码覆盖、UTF-16LE/BE BOM、二进制、空文件、文件选择器、拖放事件、设置项、浅色主题、键盘、Tab、滚动位置保存/恢复、回到开头。

测试的真实性边界：

- 使用的是本机 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，但以 headless 方式运行；没有在可见窗口中人工点击。
- 文件选择路径是真实的 `<input type="file">` 加 Chromium file chooser；不是仅调用内部函数。
- 拖放测试通过页面内构造 `DataTransfer + File` 并派发 `dragenter/dragover/drop`，验证了页面 drop 处理与 FileReader 链路；Playwright 无法模拟从 Windows 资源管理器拖入的真实系统拖拽。
- **已**在璃鸢镜 1.1.16 的 WebView2 宿主中运行：主窗口 TXT Tab → 书库卡片 → 自动传入 `document.txt` 并渲染正文；扩展加载层正常收尾，无控制台错误。
- 宿主注入路径、`mtime` 查询参数与 `lyra-book-ready` 生命周期已实际验证。

### 已知限制

- 所有段落一次性渲染进 DOM，没有虚拟滚动；超大 TXT 可能占用较多内存、首次排版变慢。
- 二进制判断是实用启发式，不是完整 MIME 识别；没有已知签名、也没有控制字符的罕见二进制可能被当成文本。
- 没有全文搜索、目录、书签、导出、跨窗口同步；这些不在当前版本范围。
- 中文竖排、图文混排、Markdown 渲染不支持，本次只做纯文本。
- 无 BOM 的 UTF-16 不会自动识别，需要手动选择。

## 璃鸢镜宿主接入（0.1.1 已完成）

本次已把 TXT 接入主程序本体：

- `MainWindow.xaml`：新增 `TxtNav` 侧栏按钮和 `TxtPanel`，只有安装并启用 TXT 扩展后才显示。
- `MainWindow.xaml.cs`：新增 TXT 书库（`data/txt_library.json` / `data/txt_library`）、打开/添加文件、书库卡片、`AvailableExtensions` 安装项和扩展更新检查。
- `ExtensionHostWindow.xaml.cs`：识别 `.txt`，把文件复制成临时目录里的 `document.txt`，通过 `?file=document.txt&name=…&mtime=…` 传入，并继续使用固定的 `lyra-ext-txt.local` 虚拟域名。
- 扩展侧：`openHostedFile()` 读取宿主的 `file` 参数，`lyra-book-ready` 通知宿主关闭加载遮罩。

已验证：主程序 TXT Tab → 书库卡片 → WebView2 扩展自动加载 `host-test.txt`，正文、编码、状态栏正常，无未捕获异常。

尚未做：Windows 文件关联/双击 TXT 直接启动、全文搜索、目录、书签、跨窗口实时同步。这些属于后续增强，不影响当前 TXT 阅读和书库流程。