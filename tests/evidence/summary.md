# TXT 阅读器 · 真实 Edge 回归测试结果

- 时间：2026-10-31T01:36:01.036Z → 2026-10-31T01:36:07.390Z
- 浏览器：Microsoft Edge 156.0.4314.42（C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe）
- 模式：Playwright headless=true，viewport 1440x900
- 页面：http://127.0.0.1:51948/index.html
- 结果：**17 通过 / 0 失败**
- 页面异常：0；控制台 error：0

| # | 测试项 | 结果 | 详情 |
|---:|---|---|---|
| 1 | 初始空状态与编码控件 | 通过 | 空状态、标题、进度、禁用状态正确 |
| 2 | 扩展清单字段符合约定 | 通过 | id/name/version/entry/fileTypes/enabled 均符合约定 |
| 3 | 文件选择按钮打开 UTF-8 中文并显示段落 | 通过 | 文件选择器 → FileReader → UTF-8 解码 → 多段渲染成功 |
| 4 | UTF-8 BOM 自动识别并去除 BOM | 通过 | UTF-8 BOM 被识别并从正文剥离 |
| 5 | GB18030 自动识别 | 通过 | 自动检测为 GB18030/GBK，中文显示正常 |
| 6 | 编码手动覆盖：UTF-8 失败提示后恢复 GB18030 | 通过 | 错误提示明确；回退到 GB18030 后正文恢复并标记手动编码 |
| 7 | UTF-16LE BOM 自动识别 | 通过 | BOM 识别为 UTF-16LE，中文显示正常 |
| 8 | UTF-16BE BOM 自动识别（附测） | 通过 | BOM 识别为 UTF-16BE，中文显示正常 |
| 9 | 二进制内容被拦截且页面保持可用 | 通过 | PNG 签名被识别为二进制，提示清楚且未崩溃 |
| 10 | 空 TXT 被拦截且提示可读 | 通过 | 空文件给出明确提示，未崩溃 |
| 11 | 拖放路径：DataTransfer 中的 TXT 可打开 | 通过 | 页面内构造 DataTransfer + File 触发 drop 路径成功（非操作系统原生鼠标拖拽） |
| 12 | 阅读设置：字号、行距、宽度、深浅主题、减少动画、页码开关 | 通过 | 字号 30px、行距 2.3、宽 1100px、浅色主题、减少动画、页码开关与 Esc 关闭均通过 |
| 13 | 键盘滚动与输入控件焦点不抢键 | 通过 | PageDown/PageUp/Space/ArrowDown 均生效；range 获得焦点时 PageDown 仍滚动正文；Esc 生效 |
| 14 | 阅读位置按文件名+大小+时间保存并在重选后恢复 | 通过 | 位置键含文件名/大小/时间；保存 0.450，恢复 0.450；字符偏移 316；回到开头有效 |
| 15 | 按钮 Tab 焦点顺序 | 通过 | restartBtn → settingsBtn → openBtn 可通过 Tab 到达 |
| 16 | file:// 直接打开原型并读取 TXT | 通过 | file:///D:/Temp/Lyra-Extension-Txt/index.html 可直接加载，并成功打开 UTF-8 TXT |
| 17 | 无页面异常或控制台 error | 通过 | 0 个 uncaught pageerror、0 个 console.error |

## 截图

- [tests/evidence/01-empty-state.png](01-empty-state.png)
- [tests/evidence/02-utf8-reader.png](02-utf8-reader.png)
- [tests/evidence/03-binary-error.png](03-binary-error.png)
- [tests/evidence/04-light-theme-settings.png](04-light-theme-settings.png)
- [tests/evidence/05-light-reader.png](05-light-reader.png)
- [tests/evidence/06-file-url.png](06-file-url.png)

## 页面异常

- 无

## 控制台 error

- 无
