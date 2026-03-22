import type { CampaignStore } from "./server/campaign-store";

declare global {
  interface Env {
    CAMPAIGN_STORE: DurableObjectNamespace<CampaignStore>;
    CAMPAIGN_ASSETS: R2Bucket;
  }
}

export {};
