import { describe, expect, it } from "vitest";
import { MAX_CHARACTERS, createDefaultCampaignState, townVariants } from "./campaign";

describe("createDefaultCampaignState", () => {
  it("starts empty but enforces campaign limits and defaults", () => {
    const state = createDefaultCampaignState();

    expect(state.characters).toHaveLength(0);
    expect(state.threatTracks).toHaveLength(3);
    expect(state.threatTracks.every((track) => track.value === "0")).toBe(true);
    expect(MAX_CHARACTERS).toBe(8);
    expect(townVariants).toContain("Fortified town");
  });
});
