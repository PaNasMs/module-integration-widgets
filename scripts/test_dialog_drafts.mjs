import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = resolve(
  process.env.FRONTEND_PACKAGE ?? resolve(root, "../../frontend/package.json"),
);
const frontendRoot = dirname(frontend);
const require = createRequire(frontend);
const { chromium, expect } = require("@playwright/test");
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { default: react } = await import(
  pathToFileURL(require.resolve("@vitejs/plugin-react")).href,
);
const { default: tailwind } = await import(
  pathToFileURL(require.resolve("@tailwindcss/vite")).href,
);
const aliases = Object.entries({
  "@fixture/sdk": "src/app/module-sdk.ts",
  "@fixture/registry": "src/app/module-registry.ts",
  "@fixture/i18n": "src/i18n/index.ts",
  "@fixture/style": "src/style.css",
  "@fixture/design": "src/design-system.css",
  "@fixture/home": "src/home/components.css",
}).map(([find, path]) => ({ find, replacement: resolve(frontendRoot, path) }));
for (const name of ["react/jsx-runtime", "react-dom/client", "react", "@tanstack/react-query"])
  aliases.push({
    find: new RegExp("^" + name + "$"),
    replacement: require.resolve(name),
  });
const server = await createServer({
  configFile: false,
  root,
  plugins: [react(), tailwind()],
  resolve: { alias: aliases },
  server: {
    host: "127.0.0.1",
    port: 15187,
    strictPort: true,
    fs: { allow: [root, frontendRoot] },
  },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/opt/google/chrome/chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];

try {
  for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:15187/tests/dialog-drafts.html?theme=light&surface=solid`);
    await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
    const edits = page.getByRole("button", { name: "Edit connection", exact: true });
    await expect(edits).toHaveCount(1);

    await edits.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name")).toHaveValue("Fixture Proxmox");
    await expect(dialog.getByLabel("Service URL")).toHaveValue("https://proxmox.example.test");
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toHaveCount(0);

    await edits.click();
    dialog = page.getByRole("dialog");
    const secret = dialog.getByLabel("Token or password");
    await secret.fill("synthetic-widget-secret");
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(secret).toHaveValue("synthetic-widget-secret");
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await edits.click();
    dialog = page.getByRole("dialog");
    const revertedSecret = dialog.getByLabel("Token or password");
    await revertedSecret.fill("synthetic-widget-secret");
    await revertedSecret.fill("");
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toHaveCount(0);

    assert.deepEqual(await page.evaluate(() => window.integrationWidgetFixture.writes), []);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS built integration-widgets bundle: pristine reconnect, secret-only dirty footer Cancel, Keep editing, clean reversion, no writes; 320px and 1440px");
} finally {
  await browser.close();
  await server.close();
}
