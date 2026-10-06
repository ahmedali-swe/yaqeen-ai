// Optional acceptance tooling, run via npm exec --package=playwright.
// Uses an installed Chrome binary; no browser download or product dependency.
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

let playwright;
for (const directory of (process.env.PATH ?? "").split(delimiter)) {
  if (!directory.endsWith("node_modules\\.bin") && !directory.endsWith("node_modules/.bin")) continue;
  try { playwright = createRequire(join(directory, "..", "package.json"))("playwright"); break; } catch { /* Another binary directory. */ }
}
if (!playwright) throw new Error("Run this script through npm exec --package=playwright.");
const origin = process.env.YAQEEN_ACCEPTANCE_URL ?? "http://localhost:3100";
const output = process.argv.includes("--session-navigation") ? "docs/session-acceptance" : "docs/ux-acceptance";
const replay = process.argv.includes("--recorded");
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "ar-SA" });
const report = { recordedAt: new Date().toISOString(), origin, live: !replay, requests: [], responsive: [], errors: [] };
if (replay) {
  console.log("Visual regression replay of retained real responses; no live AI calls.");
  const retained = JSON.parse(await readFile("docs/ux-acceptance/live-flow.json", "utf8"));
  const earlier = JSON.parse(await readFile("docs/evaluation/api-acceptance.json", "utf8"));
  report.replayedFrom = { reasoningRecordedAt: retained.recordedAt, patchRecordedAt: earlier.recordedAt };
  await page.route("**/api/analyze/*", async (route) => {
    const path = new URL(route.request().url()).pathname, input = route.request().postDataJSON();
    let body;
    if (path.endsWith("/claims")) body = retained.requests.find((item) => item.body.claims).body;
    else if (path.endsWith("/evidence")) body = retained.requests.find((item) => item.body.resolution?.evidenceOrigin === (input.claim.claimType === "QUOTE" ? "DIRECT" : "CONTEXTUAL_ANCHOR")).body;
    else if (path.endsWith("/relation")) body = retained.requests.find((item) => item.body.analysis?.verificationStatus === (input.claim.claimType === "QUOTE" ? "SUPPORTED" : "UNSUPPORTED")).body;
    else if (path.endsWith("/patch")) body = earlier.steps.interpretationPatch.body;
    assert(body, "No recorded response exists for this stage");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("response", async (response) => {
  if (!response.url().includes("/api/analyze/")) return;
  try { report.requests.push({ path: new URL(response.url()).pathname, status: response.status(), body: await response.json() }); } catch { /* Recorded failure through UI below. */ }
});
async function screenshot(name) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${output}/${replay && !name.startsWith("landing") ? "replay-" : ""}${name}.png`, fullPage: !process.argv.includes("--session-navigation") });
}
async function layout(label, width) {
  await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
  const measurement = await page.evaluate(() => ({
    width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
    rtl: getComputedStyle(document.documentElement).direction,
    sidebar: document.querySelector(".claims-sidebar")?.getBoundingClientRect().width,
    report: document.querySelector(".report-pane")?.getBoundingClientRect().width,
    inputTop: document.querySelector("#input")?.getBoundingClientRect().top,
  }));
  report.responsive.push({ label, ...measurement });
  assert(measurement.scrollWidth <= measurement.width, `${label}: horizontal overflow`);
  assert.equal(measurement.rtl, "rtl");
  await screenshot(`${label}-${width}`);
  console.log(`Layout ${label} ${width}: no overflow, RTL`);
}
async function action(name, next) {
  console.log(`Starting ${name}`);
  await page.getByRole("button", { name, exact: true }).click();
  for (let attempt = 0; attempt < 3; attempt++) {
    await Promise.race([
      next.waitFor({ state: "visible", timeout: 40_000 }),
      page.locator(".inline-alert").waitFor({ state: "visible", timeout: 40_000 }),
    ]);
    if (await next.isVisible()) { console.log(`Completed ${name}`); return; }
    await screenshot("transient-error");
    report.errors.push({ stage: name, text: await page.locator(".inline-alert").innerText() });
    if (attempt === 2) throw new Error(`${name}: could not complete after explicit retries`);
    console.log(`Temporary failure at ${name}; waiting 65 seconds before retrying only this stage`);
    await new Promise((resolve) => setTimeout(resolve, 65_000));
    await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  }
}
try {
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(":focus").innerText(), "انتقل إلى المحتوى");
  assert.equal(await page.locator(":focus").evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
  report.keyboardFocus = true;
  for (const width of [1600, 1440, 1280, 390, 320]) await layout("landing", width);
  if (process.argv.includes("--layout-only")) {
    console.log("Landing screenshots ready for visual inspection.");
  } else {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("link", { name: "حلّل محتوى الآن" }).click();
    await page.getByRole("textbox", { name: "النص المراد تحليله" }).fill("قال الكاتب: «إنما الأعمال بالنيات»، ثم ذكر أن هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول.");
    await action("ابدأ التحقق", page.getByRole("button", { name: "اختيار الادعاء ٢", exact: true }));
    assert.equal(await page.locator(".claim-item").count(), 2);
    await screenshot("claims-extracted");
    await action("البحث عن الأدلة", page.getByRole("button", { name: "تحليل العلاقة", exact: true }));
    await action("تحليل العلاقة", page.getByRole("heading", { name: "مدعوم", exact: true }));
    assert.match(await page.locator(".verdict-summary").innerText(), /اقتباس مباشر/);
    await screenshot("supported-quotation");
    await page.getByRole("button", { name: "اختيار الادعاء ٢", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "مدعوم", exact: true }).count(), 0);
    await action("البحث عن الأدلة", page.getByRole("button", { name: "تحليل العلاقة", exact: true }));
    assert.equal(await page.getByText("الدليل المشار إليه في السياق", { exact: true }).count(), 1);
    await action("تحليل العلاقة", page.getByRole("heading", { name: "غير مدعوم", exact: true }));
    assert.match(await page.locator(".verdict-summary").innerText(), /استنتاج غير مدعوم/);
    await page.getByRole("button", { name: "تحوّل المعنى", exact: true }).click();
    assert.match(await page.getByRole("region", { name: "تحوّل المعنى", exact: true }).innerText(), /الراحة النفسية/);
    await page.getByRole("button", { name: "تصحيح يقين", exact: true }).click();
    await action("اقتراح تصحيح يقين", page.getByRole("heading", { name: /تعديل مقترح للمراجعة|تعذر اقتراح تصحيح موثوق|يحتاج مراجعة مختص/ }));
    report.finalPatch = await page.locator(".patch-output").innerText();
    for (const width of [1600, 1440, 1280, 390, 320]) await layout("complete-report", width);
    const requests = report.requests.length;
    await page.getByRole("button", { name: "اختيار الادعاء ١", exact: true }).click();
    await page.getByRole("heading", { name: "مدعوم", exact: true }).waitFor();
    await page.getByRole("button", { name: "اختيار الادعاء ٢", exact: true }).click();
    await page.locator(".patch-output").waitFor();
    for (const name of ["الادعاءات", "الأدلة", "العلاقة", "تحوّل المعنى", "تصحيح يقين"]) {
      await page.getByRole("navigation", { name: "مراحل التحليل" }).getByRole("button", { name, exact: true }).click();
      assert.equal(await page.locator(".workflow-stepper [aria-current] button").getAttribute("aria-label"), name);
    }
    assert.equal(report.requests.length, requests, "Switching claims must not make another request");
    report.switchingPreservesResults = true;
    report.stepNavigationReusesResults = true;
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".patch-output").waitFor();
    assert.equal(report.requests.length, requests, "Refresh must restore results without requests");
    report.refreshRestoresResults = true;
    await page.getByRole("button", { name: "الأدلة", exact: true }).click();
    await page.getByText("عرض النص الكامل والإسناد", { exact: true }).first().focus();
    await page.keyboard.press("Enter");
    assert(await page.locator(".source-disclosure[open] blockquote").first().isVisible());
    await screenshot("full-source-mobile");
    report.complete = true;
  }
} catch (error) {
  report.blocker = error.message;
  await screenshot("blocked-flow");
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/${replay ? "recorded-visual-check" : process.argv.includes("--layout-only") ? "layout" : "live-flow"}.json`, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  console.log(JSON.stringify({ complete: report.complete, requests: report.requests.map(({ path, status }) => ({ path, status })), blocker: report.blocker }));
}
