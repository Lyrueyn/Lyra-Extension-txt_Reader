#!/usr/bin/env node
/*
 * Real Microsoft Edge regression test for the TXT reader prototype.
 *
 * Required environment:
 *   PLAYWRIGHT_MODULE  absolute path to the Playwright package
 * Optional:
 *   LYRA_BROWSER_PATH  Edge executable (defaults to the standard x86 path)
 *
 * Example:
 *   $env:PLAYWRIGHT_MODULE='C:\Users\Administrator\deepseek-harness\node_modules\.pnpm\playwright@1.61.1\node_modules\playwright'
 *   node tests/edge-regression.cjs
 *
 * The script starts its own local static HTTP server. It does not install
 * packages and does not modify product files outside tests/evidence/.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..");
const FIXTURES = path.join(HERE, "fixtures");
const EVIDENCE = path.join(HERE, "evidence");
const EDGE_PATH = process.env.LYRA_BROWSER_PATH
  || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png"
};

fs.mkdirSync(EVIDENCE, { recursive: true });

const summary = {
  startedAt: new Date().toISOString(),
  finishedAt: "",
  environment: {
    node: process.version,
    platform: process.platform,
    edgePath: EDGE_PATH,
    edgeVersion: "",
    playwrightModule: PLAYWRIGHT_MODULE || "",
    url: "",
    viewport: "1440x900",
    mode: "Microsoft Edge via Playwright, headless=true"
  },
  tests: [],
  screenshots: [],
  pageErrors: [],
  consoleErrors: [],
  fixtures: [],
  passed: 0,
  failed: 0,
  ok: false
};

let server = null;
let browser = null;
let context = null;
let page = null;
let baseUrl = "";

function recordScreenshot(filePath) {
  const relative = path.relative(ROOT, filePath).split(path.sep).join("/");
  if (!summary.screenshots.includes(relative)) summary.screenshots.push(relative);
}

function slug(text) {
  return String(text).replace(/[^\w\u4e00-\u9fa5-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "failure";
}

async function screenshot(name) {
  if (!page) return "";
  try {
    const file = path.join(EVIDENCE, name);
    await page.screenshot({ path: file, fullPage: false });
    recordScreenshot(file);
    return file;
  } catch (error) {
    return "截图失败：" + error.message;
  }
}

async function test(name, fn) {
  const started = Date.now();
  let entry = { name, status: "passed", details: "", screenshot: "", durationMs: 0 };
  try {
    const detail = await fn();
    entry.details = typeof detail === "string" ? detail : "";
    summary.passed++;
    console.log(`[PASS] ${name}${entry.details ? " — " + entry.details : ""}`);
  } catch (error) {
    entry.status = "failed";
    entry.details = error && error.message ? error.message : String(error);
    entry.stack = error && error.stack ? error.stack : "";
    summary.failed++;
    const failureName = `FAIL-${summary.tests.length + 1}-${slug(name)}.png`;
    entry.screenshot = await screenshot(failureName);
    console.error(`[FAIL] ${name} — ${entry.details}`);
  } finally {
    entry.durationMs = Date.now() - started;
    summary.tests.push(entry);
  }
}

async function readText(selector) {
  return (await page.locator(selector).innerText()).trim();
}

async function contentText() {
  return page.evaluate(() => document.getElementById("readerContent").innerText);
}

async function scrollTop() {
  return page.evaluate(() => document.getElementById("readerScroller").scrollTop);
}

async function waitForReader(title, timeout = 8000) {
  await page.waitForFunction(
    (name) => document.getElementById("docTitle").textContent === name
      && !document.getElementById("readerView").hidden,
    title,
    { timeout }
  );
  await page.waitForTimeout(250);
}

async function loadDirect(fileName) {
  const filePath = path.join(FIXTURES, fileName);
  assert.ok(fs.existsSync(filePath), "缺少测试样张：" + filePath);
  await page.setInputFiles("#fileInput", filePath);
  await waitForReader(fileName);
}

async function feedFile(fileName) {
  const filePath = path.join(FIXTURES, fileName);
  assert.ok(fs.existsSync(filePath), "缺少测试样张：" + filePath);
  await page.setInputFiles("#fileInput", filePath);
  await page.waitForTimeout(350);
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const localServer = http.createServer((request, response) => {
      let requestPath;
      try {
        requestPath = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      } catch {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("bad request");
        return;
      }

      if (requestPath === "/") requestPath = "/index.html";
      const resolved = path.resolve(ROOT, "." + requestPath);
      if (!resolved.startsWith(ROOT + path.sep)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("forbidden");
        return;
      }

      fs.stat(resolved, (statError, stat) => {
        if (statError || !stat.isFile()) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("not found");
          return;
        }
        const ext = path.extname(resolved).toLowerCase();
        response.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control": "no-store"
        });
        fs.createReadStream(resolved).pipe(response);
      });
    });

    localServer.on("error", reject);
    localServer.listen(0, "127.0.0.1", () => {
      const address = localServer.address();
      resolve({ server: localServer, port: address.port });
    });
  });
}

function collectPageIssues(targetPage, label) {
  targetPage.on("pageerror", (error) => {
    summary.pageErrors.push({ page: label, message: error.message, stack: error.stack || "" });
  });
  targetPage.on("console", (message) => {
    if (message.type() === "error") {
      summary.consoleErrors.push({ page: label, text: message.text() });
    }
  });
}

async function setRangeValue(id, value) {
  await page.evaluate(({ id: elementId, value: nextValue }) => {
    const input = document.getElementById(elementId);
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, { id, value });
}

function writeReports() {
  summary.finishedAt = new Date().toISOString();
  summary.ok = summary.failed === 0 && summary.pageErrors.length === 0;
  const jsonPath = path.join(EVIDENCE, "summary.json");
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const lines = [
    "# TXT 阅读器 · 真实 Edge 回归测试结果",
    "",
    `- 时间：${summary.startedAt} → ${summary.finishedAt}`,
    `- 浏览器：Microsoft Edge ${summary.environment.edgeVersion}（${summary.environment.edgePath}）`,
    `- 模式：Playwright headless=true，viewport ${summary.environment.viewport}`,
    `- 页面：${summary.environment.url || "（未能启动）"}`,
    `- 结果：**${summary.passed} 通过 / ${summary.failed} 失败**`,
    `- 页面异常：${summary.pageErrors.length}；控制台 error：${summary.consoleErrors.length}`,
    "",
    "| # | 测试项 | 结果 | 详情 |",
    "|---:|---|---|---|",
    ...summary.tests.map((entry, index) =>
      `| ${index + 1} | ${entry.name.replace(/\|/g, "\\|")} | ${entry.status === "passed" ? "通过" : "失败"} | ${String(entry.details || "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")} |`),
    "",
    "## 截图",
    "",
    ...(summary.screenshots.length
      ? summary.screenshots.map((shot) => `- [${shot}](${path.basename(shot)})`)
      : ["- 无"]),
    "",
    "## 页面异常",
    "",
    ...(summary.pageErrors.length
      ? summary.pageErrors.map((error) => `- [${error.page}] ${error.message}`)
      : ["- 无"]),
    "",
    "## 控制台 error",
    "",
    ...(summary.consoleErrors.length
      ? summary.consoleErrors.map((error) => `- [${error.page}] ${error.text}`)
      : ["- 无"]),
    ""
  ];
  fs.writeFileSync(path.join(EVIDENCE, "summary.md"), lines.join("\n"), "utf8");
  console.log(`\nResults: ${summary.passed} passed, ${summary.failed} failed.`);
  console.log(`Summary: ${jsonPath}`);
}

(async () => {
  let playwright;
  try {
    if (!PLAYWRIGHT_MODULE) {
      throw new Error("未设置 PLAYWRIGHT_MODULE 环境变量，无法加载 Playwright。");
    }
    if (!fs.existsSync(EDGE_PATH)) {
      throw new Error("找不到 Microsoft Edge：" + EDGE_PATH);
    }
    playwright = require(PLAYWRIGHT_MODULE);
  } catch (error) {
    summary.tests.push({
      name: "测试环境初始化",
      status: "failed",
      details: error.message,
      durationMs: 0
    });
    summary.failed = 1;
    writeReports();
    process.exitCode = 1;
    return;
  }

  try {
    const started = await startStaticServer();
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}/index.html`;
    summary.environment.url = baseUrl;

    const fixtureNames = ["utf8-cn.txt", "utf8-bom.txt", "gb18030-cn.txt", "utf16le-bom.txt",
      "utf16be-bom.txt", "drop-sample.txt", "binary-sample.txt", "empty.txt"];
    summary.fixtures = fixtureNames.map((name) => {
      const filePath = path.join(FIXTURES, name);
      const stat = fs.statSync(filePath);
      return { name, bytes: stat.size, lastModified: Math.round(stat.mtimeMs) };
    });

    browser = await playwright.chromium.launch({
      executablePath: EDGE_PATH,
      headless: true
    });
    summary.environment.edgeVersion = browser.version();
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN"
    });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    collectPageIssues(page, "http");
    await page.goto(baseUrl, { waitUntil: "load" });
    await page.waitForSelector("#openBtn");

    const userAgent = await page.evaluate(() => navigator.userAgent);
    summary.environment.userAgent = userAgent;

    await test("初始空状态与编码控件", async () => {
      assert.match(await page.title(), /TXT 阅读器/);
      assert.equal(await page.locator("#emptyState").isVisible(), true, "空状态应可见");
      assert.equal(await page.locator("#readerView").isVisible(), false, "阅读区初始应隐藏");
      assert.equal(await page.locator("#encodingSelect").isDisabled(), true, "未打开文件时编码选择应禁用");
      assert.equal(await page.locator("#restartBtn").isDisabled(), true, "未打开文件时回到开头应禁用");
      assert.equal(await readText("#progressText"), "0%");
      assert.equal(await page.locator("#openBtn").isEnabled(), true);
      assert.equal(await page.locator("#openBtn").getAttribute("tabindex"), null, "按钮应使用原生 Tab 焦点");
      await screenshot("01-empty-state.png");
      return "空状态、标题、进度、禁用状态正确";
    });

    await test("扩展清单字段符合约定", async () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "extension.json"), "utf8"));
      assert.equal(manifest.id, "txt");
      assert.equal(manifest.name, "TXT 阅读器");
      assert.equal(manifest.version, "0.1.0");
      assert.equal(manifest.entry, "index.html");
      assert.deepEqual(manifest.fileTypes, [".txt"]);
      assert.equal(manifest.enabled, true);
      return "id/name/version/entry/fileTypes/enabled 均符合约定";
    });

    await test("文件选择按钮打开 UTF-8 中文并显示段落", async () => {
      const chooserPromise = page.waitForEvent("filechooser");
      await page.click("#openBtn");
      const chooser = await chooserPromise;
      await chooser.setFiles(path.join(FIXTURES, "utf8-cn.txt"));
      await waitForReader("utf8-cn.txt");

      const text = await contentText();
      assert.ok(text.includes("璃鸢镜 TXT 阅读器 · UTF8-CN"), "正文应包含 UTF-8 样张标记");
      assert.ok(text.includes("第一章 灯下的长句"), "正文应保留章节段落");
      assert.ok(await page.locator("#readerContent p").count() >= 10, "正文应渲染多个段落");
      assert.equal(await readText("#docTitle"), "utf8-cn.txt");
      assert.equal(await readText("#readingTitle"), "utf8-cn.txt");
      assert.match(await readText("#fileMeta"), /字符/);
      assert.match(await readText("#encodingChip"), /UTF-8/);
      assert.match(await readText("#progressText"), /^0(\.0)?%$/);
      assert.match(await readText("#pageText"), /^第 \d+ \/ \d+ 页$/);
      assert.equal(await page.locator("#restartBtn").isEnabled(), true);
      assert.equal(await page.locator("#encodingSelect").isEnabled(), true);
      await screenshot("02-utf8-reader.png");
      return "文件选择器 → FileReader → UTF-8 解码 → 多段渲染成功";
    });

    await test("UTF-8 BOM 自动识别并去除 BOM", async () => {
      await loadDirect("utf8-bom.txt");
      const bomText = await contentText();
      assert.ok(bomText.includes("UTF8-BOM"), "正文应包含 UTF-8 BOM 样张标记");
      assert.equal(bomText.startsWith("\uFEFF"), false, "BOM 不应作为正文内容显示");
      assert.match(await readText("#encodingChip"), /UTF-8/);
      assert.match(await readText("#encodingChip"), /BOM/);
      return "UTF-8 BOM 被识别并从正文剥离";
    });

    await test("GB18030 自动识别", async () => {
      await loadDirect("gb18030-cn.txt");
      const text = await contentText();
      assert.ok(text.includes("GB18030-CN"), "正文应包含 GB18030 标记");
      assert.ok(text.includes("璃鸢镜"), "GB18030 中文应正确显示");
      assert.match(await readText("#encodingChip"), /GB18030/);
      assert.equal(await page.locator("#encodingSelect").inputValue(), "auto");
      assert.match(await readText("#fileMeta"), /字符/);
      return "自动检测为 GB18030/GBK，中文显示正常";
    });

    await test("编码手动覆盖：UTF-8 失败提示后恢复 GB18030", async () => {
      await page.selectOption("#encodingSelect", "utf-8");
      await page.waitForSelector("#errorBanner:not([hidden])");
      const errorText = await readText("#errorText");
      assert.match(errorText, /UTF-8/);
      assert.match(errorText, /解码失败/);
      const preserved = await contentText();
      assert.ok(preserved.includes("GB18030-CN"), "切换失败时不应清空当前正文");
      assert.match(await readText("#encodingChip"), /GB18030/, "失败后页眉仍应标注实际生效的编码");

      await page.selectOption("#encodingSelect", "gb18030");
      await page.waitForFunction(() => document.getElementById("errorBanner").hidden, null, { timeout: 5000 });
      const recovered = await contentText();
      assert.ok(recovered.includes("GB18030-CN"));
      assert.match(await readText("#encodingChip"), /GB18030/);
      assert.match(await readText("#encodingChip"), /手动/);
      assert.equal(await page.locator("#encodingSelect").inputValue(), "gb18030");
      assert.match(await readText("#statusText"), /编码已切换/);
      return "错误提示明确；回退到 GB18030 后正文恢复并标记手动编码";
    });

    await test("UTF-16LE BOM 自动识别", async () => {
      await loadDirect("utf16le-bom.txt");
      const text = await contentText();
      assert.ok(text.includes("UTF16LE-BOM"), "正文应包含 UTF-16LE 标记");
      assert.ok(text.includes("璃鸢镜"), "UTF-16LE 中文应正确显示");
      assert.match(await readText("#encodingChip"), /UTF-16LE/);
      assert.match(await readText("#encodingChip"), /BOM/);
      return "BOM 识别为 UTF-16LE，中文显示正常";
    });

    await test("UTF-16BE BOM 自动识别（附测）", async () => {
      await loadDirect("utf16be-bom.txt");
      const text = await contentText();
      assert.ok(text.includes("UTF16BE-BOM"));
      assert.match(await readText("#encodingChip"), /UTF-16BE/);
      assert.match(await readText("#encodingChip"), /BOM/);
      return "BOM 识别为 UTF-16BE，中文显示正常";
    });

    await test("二进制内容被拦截且页面保持可用", async () => {
      const before = await readText("#docTitle");
      await feedFile("binary-sample.txt");
      await page.waitForSelector("#errorBanner:not([hidden])");
      const errorText = await readText("#errorText");
      assert.match(errorText, /二进制内容/);
      assert.match(errorText, /PNG/);
      assert.equal(await readText("#docTitle"), before, "打开失败不应替换当前文件");
      assert.equal(await page.locator("#openBtn").isEnabled(), true, "出错后按钮仍可用");
      await page.click("#settingsBtn");
      assert.equal(await page.locator("#settingsPanel").isVisible(), true, "出错后设置面板仍能打开");
      await page.keyboard.press("Escape");
      await screenshot("03-binary-error.png");
      return "PNG 签名被识别为二进制，提示清楚且未崩溃";
    });

    await test("空 TXT 被拦截且提示可读", async () => {
      await feedFile("empty.txt");
      await page.waitForSelector("#errorBanner:not([hidden])");
      const errorText = await readText("#errorText");
      assert.match(errorText, /没有可阅读的文字|为空/);
      assert.equal(await page.locator("#openBtn").isEnabled(), true);
      return "空文件给出明确提示，未崩溃";
    });

    await test("拖放路径：DataTransfer 中的 TXT 可打开", async () => {
      const dropPath = path.join(FIXTURES, "drop-sample.txt");
      const stat = fs.statSync(dropPath);
      const payload = {
        name: "drop-sample.txt",
        base64: fs.readFileSync(dropPath).toString("base64"),
        lastModified: Math.round(stat.mtimeMs)
      };
      await page.evaluate(({ name, base64, lastModified }) => {
        const raw = atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const file = new File([bytes], name, { type: "text/plain", lastModified });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        for (const type of ["dragenter", "dragover", "drop"]) {
          window.dispatchEvent(new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer
          }));
        }
      }, payload);
      await waitForReader("drop-sample.txt");
      const text = await contentText();
      assert.ok(text.includes("DRAG-DROP"), "拖放后正文应包含 DRAG-DROP 标记");
      assert.equal(await page.locator("#dropOverlay").isVisible(), false, "drop 后拖放遮罩应收起");
      assert.equal(await page.evaluate(() => document.body.classList.contains("dragging")), false);
      assert.equal(await readText("#progressText"), "0.0%", "短文件在顶部时进度应为 0.0%");
      assert.equal(await readText("#pageText"), "第 1 / 1 页", "短文件不应因为最小高度产生第 2 页");
      return "页面内构造 DataTransfer + File 触发 drop 路径成功（非操作系统原生鼠标拖拽）";
    });

    await test("阅读设置：字号、行距、宽度、深浅主题、减少动画、页码开关", async () => {
      await page.click("#settingsBtn");
      await page.waitForSelector("#settingsPanel:not([hidden])");
      assert.equal(await page.locator("#settingsBtn").getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator("#settingsClose").evaluate((node) => document.activeElement === node), true, "打开设置后焦点应在关闭按钮");

      assert.equal(await page.locator("#fontRange").getAttribute("min"), "14");
      assert.equal(await page.locator("#fontRange").getAttribute("max"), "32");
      assert.equal(await page.locator("#lineRange").getAttribute("min"), "1.4");
      assert.equal(await page.locator("#lineRange").getAttribute("max"), "2.6");
      assert.equal(await page.locator("#widthRange").getAttribute("min"), "600");
      assert.equal(await page.locator("#widthRange").getAttribute("max"), "1400");

      await setRangeValue("fontRange", 30);
      await setRangeValue("lineRange", 2.3);
      await setRangeValue("widthRange", 1100);
      await page.waitForTimeout(500);

      const style = await page.evaluate(() => {
        const paragraph = document.querySelector("#readerContent p");
        const rootStyle = getComputedStyle(document.documentElement);
        return {
          fontSize: parseFloat(getComputedStyle(paragraph).fontSize),
          lineHeight: parseFloat(rootStyle.getPropertyValue("--reader-line-height")),
          contentWidth: parseFloat(rootStyle.getPropertyValue("--content-width")),
          pageWidth: document.getElementById("readingPage").getBoundingClientRect().width,
          fontOutput: document.getElementById("fontValue").textContent,
          lineOutput: document.getElementById("lineValue").textContent,
          widthOutput: document.getElementById("widthValue").textContent
        };
      });
      assert.equal(style.fontSize, 30, "正文字号应为 30px");
      assert.equal(style.lineHeight, 2.3, "行距变量应为 2.3");
      assert.ok(Math.abs(style.pageWidth - 1100) <= 1, "内容宽度应约为 1100px，实际 " + style.pageWidth);
      assert.equal(style.fontOutput, "30");
      assert.equal(style.lineOutput, "2.30");
      assert.equal(style.widthOutput, "1100");

      await page.click("#themeLight");
      await page.waitForTimeout(250);
      const light = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        pageBackground: getComputedStyle(document.getElementById("readingPage")).backgroundColor,
        toolbarBackground: getComputedStyle(document.getElementById("toolbar")).backgroundColor,
        settingsBackground: getComputedStyle(document.getElementById("settingsPanel")).backgroundColor
      }));
      assert.equal(light.theme, "light");
      assert.equal(light.pageBackground, "rgb(255, 253, 249)");
      assert.equal(light.toolbarBackground, "rgb(248, 250, 252)", "浅色主题工具栏背景应同步变亮");
      assert.equal(light.settingsBackground, "rgb(248, 250, 252)", "浅色主题设置面板应为浅色");
      await screenshot("04-light-theme-settings.png");

      await page.check("#motionToggle");
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains("reduce-motion")), true);
      assert.equal(await page.locator("#motionToggle").isChecked(), true);

      await page.uncheck("#pageEstimateToggle");
      assert.equal(await page.locator("#pageText").isHidden(), true);
      await page.check("#pageEstimateToggle");
      assert.equal(await page.locator("#pageText").isVisible(), true);

      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#settingsPanel").isHidden(), true, "Esc 应关闭设置面板");
      assert.equal(await page.locator("#settingsBtn").getAttribute("aria-expanded"), "false");
      assert.equal(await page.evaluate(() => document.activeElement.id), "settingsBtn", "关闭后焦点应回到设置按钮");
      await screenshot("05-light-reader.png");
      return "字号 30px、行距 2.3、宽 1100px、浅色主题、减少动画、页码开关与 Esc 关闭均通过";
    });

    await test("键盘滚动与输入控件焦点不抢键", async () => {
      await loadDirect("utf8-cn.txt");
      await page.focus("#readerScroller");
      assert.equal(await page.evaluate(() => document.activeElement.id), "readerScroller");
      const start = await scrollTop();
      assert.ok(start < 2, "新打开的长文应从顶部开始，实际 " + start);

      await page.keyboard.press("PageDown");
      await page.waitForFunction((previous) => document.getElementById("readerScroller").scrollTop > previous + 80,
        start, { timeout: 5000 });
      const afterPageDown = await scrollTop();

      await page.keyboard.press("PageUp");
      await page.waitForFunction((previous) => document.getElementById("readerScroller").scrollTop < previous - 40,
        afterPageDown, { timeout: 5000 });
      const afterPageUp = await scrollTop();
      assert.ok(afterPageUp < afterPageDown, "PageUp 应向上滚动");

      await page.keyboard.press("Space");
      await page.waitForFunction((previous) => document.getElementById("readerScroller").scrollTop > previous + 30,
        afterPageUp, { timeout: 5000 });
      const afterSpace = await scrollTop();

      await page.keyboard.press("ArrowDown");
      await page.waitForFunction((previous) => document.getElementById("readerScroller").scrollTop > previous + 10,
        afterSpace, { timeout: 5000 });
      const afterArrow = await scrollTop();
      assert.ok(afterArrow > afterSpace, "方向键应滚动正文");

      await page.click("#settingsBtn");
      await page.focus("#fontRange");
      assert.equal(await page.evaluate(() => document.activeElement.id), "fontRange");
      await page.keyboard.press("PageDown");
      await page.waitForFunction((previous) => document.getElementById("readerScroller").scrollTop > previous + 30,
        afterArrow, { timeout: 5000 });
      assert.equal(await page.locator("#settingsPanel").isVisible(), true, "PageDown 不应关闭设置面板");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#settingsPanel").isHidden(), true);
      return "PageDown/PageUp/Space/ArrowDown 均生效；range 获得焦点时 PageDown 仍滚动正文；Esc 生效";
    });

    await test("阅读位置按文件名+大小+时间保存并在重选后恢复", async () => {
      // 当前仍是 UTF-8 长文。滚动到约 45%，等待防抖落盘。
      await page.evaluate(() => {
        const scroller = document.getElementById("readerScroller");
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.45;
        scroller.dispatchEvent(new Event("scroll"));
      });
      await page.waitForTimeout(700);

      const before = await page.evaluate(() => {
        const entries = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith("lyra-txt-position:v1:")) continue;
          try {
            const value = JSON.parse(localStorage.getItem(key));
            if (value && value.fileName === "utf8-cn.txt") entries.push({ key, value });
          } catch { /* ignore malformed unrelated entries */ }
        }
        return {
          scrollTop: document.getElementById("readerScroller").scrollTop,
          max: document.getElementById("readerScroller").scrollHeight - document.getElementById("readerScroller").clientHeight,
          progress: document.getElementById("progressText").textContent,
          entries
        };
      });
      assert.equal(before.entries.length, 1, "应存在当前文件的一条位置记录");
      const saved = before.entries[0];
      const fixtureStat = fs.statSync(path.join(FIXTURES, "utf8-cn.txt"));
      assert.equal(saved.value.size, fixtureStat.size, "位置记录大小应与文件一致");
      assert.ok(saved.value.lastModified > 0, "位置记录应含最后修改时间");
      assert.ok(saved.value.charOffset > 0, "位置记录应保存字符偏移");
      assert.ok(Math.abs(saved.value.scrollRatio - 0.45) <= 0.06, "保存的滚动比例接近 45%，实际 " + saved.value.scrollRatio);
      assert.match(saved.key, /^lyra-txt-position:v1:/);
      assert.ok(saved.key.includes(encodeURIComponent("utf8-cn.txt")), "localStorage 键应含文件名");
      assert.ok(saved.key.endsWith(":" + fixtureStat.size + ":" + saved.value.lastModified), "localStorage 键应含大小与最后修改时间");
      assert.ok(before.scrollTop > 50, "测试前应确实滚动");

      await page.reload({ waitUntil: "load" });
      await page.waitForSelector("#emptyState");
      assert.equal(await page.locator("#readerView").isVisible(), false);

      await loadDirect("utf8-cn.txt");
      await page.waitForFunction(() => {
        const toast = document.getElementById("toast");
        return toast && !toast.hidden && toast.textContent.includes("已恢复上次阅读位置");
      }, null, { timeout: 5000 });
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => {
        const scroller = document.getElementById("readerScroller");
        const max = scroller.scrollHeight - scroller.clientHeight;
        return {
          scrollTop: scroller.scrollTop,
          ratio: max > 0 ? scroller.scrollTop / max : 0,
          progress: document.getElementById("progressText").textContent,
          saveState: document.getElementById("saveStateText").textContent
        };
      });
      assert.ok(after.ratio > 0.35, "重新选择同一文件应恢复滚动位置，实际比例 " + after.ratio);
      assert.ok(Math.abs(after.ratio - saved.value.scrollRatio) <= 0.05,
        `恢复比例应接近保存值，保存 ${saved.value.scrollRatio}，恢复 ${after.ratio}`);
      assert.notEqual(after.progress, "0.0%");

      await page.click("#restartBtn");
      await page.waitForFunction(() => document.getElementById("readerScroller").scrollTop < 2, null, { timeout: 5000 });
      assert.equal(await readText("#progressText"), "0.0%");
      return `位置键含文件名/大小/时间；保存 ${saved.value.scrollRatio.toFixed(3)}，恢复 ${after.ratio.toFixed(3)}；字符偏移 ${saved.value.charOffset}；回到开头有效`;
    });

    await test("按钮 Tab 焦点顺序", async () => {
      await page.focus("#restartBtn");
      assert.equal(await page.evaluate(() => document.activeElement.id), "restartBtn");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "settingsBtn", "Tab 应从回到开头到阅读设置");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "openBtn", "Tab 应到打开 TXT");
      return "restartBtn → settingsBtn → openBtn 可通过 Tab 到达";
    });

    await test("file:// 直接打开原型并读取 TXT", async () => {
      const filePage = await context.newPage();
      filePage.setDefaultTimeout(8000);
      collectPageIssues(filePage, "file");
      const fileUrl = pathToFileURL(path.join(ROOT, "index.html")).href;
      await filePage.goto(fileUrl, { waitUntil: "load" });
      await filePage.waitForSelector("#openBtn");
      assert.equal(await filePage.locator("#emptyState").isVisible(), true, "file:// 空状态应可见");
      await filePage.setInputFiles("#fileInput", path.join(FIXTURES, "utf8-cn.txt"));
      await filePage.waitForFunction(() => document.getElementById("docTitle").textContent === "utf8-cn.txt"
        && !document.getElementById("readerView").hidden, null, { timeout: 8000 });
      const fileText = await filePage.locator("#readerContent").innerText();
      assert.ok(fileText.includes("UTF8-CN"), "file:// 下应能显示正文");
      await filePage.screenshot({ path: path.join(EVIDENCE, "06-file-url.png") });
      recordScreenshot(path.join(EVIDENCE, "06-file-url.png"));
      await filePage.close();
      return "file:///D:/Temp/Lyra-Extension-Txt/index.html 可直接加载，并成功打开 UTF-8 TXT";
    });

    await test("无页面异常或控制台 error", async () => {
      assert.deepEqual(summary.pageErrors, [], "存在未捕获页面异常");
      assert.deepEqual(summary.consoleErrors, [], "存在控制台 error");
      return "0 个 uncaught pageerror、0 个 console.error";
    });
  } catch (error) {
    summary.tests.push({
      name: "测试主流程异常",
      status: "failed",
      details: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : "",
      durationMs: 0
    });
    summary.failed++;
    console.error("[FATAL]", error);
  } finally {
    writeReports();
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { if (server) await new Promise((resolve) => server.close(resolve)); } catch { /* ignore */ }
  }

  if (!summary.ok) process.exitCode = 1;
})();
