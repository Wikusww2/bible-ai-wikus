import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";
import { existsSync,readFileSync } from "node:fs";
const hostingConfig: {d1?:string;r2?:string}=existsSync(".openai/hosting.json")?JSON.parse(readFileSync(".openai/hosting.json","utf8")):{d1:"DB",r2:"FILES"};

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const localVars: Record<string, string> = {};
if (process.env.SYNC_ENCRYPTION_KEY) localVars.SYNC_ENCRYPTION_KEY = process.env.SYNC_ENCRYPTION_KEY;

if(process.env.OWNER_EMAIL)localVars.OWNER_EMAIL=process.env.OWNER_EMAIL;
const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  vars: localVars,
  d1_databases: hostingConfig.d1 ? [{
    binding: hostingConfig.d1,
    database_name: "bible-ai-state",
    database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
  }] : [],
  r2_buckets: hostingConfig.r2 ? [{
    binding: hostingConfig.r2,
    bucket_name: "bible-ai-files",
  }] : [],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
