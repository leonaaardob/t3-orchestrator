import { chromium } from "playwright";

const baseUrl = process.env.T3_SCREENSHOT_URL ?? "http://localhost:5734";
const token = process.env.T3_SCREENSHOT_TOKEN;
const assetsDir = process.env.T3_ASSETS_DIR ?? "docs/assets";
const shot = (name) => `${assetsDir}/${name}`;

if (!token) {
  console.error("Set T3_SCREENSHOT_TOKEN to a fresh pairing token.");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${baseUrl}/pair#token=${token}`, {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(3000);

// Open Planning board with demo cards from the example project if available.
await page.getByRole("button", { name: "Planning" }).first().click();
await page.waitForTimeout(2000);
await page.screenshot({ path: shot("planning-kanban-hero.png") });

await page.getByRole("button", { name: "Execution path" }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: shot("planning-execution-path.png") });

await page.getByRole("button", { name: "Planning table" }).first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: shot("planning-table-live.png") });

await page.goto(`${baseUrl}/settings/general`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByText("Agent execution presets", { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: shot("execution-presets-settings.png") });

await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const createSupervisor = page.getByRole("button", {
  name: /Create Project Supervisor|Create Supervisor/i,
});
if (await createSupervisor.count()) {
  await createSupervisor.first().click();
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: shot("project-supervisor-thread.png") });

await browser.close();
console.log(`Captured README screenshots in ${assetsDir}/`);
