import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import {
  type AssetReference,
  type CampaignAssets,
  type CampaignSnapshot,
  type CampaignState,
} from "../lib/campaign";

type UploadAssetInput = {
  campaignCode: string;
  dataUrl: string;
  fileName: string;
};

type UploadCampaignAssetInput = UploadAssetInput & {
  kind: "companion" | "location";
};

type AssetUploadPayload = {
  dataUrl: string;
  fileName: string;
};

type SaveCampaignInput = {
  campaignCode: string;
  state: CampaignState;
  reason: string;
};

type RestoreInput = {
  campaignCode: string;
  version: number;
};

type LoadCampaignInput = {
  campaignCode: string;
};

type CampaignResponse = {
  snapshot: CampaignSnapshot;
  assets: CampaignAssets;
};

type UploadAssetResponse = {
  asset: AssetReference;
  dataUrl: string;
};

function getCampaignStub(campaignCode: string) {
  const id = env.CAMPAIGN_STORE.idFromName(campaignCode);
  return env.CAMPAIGN_STORE.get(id);
}

function toSerializable<T>(value: T): T {
  return structuredClone(value);
}

function sanitizeSnapshot(snapshot: CampaignSnapshot): CampaignSnapshot {
  return {
    state: toSerializable(snapshot.state),
    versions: snapshot.versions.map((version) => ({
      version: version.version,
      createdAt: version.createdAt,
      reason: version.reason,
    })),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  assert(match, "Invalid data URL payload.");

  return {
    contentType: match[1],
    bytes: Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0)),
  };
}

function createAssetKey(prefix: string, fileName: string, extension: string) {
  const safeName = fileName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  return `${prefix}/${Date.now()}-${safeName || "asset"}-${crypto.randomUUID()}.${extension}`;
}

async function saveDataUrlAsset(prefix: string, input: AssetUploadPayload): Promise<AssetReference> {
  const { contentType, bytes } = parseDataUrl(input.dataUrl);
  const extension = contentType.split("/")[1] || "bin";
  const key = createAssetKey(prefix, input.fileName, extension);

  await env.CAMPAIGN_ASSETS.put(key, bytes, {
    httpMetadata: {
      contentType,
    },
  });

  return {
    key,
    contentType,
  };
}

function assetToUrl(asset: AssetReference | null) {
  if (!asset) {
    return null;
  }

  return `/api/assets?key=${encodeURIComponent(asset.key)}`;
}

async function resolveAssets(snapshot: CampaignSnapshot): Promise<CampaignAssets> {
  const libraryEntries = Object.entries(snapshot.state.map.markerLibrary).map(([key, asset]) => {
      if (!asset) {
        return null;
      }

      return [key, assetToUrl(asset)] as const;
    });

  return {
    regionMapDataUrl: assetToUrl(snapshot.state.map.regionMap),
    markerLibraryDataUrls: Object.fromEntries(
      libraryEntries.filter((entry): entry is readonly [string, string | null] => entry !== null),
    ) as CampaignAssets["markerLibraryDataUrls"],
    entityAssetDataUrls: Object.fromEntries(
      [
        ...snapshot.state.characters
          .filter((character) => character.portrait)
          .map((character) => [character.id, assetToUrl(character.portrait)] as const),
        ...snapshot.state.map.hiddenSites
          .filter((site) => site.image)
          .map((site) => [site.id, assetToUrl(site.image)] as const),
        ...snapshot.state.map.markers
          .filter((marker) => marker.image)
          .map((marker) => [marker.id, assetToUrl(marker.image)] as const),
      ].filter((entry): entry is readonly [string, string | null] => Boolean(entry[1])),
    ) as Record<string, string>,
  };
}

export const loadCampaign = createServerFn({ method: "GET" })
  .inputValidator((input: LoadCampaignInput) => input)
  .handler<Promise<CampaignResponse>>(async ({ data }) => {
  const stub = getCampaignStub(data.campaignCode);
  const snapshot = sanitizeSnapshot(await stub.getSnapshot());
  return {
    snapshot,
    assets: await resolveAssets(snapshot),
  };
});

export const saveCampaign = createServerFn({ method: "POST" })
  .inputValidator((input: SaveCampaignInput) => input)
  .handler<Promise<CampaignResponse>>(async ({ data }) => {
    const stub = getCampaignStub(data.campaignCode);
    const snapshot = sanitizeSnapshot(
      await stub.saveSnapshot({ state: data.state, reason: data.reason }),
    );
    return {
      snapshot,
      assets: await resolveAssets(snapshot),
    };
  });

export const restoreCampaignVersion = createServerFn({ method: "POST" })
  .inputValidator((input: RestoreInput) => input)
  .handler<Promise<CampaignResponse>>(async ({ data }) => {
    const stub = getCampaignStub(data.campaignCode);
    const restored = await stub.restoreVersion(data.version);
    const snapshot = restored ? sanitizeSnapshot(restored) : null;
    assert(snapshot, `Version ${data.version} was not found.`);
    return {
      snapshot,
      assets: await resolveAssets(snapshot),
    };
  });

export const uploadRegionMap = createServerFn({ method: "POST" })
  .inputValidator((input: UploadAssetInput) => input)
  .handler<Promise<CampaignResponse>>(async ({ data }) => {
    const stub = getCampaignStub(data.campaignCode);
    const current = sanitizeSnapshot(await stub.getSnapshot());
    const asset = await saveDataUrlAsset("maps", data);

    const snapshot = sanitizeSnapshot(await stub.saveSnapshot({
      state: {
        ...current.state,
        map: {
          ...current.state.map,
          regionMap: asset,
        },
      },
      reason: "Uploaded region map",
    }));

    return {
      snapshot,
      assets: await resolveAssets(snapshot),
    };
  });

export const uploadCampaignAsset = createServerFn({ method: "POST" })
  .inputValidator((input: UploadCampaignAssetInput) => input)
  .handler<Promise<UploadAssetResponse>>(async ({ data }) => {
    void data.campaignCode;
    const prefix = data.kind === "companion" ? "companions" : "locations";
    const asset = await saveDataUrlAsset(prefix, data);
    return {
      asset,
      dataUrl: data.dataUrl,
    };
  });
