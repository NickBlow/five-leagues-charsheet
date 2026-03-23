export const MAX_CHARACTERS = 8;

export const townVariants = [
  "Fortified town",
  "Sanctuary camp",
  "Old rubble",
  "Scout camp",
  "Trading post",
  "Ancient city",
  "Mystic site",
] as const;

export const mapLocationKinds = [
  "town",
  "delve",
  "enemy-hideout",
  "unknown-location",
  "monster-lair",
  "enemy-camp",
] as const;

export const mapLocationLabels: Record<MapLocationKind, string> = {
  town: "Town",
  delve: "Delve",
  "enemy-hideout": "Enemy hideout",
  "unknown-location": "Unknown location",
  "monster-lair": "Monster lair",
  "enemy-camp": "Enemy camp",
};

export type TownVariant = (typeof townVariants)[number];
export type MapLocationKind = (typeof mapLocationKinds)[number];

export type AssetReference = {
  key: string;
  contentType: string;
};

export type CharacterSheet = {
  id: string;
  name: string;
  portrait: AssetReference | null;
  origin: string;
  agility: string;
  speed: string;
  combat: string;
  toughness: string;
  luck: string;
  will: string;
  casting: string;
  proficienciesAndSpells: string;
  skills: string;
  equipment: string;
  xp: string;
  level: string;
};

export type ThreatTrack = {
  id: string;
  label: string;
  value: string;
};

export type MapMarker = {
  id: string;
  title: string;
  kind: MapLocationKind;
  townVariant: TownVariant | "";
  image: AssetReference | null;
  x: number;
  y: number;
  notes: string;
  sourceHiddenSiteId?: string;
};

export type HiddenSite = {
  id: string;
  title: string;
  kind: Exclude<MapLocationKind, "town"> | "town";
  townVariant: TownVariant | "";
  image: AssetReference | null;
  notes: string;
};

export type PartyPosition = {
  x: number;
  y: number;
  notes: string;
};

export type DeletedMarker = {
  deletedAt: string;
  marker: MapMarker;
};

export type HexGridSettings = {
  visible: boolean;
  showNumbers: boolean;
  size: number;
};

export type CampaignState = {
  warbandName: string;
  region: string;
  currentLocation: string;
  storyPoints: string;
  goldMark: string;
  adventurePoints: string;
  equipmentStash: string;
  backpack: string;
  friendsKnown: string;
  hiddenLocations: string;
  questAndContractNotes: string;
  playerNotes: string;
  delveNotes: string;
  threatTracks: ThreatTrack[];
  characters: CharacterSheet[];
  map: {
    regionMap: AssetReference | null;
    partyPosition: PartyPosition | null;
    markers: MapMarker[];
    recentlyDeletedMarkers: DeletedMarker[];
    hiddenSites: HiddenSite[];
    hexGrid: HexGridSettings;
    markerLibrary: Partial<Record<MapLocationKind | TownVariant, AssetReference>>;
  };
};

export type CampaignVersion = {
  version: number;
  createdAt: string;
  reason: string;
};

export type CampaignSnapshot = {
  state: CampaignState;
  versions: CampaignVersion[];
};

export type CampaignAssets = {
  regionMapDataUrl: string | null;
  markerLibraryDataUrls: Partial<Record<MapLocationKind | TownVariant, string>>;
  entityAssetDataUrls: Record<string, string>;
};

export const markerAssetSlugs: Record<MapLocationKind | TownVariant, string> = {
  town: "town",
  delve: "delve",
  "enemy-hideout": "enemy-hideout",
  "unknown-location": "unknown-location",
  "monster-lair": "monster-lair",
  "enemy-camp": "enemy-camp",
  "Fortified town": "town-fortified-town",
  "Sanctuary camp": "town-sanctuary-camp",
  "Old rubble": "town-old-rubble",
  "Scout camp": "town-scout-camp",
  "Trading post": "town-trading-post",
  "Ancient city": "town-ancient-city",
  "Mystic site": "town-mystic-site",
};

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createCharacterSheet(): CharacterSheet {
  return {
    id: createId("character"),
    name: "",
    portrait: null,
    origin: "",
    agility: "",
    speed: "",
    combat: "",
    toughness: "",
    luck: "",
    will: "",
    casting: "",
    proficienciesAndSpells: "",
    skills: "",
    equipment: "",
    xp: "",
    level: "",
  };
}

