import { DurableObject } from "cloudflare:workers";
import {
  createDefaultCampaignState,
  normalizeCampaignState,
  type CampaignSnapshot,
  type CampaignState,
  type CampaignVersion,
} from "../lib/campaign";

const MAX_VERSIONS = 120;

type SnapshotRow = {
  version: number;
  created_at: string;
  reason: string;
  state_json: string;
};

type CurrentStateRow = {
  state_json: string;
};

export class CampaignStore extends DurableObject<Env> {
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private init() {
    if (this.initialized) {
      return;
    }

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS current_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        version INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reason TEXT NOT NULL,
        state_json TEXT NOT NULL
      );
    `);

    this.initialized = true;
  }

  private getCurrentStateRow() {
    this.init();
    const rows = this.ctx.storage.sql
      .exec("SELECT state_json FROM current_state WHERE id = 1")
      .toArray() as CurrentStateRow[];

    return rows[0] ?? null;
  }

  private parseState(stateJson: string): CampaignState {
    return normalizeCampaignState(JSON.parse(stateJson) as CampaignState);
  }

  private listVersionsInternal(limit = 20): CampaignVersion[] {
    this.init();
    const safeLimit = Math.max(1, Math.floor(limit));
    return this.ctx.storage.sql
      .exec(`SELECT version, created_at, reason FROM snapshots ORDER BY version DESC LIMIT ${safeLimit}`)
      .toArray()
      .map((row) => ({
        version: Number(row.version),
        createdAt: String(row.created_at),
        reason: String(row.reason),
      }));
  }

  private saveInternal(state: CampaignState, reason: string) {
    this.init();
    const normalized = normalizeCampaignState(state);
    const stateJson = JSON.stringify(normalized);

    this.ctx.storage.sql.exec(
      `
        INSERT INTO current_state (id, state_json, updated_at)
        VALUES (1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP
      `,
      stateJson,
    );

    this.ctx.storage.sql.exec(
      "INSERT INTO snapshots (reason, state_json) VALUES (?, ?)",
      reason,
      stateJson,
    );

    this.ctx.storage.sql.exec(
      `
        DELETE FROM snapshots
        WHERE version IN (
          SELECT version FROM snapshots
          ORDER BY version DESC
          LIMIT -1 OFFSET ${MAX_VERSIONS}
        )
      `,
    );

    return normalized;
  }

  async getSnapshot(): Promise<CampaignSnapshot> {
    const row = this.getCurrentStateRow();

    if (!row) {
      const state = this.saveInternal(createDefaultCampaignState(), "Initial campaign sheet");
      return {
        state,
        versions: this.listVersionsInternal(),
      };
    }

    return {
      state: this.parseState(row.state_json),
      versions: this.listVersionsInternal(),
    };
  }

  async saveSnapshot(input: { state: CampaignState; reason: string }) {
    const state = this.saveInternal(input.state, input.reason || "Manual save");
    return {
      state,
      versions: this.listVersionsInternal(),
    } satisfies CampaignSnapshot;
  }

  async getVersion(version: number) {
    this.init();
    const safeVersion = Math.max(1, Math.floor(version));
    const rows = this.ctx.storage.sql
      .exec(`SELECT version, created_at, reason, state_json FROM snapshots WHERE version = ${safeVersion}`)
      .toArray() as SnapshotRow[];

    const row = rows[0] ?? null;

    if (!row) {
      return null;
    }

    return {
      version: Number(row.version),
      createdAt: String(row.created_at),
      reason: String(row.reason),
      state: this.parseState(row.state_json),
    };
  }

  async restoreVersion(version: number) {
    const snapshot = await this.getVersion(version);

    if (!snapshot) {
      return null;
    }

    return this.saveSnapshot({
      state: snapshot.state,
      reason: `Restored version ${version}`,
    });
  }
}
