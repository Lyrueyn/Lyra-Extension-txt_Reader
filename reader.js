/* 璃鸢镜 · TXT 阅读器 0.1.0
   纯原生 JavaScript。文件只在浏览器本地读取，不上传。
   阅读位置按“文件名 + 字节数 + 最后修改时间”保存在 localStorage。 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const html = document.documentElement;

  const PREFS_KEY = "lyra-txt-prefs:v1";
  const POSITION_PREFIX = "lyra-txt-position:v1:";
  const TXT_FILE_RE = /\.txt$/i;

  const ENCODING_LABELS = {
    "utf-8": "UTF-8",
    "gb18030": "GB18030 / GBK",
    "utf-16le": "UTF-16LE",
    "utf-16be": "UTF-16BE"
  };

  const BINARY_SIGNATURES = [
    { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], name: "PNG 图片" },
    { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], name: "PDF 文档" },
    { bytes: [0x50, 0x4b, 0x03, 0x04], name: "ZIP 压缩包" },
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], name: "GIF 图片" },
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], name: "GIF 图片" },
    { bytes: [0xff, 0xd8, 0xff], name: "JPEG 图片" },
    { bytes: [0x7f, 0x45, 0x4c, 0x46], name: "ELF 可执行文件" },
    { bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], name: "RAR 压缩包" },
    { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], name: "7z 压缩包" }
  ];

  const systemReduceMotion = (() => {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch { return false; }
  })();

  const DEFAULT_PREFS = {
    fontSize: 20,
    lineHeight: 1.95,
    contentWidth: 860,
    theme: "dark",
    reduceMotion: systemReduceMotion,
    showPageEstimate: true
  };

  class TextFileError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "TextFileError";
      this.code = code || "TXT_READ_FAILED";
    }
  }

  const el = {
    toolbar: $("toolbar"),
    docTitle: $("docTitle"),
    fileInput: $("fileInput"),
    openBtn: $("openBtn"),
    emptyOpenBtn: $("emptyOpenBtn"),
    restartBtn: $("restartBtn"),
    settingsBtn: $("settingsBtn"),
    settingsPanel: $("settingsPanel"),
    settingsClose: $("settingsClose"),
    encodingSelect: $("encodingSelect"),
    emptyState: $("emptyState"),
    dropZone: $("dropZone"),
    readerView: $("readerView"),
    readerScroller: $("readerScroller"),
    readingPage: $("readingPage"),
    readingTitle: $("readingTitle"),
    fileMeta: $("fileMeta"),
    encodingChip: $("encodingChip"),
    readerContent: $("readerContent"),
    fontRange: $("fontRange"),
    fontValue: $("fontValue"),
    lineRange: $("lineRange"),
    lineValue: $("lineValue"),
    widthRange: $("widthRange"),
    widthValue: $("widthValue"),
    themeLight: $("themeLight"),
    themeDark: $("themeDark"),
    motionToggle: $("motionToggle"),
    pageEstimateToggle: $("pageEstimateToggle"),
    errorBanner: $("errorBanner"),
    errorText: $("errorText"),
    errorClose: $("errorClose"),
    statusText: $("statusText"),
    saveStateText: $("saveStateText"),
    pageText: $("pageText"),
    progressText: $("progressText"),
    progressFill: $("progressFill"),
    progressRail: $("progressRail"),
    dropOverlay: $("dropOverlay"),
    toast: $("toast")
  };

  const state = {
    file: null,
    bytes: null,
    text: "",
    decoded: null,
    decodeChoice: "auto",
    positionKey: "",
    paragraphCount: 0,
    ready: false,
    loadSeq: 0,
    decodeSeq: 0,
    renderSeq: 0,
    layoutSeq: 0,
    saveTimer: 0,
    saveStateTimer: 0,
    toastTimer: 0,
    suppressSave: false,
    dragDepth: 0,
    settingsOpen: false,
    prefs: null,
    gbSupported: supportsEncoding("gb18030"),
    utf16leSupported: supportsEncoding("utf-16le"),
    utf16beSupported: supportsEncoding("utf-16be")
  };

  function supportsEncoding(label) {
    try {
      new TextDecoder(label);
      return true;
    } catch {
      return false;
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatNumber(n) {
    try { return new Intl.NumberFormat("zh-CN").format(n); }
    catch { return String(n); }
  }

  function formatModified(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "未知时间";
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false
      }).format(new Date(n));
    } catch {
      return "未知时间";
    }
  }

  function isTxtFile(file) {
    return !!file && TXT_FILE_RE.test(String(file.name || ""));
  }

  function encodingLabel(choice) {
    if (choice === "auto") return "自动识别";
    return ENCODING_LABELS[choice] || String(choice || "");
  }

  function stripLeadingBom(text) {
    return text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function normalizeNewlines(text) {
    return text.replace(/\r\n?/g, "\n");
  }

  /* ---------------- 设置项 ---------------- */

  function loadPrefs() {
    const prefs = { ...DEFAULT_PREFS };
    let raw = null;
    try { raw = localStorage.getItem(PREFS_KEY); } catch { /* 文件来源不可用存储时保持默认值 */ }
    if (!raw) return prefs;

    try {
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return prefs;

      const font = Number(saved.fontSize);
      if (Number.isFinite(font)) prefs.fontSize = clamp(Math.round(font), 14, 32);

      const line = Number(saved.lineHeight);
      if (Number.isFinite(line)) prefs.lineHeight = clamp(Math.round(line * 20) / 20, 1.4, 2.6);

      const width = Number(saved.contentWidth);
      if (Number.isFinite(width)) prefs.contentWidth = clamp(Math.round(width / 20) * 20, 600, 1400);

      if (saved.theme === "light" || saved.theme === "dark") prefs.theme = saved.theme;
      if (typeof saved.reduceMotion === "boolean") prefs.reduceMotion = saved.reduceMotion;
      if (typeof saved.showPageEstimate === "boolean") prefs.showPageEstimate = saved.showPageEstimate;
    } catch {
      /* 损坏的偏好不阻塞阅读，静默回退默认值 */
    }
    return prefs;
  }

  function persistPrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); }
    catch { /* 阅读位置保存会单独给出提示，设置保存失败不打断阅读 */ }
  }

  function applyPrefs() {
    const prefs = state.prefs;
    html.dataset.theme = prefs.theme;
    html.classList.toggle("reduce-motion", !!prefs.reduceMotion);

    html.style.setProperty("--reader-font-size", prefs.fontSize + "px");
    html.style.setProperty("--reader-line-height", String(prefs.lineHeight));
    html.style.setProperty("--content-width", prefs.contentWidth + "px");

    el.fontRange.value = String(prefs.fontSize);
    el.fontValue.textContent = String(prefs.fontSize);
    el.lineRange.value = String(prefs.lineHeight);
    el.lineValue.textContent = prefs.lineHeight.toFixed(2);
    el.widthRange.value = String(prefs.contentWidth);
    el.widthValue.textContent = String(prefs.contentWidth);

    el.motionToggle.checked = !!prefs.reduceMotion;
    el.pageEstimateToggle.checked = !!prefs.showPageEstimate;

    const themeButtons = [
      [el.themeLight, "light"],
      [el.themeDark, "dark"]
    ];
    for (const [button, theme] of themeButtons) {
      const active = prefs.theme === theme;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }

    el.pageText.hidden = !state.ready || !prefs.showPageEstimate;
  }

  function applyTheme(theme) {
    if (theme !== "light" && theme !== "dark") return;
    if (state.prefs.theme === theme) return;
    state.prefs.theme = theme;
    persistPrefs();
    applyPrefs();
  }

  function setMotionPreference(enabled) {
    state.prefs.reduceMotion = !!enabled;
    persistPrefs();
    applyPrefs();
  }

  function setPageEstimatePreference(enabled) {
    state.prefs.showPageEstimate = !!enabled;
    persistPrefs();
    applyPrefs();
    updatePageEstimate();
  }

  function updateLayoutPreference(key, value) {
    const offset = state.ready ? captureCharOffset() : 0;
    state.prefs[key] = value;
    persistPrefs();
    applyPrefs();
    updatePageEstimate();
    if (!state.ready) return;

    const token = ++state.layoutSeq;
    afterNextLayout(() => {
      if (token !== state.layoutSeq || !state.ready) return;
      const top = scrollTopForCharOffset(offset);
      if (top != null) el.readerScroller.scrollTop = clamp(top, 0, maxScrollTop());
      updateProgress();
      updatePageEstimate();
    });
  }

  function setupEncodingOptions() {
    const gbOption = el.encodingSelect.querySelector('option[value="gb18030"]');
    if (!state.gbSupported && gbOption) {
      gbOption.disabled = true;
      gbOption.textContent = "GB18030 / GBK（不支持）";
    }
    const leOption = el.encodingSelect.querySelector('option[value="utf-16le"]');
    if (!state.utf16leSupported && leOption) {
      leOption.disabled = true;
      leOption.textContent = "UTF-16LE（不支持）";
    }
    const beOption = el.encodingSelect.querySelector('option[value="utf-16be"]');
    if (!state.utf16beSupported && beOption) {
      beOption.disabled = true;
      beOption.textContent = "UTF-16BE（不支持）";
    }
  }

  /* ---------------- 文件读取与解码 ---------------- */

  function readFileBuffer(file) {
    return new Promise((resolve, reject) => {
      let reader;
      try {
        reader = new FileReader();
      } catch {
        if (file && typeof file.arrayBuffer === "function") {
          file.arrayBuffer().then(resolve).catch(() => reject(new TextFileError("读取本地文件失败，请重试。", "READ_FAILED")));
          return;
        }
        reject(new TextFileError("当前浏览器不支持 FileReader，无法读取本地文件。", "READER_UNSUPPORTED"));
        return;
      }

      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new TextFileError("读取结果不是有效的二进制数据。", "READ_RESULT_INVALID"));
      };
      reader.onerror = () => {
        reject(new TextFileError("读取本地文件失败，请确认文件未被其他程序占用。", "READ_FAILED"));
      };
      reader.onabort = () => {
        reject(new TextFileError("文件读取被取消。", "READ_ABORTED"));
      };

      try {
        reader.readAsArrayBuffer(file);
      } catch {
        reject(new TextFileError("读取本地文件失败，请重试。", "READ_FAILED"));
      }
    });
  }

  function detectBom(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { encoding: "utf-8", offset: 3, label: "UTF-8 BOM" };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { encoding: "utf-16le", offset: 2, label: "UTF-16LE BOM" };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { encoding: "utf-16be", offset: 2, label: "UTF-16BE BOM" };
    }
    return null;
  }

  function detectKnownBinary(bytes) {
    for (const signature of BINARY_SIGNATURES) {
      if (bytes.length < signature.bytes.length) continue;
      let match = true;
      for (let i = 0; i < signature.bytes.length; i++) {
        if (bytes[i] !== signature.bytes[i]) { match = false; break; }
      }
      if (match) return signature.name;
    }
    return "";
  }

  function decodeStrict(bytes, encoding) {
    const decoder = new TextDecoder(encoding, { fatal: true });
    return decoder.decode(bytes);
  }

  function validateDecodedText(text) {
    if (!text || !text.trim()) {
      throw new TextFileError("文件里没有可阅读的文字（可能为空文件）。", "EMPTY_FILE");
    }

    const badControls = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g);
    if (badControls && badControls.length > 0) {
      throw new TextFileError("检测到二进制控制字符，这不是可阅读的纯文本 TXT。", "BINARY_FILE");
    }

    const replacements = (text.match(/\uFFFD/g) || []).length;
    if (replacements > 0) {
      throw new TextFileError("文本包含无法解码的字符，请尝试切换编码。", "DECODE_REPLACEMENT");
    }
  }

  function decodeBuffer(buffer, choice) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.byteLength === 0) {
      throw new TextFileError("文件里没有可阅读的文字（文件为空）。", "EMPTY_FILE");
    }

    const binaryName = detectKnownBinary(bytes);
    if (binaryName) {
      throw new TextFileError("检测到二进制内容（" + binaryName + "），这不是纯文本 TXT。请确认文件类型。", "BINARY_FILE");
    }

    const bom = detectBom(bytes);
    const auto = !choice || choice === "auto";

    if (!auto && !supportsEncoding(choice)) {
      throw new TextFileError("当前浏览器不支持 " + encodingLabel(choice) + " 解码。", "ENCODING_UNSUPPORTED");
    }

    if (auto && bom) {
      const text = decodeStrict(bytes.subarray(bom.offset), bom.encoding);
      validateDecodedText(text);
      return {
        text: normalizeNewlines(stripLeadingBom(text)),
        encoding: bom.encoding,
        label: ENCODING_LABELS[bom.encoding] || bom.encoding,
        bomLabel: bom.label,
        autoDetected: true,
        choice: "auto"
      };
    }

    if (auto) {
      let utf8Text = null;
      try { utf8Text = decodeStrict(bytes, "utf-8"); }
      catch { utf8Text = null; }
      if (utf8Text !== null) {
        validateDecodedText(utf8Text);
        return {
          text: normalizeNewlines(stripLeadingBom(utf8Text)),
          encoding: "utf-8",
          label: "UTF-8",
          bomLabel: "",
          autoDetected: true,
          choice: "auto"
        };
      }

      if (state.gbSupported) {
        let gbText = null;
        try { gbText = decodeStrict(bytes, "gb18030"); }
        catch { gbText = null; }
        if (gbText !== null) {
          validateDecodedText(gbText);
          return {
            text: normalizeNewlines(stripLeadingBom(gbText)),
            encoding: "gb18030",
            label: "GB18030 / GBK",
            bomLabel: "",
            autoDetected: true,
            choice: "auto"
          };
        }
      }

      const hint = state.gbSupported
        ? "已尝试 UTF-8 和 GB18030/GBK。"
        : "当前浏览器不支持 GB18030/GBK，仅尝试了 UTF-8。";
      throw new TextFileError("无法自动识别文本编码。" + hint + " 请尝试在顶部手动选择编码，并确认文件是纯文本。", "UNKNOWN_ENCODING");
    }

    let start = 0;
    let bomLabel = "";
    if (bom && bom.encoding === choice) {
      start = bom.offset;
      bomLabel = bom.label;
    }

    let text;
    try {
      text = decodeStrict(bytes.subarray(start), choice);
    } catch {
      throw new TextFileError("无法按 " + encodingLabel(choice) + " 解码该文件，请换一个编码试试。", "DECODE_FAILED");
    }
    validateDecodedText(text);

    return {
      text: normalizeNewlines(stripLeadingBom(text)),
      encoding: choice,
      label: ENCODING_LABELS[choice] || choice,
      bomLabel,
      autoDetected: false,
      choice
    };
  }

  function makePositionKey(file) {
    const name = String(file && file.name || "");
    const size = Number(file && file.size) || 0;
    const modified = Number(file && file.lastModified) || 0;
    return POSITION_PREFIX + encodeURIComponent(name) + ":" + size + ":" + modified;
  }

  function readSavedPosition() {
    if (!state.positionKey) return null;
    try {
      const raw = localStorage.getItem(state.positionKey);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return null;
      const ratio = Number(saved.scrollRatio);
      const offset = Number(saved.charOffset);
      return {
        scrollRatio: Number.isFinite(ratio) ? clamp(ratio, 0, 1) : 0,
        charOffset: Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : 0,
        updatedAt: Number(saved.updatedAt) || 0
      };
    } catch {
      return null;
    }
  }

  /* ---------------- 阅读区渲染 ---------------- */

  function buildReaderContent(text) {
    const fragment = document.createDocumentFragment();
    const blocks = text.split(/\n[ \t]*\n+/);
    let searchFrom = 0;
    let paragraphCount = 0;

    for (const block of blocks) {
      const raw = block.replace(/^[ \t]+|[ \t]+$/g, "");
      if (!raw) continue;
      const found = text.indexOf(raw, searchFrom);
      const start = found >= 0 ? found : searchFrom;
      searchFrom = start + raw.length;

      const paragraph = document.createElement("p");
      paragraph.textContent = raw;
      paragraph.dataset.charStart = String(start);
      paragraph.dataset.charEnd = String(start + raw.length);
      fragment.appendChild(paragraph);
      paragraphCount++;
    }

    el.readerContent.replaceChildren(fragment);
    state.paragraphCount = paragraphCount;
    return paragraphCount;
  }

  function updateDocumentHeader() {
    if (!state.file) return;
    const name = state.file.name;
    el.docTitle.textContent = name;
    el.docTitle.title = name;
    el.readingTitle.textContent = name;
    el.readingTitle.title = name;
    document.title = name + " · TXT 阅读器";

    const meta = [
      formatBytes(state.file.size),
      formatNumber(state.text.length) + " 字符",
      state.paragraphCount + " 段",
      "修改于 " + formatModified(state.file.lastModified)
    ];
    el.fileMeta.textContent = meta.join(" · ");

    const decoded = state.decoded;
    if (decoded) {
      const suffix = decoded.bomLabel
        ? "BOM"
        : (state.decodeChoice === "auto" ? "自动" : "手动");
      el.encodingChip.textContent = decoded.label + " · " + suffix;
      el.encodingChip.title = decoded.label
        + (decoded.bomLabel ? "（检测到 " + decoded.bomLabel + "）" : "")
        + (decoded.autoDetected ? " · 自动识别" : " · 手动选择");
    }
  }

  function updateEncodingUi() {
    el.encodingSelect.disabled = !state.ready;
    if (state.ready) el.encodingSelect.value = state.decodeChoice;
  }

  function commitDecodedText(decoded, choice) {
    state.text = decoded.text;
    state.decoded = decoded;
    state.decodeChoice = choice;
    updateDocumentHeader();
    updateEncodingUi();
  }

  function renderNewFile(file, buffer, decoded) {
    const token = ++state.renderSeq;
    state.file = file;
    state.bytes = buffer;
    state.positionKey = makePositionKey(file);
    state.ready = true;
    state.suppressSave = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = 0;

    commitDecodedText(decoded, "auto");
    buildReaderContent(state.text);

    el.emptyState.hidden = true;
    el.readerView.hidden = false;
    el.restartBtn.disabled = false;
    el.encodingSelect.disabled = false;
    el.encodingSelect.value = "auto";
    hideError();
    el.readerScroller.scrollTop = 0;
    updateProgress();
    updatePageEstimate();
    setStatus("已打开 · " + state.decoded.label + " · " + formatBytes(file.size));

    const saved = readSavedPosition();
    afterNextLayout(() => {
      if (token !== state.renderSeq || !state.ready) return;
      let restored = false;
      if (saved) restored = restoreSavedPosition(saved);
      state.suppressSave = false;
      updateProgress();
      updatePageEstimate();
      if (restored) {
        flashSaveState("已恢复上次位置");
        const pct = currentPercentText();
        showToast("已恢复上次阅读位置（" + pct + "）");
      }
    });

    try { el.readerScroller.focus({ preventScroll: true }); } catch { /* 焦点丢失不影响阅读 */ }
  }

  function rerenderForEncoding(decoded, choice, preservedOffset) {
    const token = ++state.renderSeq;
    state.suppressSave = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    commitDecodedText(decoded, choice);
    buildReaderContent(state.text);
    el.readerScroller.scrollTop = 0;
    updateProgress();
    updatePageEstimate();

    afterNextLayout(() => {
      if (token !== state.renderSeq || !state.ready) return;
      if (preservedOffset > 0) {
        const top = scrollTopForCharOffset(preservedOffset);
        if (top != null) el.readerScroller.scrollTop = clamp(top, 0, maxScrollTop());
      }
      state.suppressSave = false;
      updateProgress();
      updatePageEstimate();
    });
  }

  function maxScrollTop() {
    return Math.max(0, el.readerScroller.scrollHeight - el.readerScroller.clientHeight);
  }

  function currentScrollRatio() {
    const max = maxScrollTop();
    return max > 0 ? clamp(el.readerScroller.scrollTop / max, 0, 1) : 0;
  }

  function currentPercentText() {
    const ratio = currentScrollRatio();
    if (ratio >= 0.9995) return "100%";
    return (ratio * 100).toFixed(1) + "%";
  }

  function updateProgress() {
    if (!state.ready) {
      el.progressText.textContent = "0%";
      el.progressFill.style.width = "0%";
      return;
    }
    const ratio = currentScrollRatio();
    const text = ratio >= 0.9995 ? "100%" : (ratio * 100).toFixed(1) + "%";
    el.progressText.textContent = text;
    el.progressFill.style.width = text;
  }

  function updatePageEstimate() {
    if (!state.ready || !state.prefs.showPageEstimate) {
      el.pageText.hidden = true;
      el.pageText.textContent = "";
      return;
    }

    const viewport = Math.max(1, el.readerScroller.clientHeight);
    const total = Math.max(1, Math.ceil(el.readerScroller.scrollHeight / viewport));
    const current = clamp(Math.floor(el.readerScroller.scrollTop / viewport) + 1, 1, total);
    el.pageText.hidden = false;
    el.pageText.textContent = "第 " + current + " / " + total + " 页";
    el.pageText.title = "按当前窗口高度估算，仅作参考；滚动模式不会强制分页";
  }

  function updateViewMetrics() {
    updateProgress();
    updatePageEstimate();
  }

  function afterNextLayout(callback) {
    requestAnimationFrame(() => requestAnimationFrame(callback));
  }

  function elementTopInScroller(element) {
    const rect = element.getBoundingClientRect();
    const scrollerRect = el.readerScroller.getBoundingClientRect();
    return rect.top - scrollerRect.top + el.readerScroller.scrollTop;
  }

  function captureCharOffset() {
    if (!state.ready) return 0;
    const paragraphs = el.readerContent.querySelectorAll("p[data-char-start]");
    if (!paragraphs.length) return 0;

    const scrollTop = el.readerScroller.scrollTop;
    let chosen = paragraphs[0];
    for (const paragraph of paragraphs) {
      const top = elementTopInScroller(paragraph);
      if (top <= scrollTop + 10) chosen = paragraph;
      else break;
    }

    const start = Number(chosen.dataset.charStart) || 0;
    const end = Number(chosen.dataset.charEnd) || start;
    const paragraphTop = elementTopInScroller(chosen);
    const height = Math.max(1, chosen.getBoundingClientRect().height);
    const fraction = clamp((scrollTop - paragraphTop) / height, 0, 1);
    return Math.round(start + (end - start) * fraction);
  }

  function scrollTopForCharOffset(offset) {
    const paragraphs = el.readerContent.querySelectorAll("p[data-char-start]");
    if (!paragraphs.length) return null;

    const target = Math.max(0, Number(offset) || 0);
    // 字符 0 对应真正的文档开头（页眉仍在视野内），而不是第一段的盒子上沿。
    if (target === 0) return 0;
    let lo = 0;
    let hi = paragraphs.length - 1;
    let index = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = Number(paragraphs[mid].dataset.charStart) || 0;
      if (start <= target) { index = mid; lo = mid + 1; }
      else hi = mid - 1;
    }

    const chosen = paragraphs[index];
    const start = Number(chosen.dataset.charStart) || 0;
    const end = Number(chosen.dataset.charEnd) || start;
    const fraction = end > start ? clamp((target - start) / (end - start), 0, 1) : 0;
    const top = elementTopInScroller(chosen);
    const height = Math.max(1, chosen.getBoundingClientRect().height);
    return top + height * fraction;
  }

  function restoreSavedPosition(saved) {
    if (!saved) return false;
    const max = maxScrollTop();
    let top = 0;

    if (saved.scrollRatio >= 0.9995) {
      top = max;
    } else if (saved.charOffset > 0) {
      const mapped = scrollTopForCharOffset(saved.charOffset);
      top = mapped != null ? mapped : saved.scrollRatio * max;
    } else if (saved.scrollRatio > 0.002) {
      top = saved.scrollRatio * max;
    } else {
      return false;
    }

    el.readerScroller.scrollTop = clamp(top, 0, max);
    updateViewMetrics();
    return el.readerScroller.scrollTop > 1;
  }

  /* ---------------- 进度与位置保存 ---------------- */

  function positionData() {
    return {
      fileName: state.file ? state.file.name : "",
      size: state.file ? Number(state.file.size) || 0 : 0,
      lastModified: state.file ? Number(state.file.lastModified) || 0 : 0,
      scrollRatio: Number(currentScrollRatio().toFixed(6)),
      charOffset: captureCharOffset(),
      updatedAt: Date.now()
    };
  }

  function savePositionNow(options) {
    if (!state.ready || !state.file || !state.positionKey) return false;
    // 首次渲染后的两帧内可能还在恢复旧位置，此时落盘会把旧进度覆盖成 0。
    if (state.suppressSave) return false;
    const silent = !!(options && options.silent);
    try {
      localStorage.setItem(state.positionKey, JSON.stringify(positionData()));
      if (!silent) flashSaveState("位置已保存");
      return true;
    } catch {
      if (!silent) flashSaveState("位置保存失败");
      return false;
    }
  }

  function scheduleSave() {
    if (!state.ready || state.suppressSave) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = 0;
      if (state.suppressSave) return;
      savePositionNow({ silent: false });
    }, 260);
  }

  function flashSaveState(text) {
    clearTimeout(state.saveStateTimer);
    el.saveStateText.textContent = text;
    el.saveStateText.style.color = /失败/.test(text) ? "var(--danger)" : "";
    state.saveStateTimer = window.setTimeout(() => {
      el.saveStateText.textContent = "";
      el.saveStateText.style.color = "";
    }, 1900);
  }

  /* ---------------- 页面状态提示 ---------------- */

  function setStatus(text, isError) {
    el.statusText.textContent = text || "";
    el.statusText.style.color = isError ? "var(--danger)" : "";
  }

  function showError(message) {
    el.errorText.textContent = message || "发生了未知错误。";
    el.errorBanner.hidden = false;
  }

  function hideError() {
    el.errorBanner.hidden = true;
    el.errorText.textContent = "";
  }

  function showToast(message, duration) {
    clearTimeout(state.toastTimer);
    el.toast.textContent = message;
    el.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      el.toast.hidden = true;
    }, Math.max(1000, duration || 2400));
  }

  function showLoadError(message) {
    setStatus("打开失败", true);
    showError(message);
  }

  /* ---------------- 打开文件 ---------------- */

  async function openFile(file) {
    hideError();

    if (!file) return;
    if (!isTxtFile(file)) {
      showLoadError("只支持 .txt 纯文本文件。当前选择的是「" + (file.name || "未知文件") + "」。");
      return;
    }

    if (state.ready) savePositionNow({ silent: true });
    const seq = ++state.loadSeq;
    setStatus("正在读取 " + file.name + "…");

    let buffer;
    try {
      buffer = await readFileBuffer(file);
    } catch (error) {
      if (seq !== state.loadSeq) return;
      const message = error instanceof TextFileError ? error.message : "读取文件失败，请重试。";
      showLoadError(message);
      return;
    }
    if (seq !== state.loadSeq) return;

    let decoded;
    try {
      decoded = decodeBuffer(buffer, "auto");
    } catch (error) {
      if (seq !== state.loadSeq) return;
      const message = error instanceof TextFileError ? error.message : "解析文件失败，请重试。";
      showLoadError(message);
      return;
    }
    if (seq !== state.loadSeq) return;

    renderNewFile(file, buffer, decoded);
  }

  function readSelectedFileFromInput() {
    const file = el.fileInput.files && el.fileInput.files[0];
    el.fileInput.value = "";
    if (file) void openFile(file);
  }

  function requestFilePicker() {
    el.fileInput.value = "";
    el.fileInput.click();
  }

  /* ---------------- 宿主（璃鸢镜）传入的文件 ---------------- */

  function hostReady() {
    try { window.chrome?.webview?.postMessage({ type: "lyra-book-ready" }); } catch { }
  }

  async function openHostedFile() {
    const query = new URLSearchParams(location.search);
    const source = query.get("file") || query.get("path");
    if (!source) return;
    const name = query.get("name") || decodeURIComponent(source.split("/").pop() || "document.txt");
    try {
      const res = await fetch(source, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const mtime = Number(query.get("mtime")) || Date.now();
      await openFile(new File([blob], name, { type: "text/plain", lastModified: mtime }));
    } catch (error) {
      showLoadError("无法读取宿主传入的 TXT：" + (error?.message || error));
    } finally {
      hostReady();
    }
  }

  /* ---------------- 编码手动覆盖 ---------------- */

  function handleEncodingChange() {
    if (!state.ready || !state.file || !state.bytes) return;
    const choice = el.encodingSelect.value;

    if (choice === state.decodeChoice) {
      hideError();
      setStatus("已打开 · " + state.decoded.label + " · " + formatBytes(state.file.size));
      return;
    }

    const preservedOffset = captureCharOffset();
    const token = ++state.decodeSeq;
    hideError();
    setStatus("正在按 " + encodingLabel(choice) + " 重新解码…");

    let decoded;
    try {
      decoded = decodeBuffer(state.bytes, choice);
    } catch (error) {
      if (token !== state.decodeSeq) return;
      const message = error instanceof TextFileError ? error.message : "解码失败，请换一个编码试试。";
      showError("按 " + encodingLabel(choice) + " 解码失败：" + message
        + " 当前正文仍使用 " + (state.decoded ? state.decoded.label : "原编码") + "。");
      setStatus("编码切换失败", true);
      return;
    }
    if (token !== state.decodeSeq) return;

    rerenderForEncoding(decoded, choice, preservedOffset);
    setStatus("编码已切换为 " + decoded.label);
    showToast("已切换到 " + decoded.label);
  }

  /* ---------------- 设置面板 ---------------- */

  function isSettingsOpen() {
    return state.settingsOpen;
  }

  function openSettings() {
    if (state.settingsOpen) return;
    state.settingsOpen = true;
    el.settingsPanel.hidden = false;
    el.settingsPanel.setAttribute("aria-hidden", "false");
    el.settingsBtn.setAttribute("aria-expanded", "true");
    try { el.settingsClose.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function closeSettings(restoreFocus) {
    if (!state.settingsOpen) return;
    state.settingsOpen = false;
    el.settingsPanel.hidden = true;
    el.settingsPanel.setAttribute("aria-hidden", "true");
    el.settingsBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus !== false) {
      try { el.settingsBtn.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }

  function toggleSettings() {
    if (state.settingsOpen) closeSettings(true);
    else openSettings();
  }

  /* ---------------- 键盘与滚动 ---------------- */

  function isTextEditingTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName;
    if (tag === "TEXTAREA") return true;
    if (target.isContentEditable) return true;
    if (tag !== "INPUT") return false;
    const type = String(target.getAttribute("type") || "text").toLowerCase();
    return ["text", "search", "email", "number", "password", "tel", "url"].includes(type);
  }

  function isRangeOrSelect(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.tagName === "SELECT") return true;
    return target.tagName === "INPUT"
      && String(target.getAttribute("type") || "").toLowerCase() === "range";
  }

  function isNativeSpaceTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.tagName === "BUTTON" || target.tagName === "SELECT" || target.tagName === "SUMMARY") return true;
    if (target.tagName !== "INPUT") return false;
    const type = String(target.getAttribute("type") || "text").toLowerCase();
    return ["checkbox", "radio", "button", "submit", "reset", "file", "color"].includes(type);
  }

  function scrollReaderBy(delta, smooth) {
    if (!state.ready) return;
    const behavior = smooth && !state.prefs.reduceMotion ? "smooth" : "auto";
    try {
      el.readerScroller.scrollBy({ top: delta, behavior });
    } catch {
      el.readerScroller.scrollTop += delta;
    }
  }

  function pageStep(direction) {
    const amount = Math.max(160, Math.round(el.readerScroller.clientHeight * 0.82));
    scrollReaderBy(amount * direction, true);
  }

  function lineStep(direction) {
    const amount = Math.max(56, Math.round((state.prefs.fontSize || 20) * 3.2));
    scrollReaderBy(amount * direction, true);
  }

  function handleKeydown(event) {
    if (event.defaultPrevented) return;

    if (event.key === "Escape") {
      if (state.settingsOpen) {
        event.preventDefault();
        closeSettings(true);
      }
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!state.ready) return;

    const target = event.target;
    if (isTextEditingTarget(target)) return;

    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      pageStep(event.key === "PageDown" ? 1 : -1);
      return;
    }

    if (event.key === " " || event.code === "Space") {
      if (isNativeSpaceTarget(target)) return;
      event.preventDefault();
      pageStep(1);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp"
      || event.key === "ArrowRight" || event.key === "ArrowLeft") {
      if (isRangeOrSelect(target)) return;
      event.preventDefault();
      const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
      lineStep(forward ? 1 : -1);
    }
  }

  function handleScroll() {
    if (!state.ready) return;
    updateProgress();
    updatePageEstimate();
    scheduleSave();
  }

  /* ---------------- 拖放 ---------------- */

  function dragHasFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    if (!types) return false;
    try { return Array.from(types).includes("Files"); }
    catch { return false; }
  }

  function showDropState() {
    document.body.classList.add("dragging");
    el.dropOverlay.hidden = false;
  }

  function clearDropState() {
    state.dragDepth = 0;
    document.body.classList.remove("dragging");
    el.dropOverlay.hidden = true;
  }

  function handleDragEnter(event) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    state.dragDepth++;
    showDropState();
  }

  function handleDragOver(event) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    try { event.dataTransfer.dropEffect = "copy"; } catch { /* ignore */ }
    if (el.dropOverlay.hidden) showDropState();
  }

  function handleDragLeave(event) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) {
      document.body.classList.remove("dragging");
      el.dropOverlay.hidden = true;
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    clearDropState();

    const files = event.dataTransfer && event.dataTransfer.files
      ? Array.from(event.dataTransfer.files)
      : [];
    if (!files.length) {
      showLoadError("没有检测到文件。请把 .txt 文件直接拖进这个窗口。");
      return;
    }

    const file = files.find(isTxtFile) || files[0];
    if (files.length > 1) showToast("一次只打开一个文件，已选择 " + file.name, 2600);
    void openFile(file);
  }

  /* ---------------- 初始化 ---------------- */

  function bindEvents() {
    el.openBtn.addEventListener("click", requestFilePicker);
    el.emptyOpenBtn.addEventListener("click", requestFilePicker);
    el.fileInput.addEventListener("change", readSelectedFileFromInput);

    el.restartBtn.addEventListener("click", () => {
      if (!state.ready) return;
      el.readerScroller.scrollTo({ top: 0, behavior: state.prefs.reduceMotion ? "auto" : "smooth" });
      try { el.readerScroller.focus({ preventScroll: true }); } catch { /* ignore */ }
      scheduleSave();
    });

    el.encodingSelect.addEventListener("change", handleEncodingChange);

    el.settingsBtn.addEventListener("click", toggleSettings);
    el.settingsClose.addEventListener("click", () => closeSettings(true));
    el.errorClose.addEventListener("click", () => {
      hideError();
      if (state.ready) setStatus("就绪");
      else setStatus("打开一个 .txt 开始阅读");
    });

    el.fontRange.addEventListener("input", () => {
      updateLayoutPreference("fontSize", clamp(Math.round(Number(el.fontRange.value) || 20), 14, 32));
    });
    el.lineRange.addEventListener("input", () => {
      const raw = Number(el.lineRange.value) || 1.95;
      updateLayoutPreference("lineHeight", clamp(Math.round(raw * 20) / 20, 1.4, 2.6));
    });
    el.widthRange.addEventListener("input", () => {
      const raw = Number(el.widthRange.value) || 860;
      updateLayoutPreference("contentWidth", clamp(Math.round(raw / 20) * 20, 600, 1400));
    });

    el.themeLight.addEventListener("click", () => applyTheme("light"));
    el.themeDark.addEventListener("click", () => applyTheme("dark"));
    el.motionToggle.addEventListener("change", () => setMotionPreference(el.motionToggle.checked));
    el.pageEstimateToggle.addEventListener("change", () => setPageEstimatePreference(el.pageEstimateToggle.checked));

    el.readerScroller.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("keydown", handleKeydown);

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    window.addEventListener("resize", () => {
      if (!state.ready) return;
      updateViewMetrics();
    });

    window.addEventListener("pagehide", () => savePositionNow({ silent: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") savePositionNow({ silent: true });
    });
  }

  function init() {
    state.prefs = loadPrefs();
    setupEncodingOptions();
    applyPrefs();
    bindEvents();
    updateViewMetrics();
    document.title = "璃鸢镜 · TXT 阅读器";
    void openHostedFile();
  }

  init();
})();