function createThreatTrack(label: string): ThreatTrack {
  return {
    id: createId("threat"),
    label,
    value: "0",
  };
}

export function createDefaultCampaignState(): CampaignState {
  return {
    warbandName: "",
    region: "Northern Marches",
    currentLocation: "",
    storyPoints: "0",
    goldMark: "0",
    adventurePoints: "0",
    equipmentStash: "",
    backpack: "",
    friendsKnown: "",
    hiddenLocations: "",
    questAndContractNotes: "",
    playerNotes: "",
    delveNotes: "",
    threatTracks: [
      createThreatTrack("Rivals in the wilds"),
      createThreatTrack("Rumors of war"),
      createThreatTrack("A shadow in the hills"),
    ],
    characters: [],
    map: {
      regionMap: null,
      partyPosition: null,
      markers: [],
      recentlyDeletedMarkers: [],
      hiddenSites: [],
      hexGrid: {
        visible: true,
        showNumbers: false,
        size: 9,
      },
      markerLibrary: {},
    },
  };
}

export function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function normalizeCampaignState(state: CampaignState): CampaignState {
  return {
    ...state,
    storyPoints: state.storyPoints || "0",
    goldMark: state.goldMark || "0",
    adventurePoints: state.adventurePoints || "0",
    threatTracks: state.threatTracks.slice(0, 3),
    characters: state.characters.slice(0, MAX_CHARACTERS),
    map: {
      ...state.map,
      partyPosition: state.map.partyPosition
        ? {
            ...state.map.partyPosition,
            x: clampUnit(state.map.partyPosition.x),
            y: clampUnit(state.map.partyPosition.y),
          }
        : null,
      markers: state.map.markers.map((marker) => ({
        ...marker,
        image: marker.image ?? null,
        x: clampUnit(marker.x),
        y: clampUnit(marker.y),
      })),
      recentlyDeletedMarkers: (state.map.recentlyDeletedMarkers ?? []).slice(0, 12).map((entry) => ({
        deletedAt: entry.deletedAt,
        marker: {
          ...entry.marker,
          image: entry.marker.image ?? null,
          x: clampUnit(entry.marker.x),
          y: clampUnit(entry.marker.y),
        },
      })),
      hiddenSites: (state.map.hiddenSites ?? []).map((site) => ({
        ...site,
        kind: site.kind ?? "delve",
        townVariant: site.kind === "town" ? site.townVariant || townVariants[0] : "",
        image: site.image ?? null,
      })),
      hexGrid: {
        visible: state.map.hexGrid?.visible ?? true,
        showNumbers: state.map.hexGrid?.showNumbers ?? false,
        size: Math.min(18, Math.max(4, Number(state.map.hexGrid?.size ?? 9))),
      },
    },
  };
}

export function markerLibraryKey(marker: Pick<MapMarker, "kind" | "townVariant">) {
  return marker.kind === "town" && marker.townVariant ? marker.townVariant : marker.kind;
}

export function getMarkerPreview(
  marker: { kind: MapLocationKind; townVariant: TownVariant | "" },
  assets: CampaignAssets,
) {
  const key = markerLibraryKey(marker);
  return assets.markerLibraryDataUrls[key] ?? getStaticMarkerAssetPath(key);
}

export function getStaticMarkerAssetPath(key: MapLocationKind | TownVariant) {
  return `/marker-library/${markerAssetSlugs[key]}.png`;
}

export function getPartyPositionAssetPath() {
  return "/marker-library/party-horse.png";
}
