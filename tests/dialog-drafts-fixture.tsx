import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initializeLanguage } from "@fixture/i18n";
import { modules } from "@fixture/registry";
import "@fixture/sdk";
import "@fixture/style";
import "@fixture/design";
import "@fixture/home";

const calls: { method: string; path: string }[] = [];
const writes: { method: string; path: string }[] = [];
const connection = {
  id: "synthetic-connection",
  type: "proxmox",
  name: "Fixture Proxmox",
  url: "https://proxmox.example.test",
  username: "fixture-operator",
  skipTLSVerify: false,
};
window.integrationWidgetFixture = { calls, writes };
window.fetch = async (input, init) => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const url = new URL(raw, location.href);
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  calls.push({ method, path: url.pathname });
  if (
    url.pathname ===
      "/api/v1/module-api/integration-widgets/connections" &&
    method === "GET"
  )
    return Response.json([connection]);
  if (
    url.pathname ===
      "/api/v1/module-api/integration-widgets/connections/test" &&
    method === "POST"
  )
    return Response.json({ ok: true });
  if (
    url.pathname ===
      "/api/v1/module-api/integration-widgets/connections" &&
    method === "POST"
  ) {
    writes.push({ method, path: url.pathname });
    return Response.json(connection);
  }
  writes.push({ method, path: url.pathname });
  return Response.json({ error: "Unexpected synthetic fixture request" }, { status: 404 });
};

await initializeLanguage("en");
document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") ?? "light";
document.documentElement.dataset.surface = new URLSearchParams(location.search).get("surface") ?? "solid";
const style = document.createElement("link");
style.rel = "stylesheet";
style.href = "/dist/ui/index.css";
document.head.append(style);
await new Promise<void>((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "/dist/ui/index.js";
  script.onload = () => resolve();
  script.onerror = () => reject(Error("Built integration-widgets bundle failed to load"));
  document.head.append(script);
});
const definition = modules().find((module) => module.id === "integration-widgets");
const Settings = definition?.settings?.[0]?.component;
if (!Settings) throw Error("Integration widgets settings did not register");
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <Settings />
  </QueryClientProvider>,
);

declare global {
  interface Window {
    integrationWidgetFixture: {
      calls: { method: string; path: string }[];
      writes: { method: string; path: string }[];
    };
  }
}
