import { chromium } from "playwright";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.env.T3_REPO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.T3_SCREENSHOT_URL ?? "http://localhost:5734";
const token = process.env.T3_SCREENSHOT_TOKEN;
const assetsDir = process.env.T3_ASSETS_DIR ?? join(repoRoot, "docs/assets");
const projectRoot = process.env.T3_SCREENSHOT_PROJECT_ROOT ?? repoRoot;
const shot = (name) => join(assetsDir, name);

if (!token) {
  console.error("Set T3_SCREENSHOT_TOKEN to a fresh pairing token.");
  process.exit(1);
}

mkdirSync(join(projectRoot, ".t3"), { recursive: true });
copyFileSync(
  join(repoRoot, "docs/agents/templates/agent-board.readme-demo.json"),
  join(projectRoot, ".t3/agent-board.json"),
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1680, height: 980 },
  deviceScaleFactor: 2,
});

await page.addInitScript(() => {
  localStorage.setItem("theme", "light");
  localStorage.setItem("appearance-mode", "light");
});

await page.goto(`${baseUrl}/pair#token=${token}`, {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(2500);

const createSupervisor = page.getByRole("button", {
  name: /Create Project Supervisor/i,
});
if (await createSupervisor.count()) {
  await createSupervisor.first().click();
  await page.waitForTimeout(1200);
}

await page.getByRole("button", { name: "Planning" }).first().click();
await page.waitForTimeout(2200);

const board = page.locator('[data-testid="agent-board-panel"], main').first();
const heroClip = await board.boundingBox();
if (heroClip) {
  await page.screenshot({
    path: shot("readme-hero-planning.png"),
    clip: {
      x: Math.max(0, heroClip.x - 8),
      y: Math.max(0, heroClip.y - 8),
      width: Math.min(heroClip.width + 16, 1680),
      height: Math.min(heroClip.height + 16, 720),
    },
  });
} else {
  await page.screenshot({ path: shot("readme-hero-planning.png") });
}

await page.screenshot({
  path: shot("readme-hero-sidebar.png"),
  clip: { x: 0, y: 0, width: 320, height: 720 },
});

await page.goto(`${baseUrl}/settings/general`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const modeSelect = page.getByRole("combobox", { name: "Agent execution mode" });
if (await modeSelect.count()) {
  await modeSelect.click();
  await page.getByRole("option", { name: "Advanced" }).click();
  await page.waitForTimeout(800);
}

const presetsSection = page.getByText("Agent execution presets", { exact: true });
await presetsSection.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);

const presetsBox = await presetsSection.locator("xpath=ancestor::section[1]").boundingBox();
if (presetsBox) {
  await page.screenshot({
    path: shot("execution-presets-advanced.png"),
    clip: {
      x: Math.max(0, presetsBox.x - 12),
      y: Math.max(0, presetsBox.y - 12),
      width: Math.min(presetsBox.width + 280, 1280),
      height: Math.min(presetsBox.height + 24, 520),
    },
  });
} else {
  await page.screenshot({ path: shot("execution-presets-advanced.png") });
}

await browser.close();
console.log(`Captured README screenshots in ${assetsDir}/`);
