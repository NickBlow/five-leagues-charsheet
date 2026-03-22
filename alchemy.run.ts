import alchemy, { type Scope } from "alchemy";
import { DurableObjectNamespace, R2Bucket, TanStackStart } from "alchemy/cloudflare";
import { CloudflareStateStore, SQLiteStateStore } from "alchemy/state";

const stateStore = (scope: Scope) =>
  scope.local ? new SQLiteStateStore(scope, { engine: "libsql" }) : new CloudflareStateStore(scope);

const app = await alchemy("five-leagues-charsheet", {
  stateStore,
  profile: "prod",
  destroyOrphans: false,
  phase: process.argv.includes("--destroy") ? "destroy" : "up",
});

const stage = app.stage;
const isProd = stage === "prod";

const campaignStore = DurableObjectNamespace("campaign-store", {
  className: "CampaignStore",
  sqlite: true,
});

const campaignAssets = await R2Bucket("campaign-assets", {
  name: isProd ? "five-leagues-assets" : `five-leagues-assets-${stage}`,
  adopt: isProd,
  delete: !isProd,
  empty: !isProd,
});

export const website = await TanStackStart("five-leagues-website", {
  name: isProd ? "five-leagues-charsheet" : undefined,
  adopt: isProd,
  wrangler: {
    path: "wrangler.jsonc",
    main: "src/server.ts",
  },
  domains: [{domainName: "five-leagues.familiar.games",  zoneId: "a2855f9f12ac58a2fa54686e2bbbc883"}],
  bindings: {
    CAMPAIGN_STORE: campaignStore,  
    CAMPAIGN_ASSETS: campaignAssets,
  },
  build: {
    command: "pnpm build",
    env: { NODE_ENV: "production" },
  },
  dev: {
    command: "pnpm dev", 
    env: { NODE_ENV: "development" },
  },
});

console.log({
  stage,
  url: website.url,
  bucket: campaignAssets.name,
});

await app.finalize();
