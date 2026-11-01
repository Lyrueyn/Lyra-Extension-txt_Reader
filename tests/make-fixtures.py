#!/usr/bin/env python3
"""Generate deterministic TXT fixtures for the Edge regression tests.

No third-party packages. Windows Python's built-in codecs provide GB18030.
"""
from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
FIXTURES.mkdir(parents=True, exist_ok=True)

PARAGRAPHS = [
    "这是璃鸢镜 TXT 阅读器的本地样张。所有文字只在浏览器中读取，不会上传到网络。",
    "窗口里应该有清楚的标题、段落和阅读进度。滚动时，状态栏百分比会跟着变化。",
    "阅读设置可以调整字号、行距和内容宽度；深浅主题与减少动画也在这里切换。",
    "如果这是一段足够长的文字，读者可以用 PageDown、PageUp、空格和方向键移动视野。",
    "璃鸢镜是一个在 Windows 上运行的主程序，网页扩展运行在它提供的 WebView2 宿主里。",
    "这个扩展没有 npm 依赖，也不需要联网。它只是一组可以直接在 Edge 打开的静态文件。",
    "测试会重新选择同一个文件，检查滚动比例和字符偏移有没有恢复到之前的位置。",
    "如果编码选错了，页面应该明确提示，而不是悄悄显示乱码或者让页面崩溃。",
    "文本文件可能来自不同的编辑器，UTF-8、GB18030 和带 BOM 的 UTF-16 都很常见。",
    "把小样张拖进窗口，或者点击打开按钮，效果应该保持一致。",
    "下面重复几段内容，让页面有足够的滚动空间。",
    "窗外的雨落在旧城区的屋檐上，声音很轻，像有人在远处翻动书页。",
    "桌灯下的纸页泛着淡淡的暖色，墨迹在光里沉下去，句子慢慢向前延伸。",
    "读到一半时停下来，下一次打开同一本书，最好还能回到刚才那一行。",
    "进度不只是页码，它也应该记得读者在长文里的位置。",
    "把设置面板关掉后，键盘仍然可以控制正文滚动，不需要先用鼠标点一下正文。",
    "按钮应该能用 Tab 聚焦，焦点边框要看得见，关闭设置面板要能按 Esc。",
    "选择文件之后，文件名会出现在顶部标题栏和正文页眉里。",
    "页面底部显示滚动百分比，并且可以按窗口高度估算当前页数。",
    "减少动画打开后，滚动和面板切换会立刻完成，不再等待过渡。",
]


def make_text(marker: str) -> str:
    lines = [
        f"璃鸢镜 TXT 阅读器 · {marker}",
        "",
        "第一章 灯下的长句",
        "",
    ]
    for index, paragraph in enumerate(PARAGRAPHS, 1):
        lines.append(f"{index:02d}. {paragraph}")
        lines.append("")
    lines.extend([
        "第二章 回到开头",
        "",
        "如果读到了这里，可以按「回到开头」按钮，或者把进度条重新滚回零。",
        "",
        f"样张结束标记：{marker} END",
        "",
    ])
    return "\n".join(lines)


def write_text(name: str, marker: str, encoding: str, bom: bytes = b"") -> None:
    data = bom + make_text(marker).encode(encoding)
    (FIXTURES / name).write_bytes(data)
    print(f"{name}: {len(data)} bytes ({encoding}{', BOM' if bom else ''})")


write_text("utf8-cn.txt", "UTF8-CN", "utf-8")
write_text("utf8-bom.txt", "UTF8-BOM", "utf-8", b"\xef\xbb\xbf")
write_text("gb18030-cn.txt", "GB18030-CN", "gb18030")
write_text("utf16le-bom.txt", "UTF16LE-BOM", "utf-16-le", b"\xff\xfe")
write_text("utf16be-bom.txt", "UTF16BE-BOM", "utf-16-be", b"\xfe\xff")

drop_text = "\n".join([
    "拖放路径样张 DRAG-DROP",
    "",
    "这一份文字只用于验证拖放打开 TXT 的路径。",
    "",
    "如果正文里能看到 DRAG-DROP，说明 File 对象从 DataTransfer 进入了阅读器。",
    "",
]) + "\n"
(FIXTURES / "drop-sample.txt").write_bytes(drop_text.encode("utf-8"))
print(f"drop-sample.txt: {(FIXTURES / 'drop-sample.txt').stat().st_size} bytes (utf-8)")

binary = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDAT\x78\x9c\x63\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)
(FIXTURES / "binary-sample.txt").write_bytes(binary)
print(f"binary-sample.txt: {len(binary)} bytes (PNG signature)")

(FIXTURES / "empty.txt").write_bytes(b"")
print("empty.txt: 0 bytes")
