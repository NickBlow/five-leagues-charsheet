import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  Download,
  ImagePlus,
  MapPinned,
  Mountain,
  PenSquare,
  Search,
  Save,
  Swords,
  Upload,
} from "lucide-react";
import {
  MAX_CHARACTERS,
  clampUnit,
  createCharacterSheet,
  getMarkerPreview,
  getPartyPositionAssetPath,
  getStaticMarkerAssetPath,
  mapLocationKinds,
  mapLocationLabels,
  townVariants,
  type CampaignAssets,
  type CampaignSnapshot,
  type CampaignState,
  type CharacterSheet,
  type HiddenSite,
  type MapLocationKind,
  type MapMarker,
  type Subregion,
  type TownVariant,
} from "../lib/campaign";
import {
  restoreCampaignVersion,
  saveCampaign,
  uploadCampaignAsset,
  uploadRegionMap,
} from "../server/campaign-api";

type SaveResult = {
  snapshot: CampaignSnapshot;
  assets: CampaignAssets;
};

type DraftSubregion = {
  title: string;
  notes: string;
  color: string;
  points: Array<{ x: number; y: number }>;
};

type WorkspaceProps = {
  campaignCode: string;
  initialSnapshot: CampaignSnapshot;
  initialAssets: CampaignAssets;
};

type WorkspaceTab = "roster" | "campaign" | "map";
type MarkerLibraryItemKey = MapLocationKind | TownVariant | "party-position";

const RECENT_CAMPAIGNS_KEY = "five-leagues-recent-campaigns";

const subregionPalette = ["#b15835", "#4b6f52", "#2f5c7a", "#7e6651"] as const;

function createMarkerFromLibraryKey(key: MarkerLibraryItemKey, point: { x: number; y: number }): MapMarker {
  if (key === "party-position") {
    throw new Error("Party position is not a standard marker.");
  }

  const isTownVariant = townVariants.includes(key as TownVariant);
  return {
    id: crypto.randomUUID(),
    title: isTownVariant ? key : mapLocationLabels[key as MapLocationKind],
    kind: isTownVariant ? "town" : (key as MapLocationKind),
    townVariant: isTownVariant ? (key as TownVariant) : "",
    image: null,
    x: point.x,
    y: point.y,
    notes: "",
  };
}

function createDraftSubregion(): DraftSubregion {
  return {
    title: "",
    notes: "",
    color: subregionPalette[Math.floor(Math.random() * subregionPalette.length)],
    points: [],
  };
}

function createHiddenSite(): HiddenSite {
  return {
    id: crypto.randomUUID(),
    title: "",
    kind: "delve",
    townVariant: "",
    image: null,
    notes: "",
  };
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string") {
        resolve(value);
        return;
      }

      reject(new Error("Could not read the selected file."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getTabFromHash(): WorkspaceTab {
  if (typeof window === "undefined") {
    return "roster";
  }

  const hash = window.location.hash.replace(/^#/, "");
  return hash === "campaign" || hash === "map" ? hash : "roster";
}

export default function CampaignWorkspace({ campaignCode, initialSnapshot, initialAssets }: WorkspaceProps) {
  const [state, setState] = useState(initialSnapshot.state);
  const [versions, setVersions] = useState(initialSnapshot.versions);
  const [assets, setAssets] = useState(initialAssets);
  const [mapAspectRatio, setMapAspectRatio] = useState(4 / 3);
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [showSubregions, setShowSubregions] = useState(true);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("roster");
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [selectedSubregionId, setSelectedSubregionId] = useState<string | null>(null);
  const [selectedHiddenSiteId, setSelectedHiddenSiteId] = useState<string | null>(null);
  const [isPartyPositionSelected, setIsPartyPositionSelected] = useState(false);
  const [placementMode, setPlacementMode] = useState<"party-position" | null>(null);
  const [draftSubregion, setDraftSubregion] = useState<DraftSubregion | null>(null);
  const [draggingTarget, setDraggingTarget] = useState<string | "party" | null>(null);
  const [dragPointerOffset, setDragPointerOffset] = useState<{ x: number; y: number } | null>(null);
  const [draggingSubregionId, setDraggingSubregionId] = useState<string | null>(null);
  const [draggingSubregionPoint, setDraggingSubregionPoint] = useState<{ subregionId: string; pointIndex: number } | null>(null);
  const [lastSubregionPointerPoint, setLastSubregionPointerPoint] = useState<{ x: number; y: number } | null>(null);
  const [draggingHiddenSiteId, setDraggingHiddenSiteId] = useState<string | null>(null);
  const [draggingLibraryItem, setDraggingLibraryItem] = useState<MarkerLibraryItemKey | null>(null);
  const [isMapDropActive, setIsMapDropActive] = useState(false);
  const [pendingMessage, setPendingMessage] = useState("Ready to chart the borderlands.");
  const [busy, setBusy] = useState<null | "save" | "map" | "restore">(null);
  const lastPersistedStateRef = useRef(JSON.stringify(initialSnapshot.state));
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const [isPanningMap, setIsPanningMap] = useState(false);
  const [lastPanClientPoint, setLastPanClientPoint] = useState<{ x: number; y: number } | null>(null);

  const selectedMarker = useMemo(
    () => state.map.markers.find((marker) => marker.id === selectedMarkerId) ?? null,
    [selectedMarkerId, state.map.markers],
  );

  const selectedSubregion = useMemo(
    () => state.map.subregions.find((subregion) => subregion.id === selectedSubregionId) ?? null,
    [selectedSubregionId, state.map.subregions],
  );

  const selectedHiddenSite = useMemo(
    () => state.map.hiddenSites.find((site) => site.id === selectedHiddenSiteId) ?? null,
    [selectedHiddenSiteId, state.map.hiddenSites],
  );

  const hasMapSelection = Boolean(selectedMarker || selectedSubregion || selectedHiddenSite || isPartyPositionSelected);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const existing = JSON.parse(window.localStorage.getItem(RECENT_CAMPAIGNS_KEY) ?? "[]") as string[];
      const next = [campaignCode, ...existing.filter((code) => code !== campaignCode)].slice(0, 8);
      window.localStorage.setItem(RECENT_CAMPAIGNS_KEY, JSON.stringify(next));
    } catch {
      window.localStorage.setItem(RECENT_CAMPAIGNS_KEY, JSON.stringify([campaignCode]));
    }
  }, [campaignCode]);

  useEffect(() => {
    if (!assets.regionMapDataUrl || typeof window === "undefined") {
      setMapAspectRatio(4 / 3);
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setMapAspectRatio(image.naturalWidth / image.naturalHeight);
      }
    };
    image.src = assets.regionMapDataUrl;
  }, [assets.regionMapDataUrl]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setActiveTab(getTabFromHash());
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextHash = `#${activeTab}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const getPointFromClient = (clientX: number, clientY: number) => {
      const element = mapViewportRef.current;
      if (!element) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return null;
      }

      return {
        x: clampUnit((clientX - rect.left) / rect.width),
        y: clampUnit((clientY - rect.top) / rect.height),
      };
    };

    const clearDragging = () => {
      setDraggingTarget(null);
      setDragPointerOffset(null);
      setDraggingSubregionId(null);
      setDraggingSubregionPoint(null);
      setLastSubregionPointerPoint(null);
      setIsPanningMap(false);
      setLastPanClientPoint(null);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (isPanningMap && lastPanClientPoint) {
        setMapPan((current) => ({
          x: current.x + (event.clientX - lastPanClientPoint.x),
          y: current.y + (event.clientY - lastPanClientPoint.y),
        }));
        setLastPanClientPoint({ x: event.clientX, y: event.clientY });
        return;
      }

      const point = getPointFromClient(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      if (draggingSubregionPoint) {
        updateSubregion(draggingSubregionPoint.subregionId, setState, (subregion) => ({
          ...subregion,
          points: subregion.points.map((currentPoint, index) =>
            index === draggingSubregionPoint.pointIndex ? point : currentPoint,
          ),
        }));
        return;
      }

      if (draggingSubregionId && lastSubregionPointerPoint) {
        const dx = point.x - lastSubregionPointerPoint.x;
        const dy = point.y - lastSubregionPointerPoint.y;
        updateSubregion(draggingSubregionId, setState, (subregion) => ({
          ...subregion,
          points: subregion.points.map((currentPoint) => ({
            x: clampUnit(currentPoint.x + dx),
            y: clampUnit(currentPoint.y + dy),
          })),
        }));
        setLastSubregionPointerPoint(point);
        return;
      }

      if (!draggingTarget) {
        return;
      }

      const nextPoint = dragPointerOffset
        ? {
            x: clampUnit(point.x + dragPointerOffset.x),
            y: clampUnit(point.y + dragPointerOffset.y),
          }
        : point;

      setState((current) => ({
        ...current,
        map: {
          ...current.map,
          partyPosition:
            draggingTarget === "party" && current.map.partyPosition
              ? { ...current.map.partyPosition, x: nextPoint.x, y: nextPoint.y }
              : current.map.partyPosition,
          markers: current.map.markers.map((marker) =>
            marker.id === draggingTarget ? { ...marker, x: nextPoint.x, y: nextPoint.y } : marker,
          ),
        },
      }));
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", clearDragging);
    window.addEventListener("pointercancel", clearDragging);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", clearDragging);
      window.removeEventListener("pointercancel", clearDragging);
    };
  }, [dragPointerOffset, draggingSubregionId, draggingSubregionPoint, draggingTarget, isPanningMap, lastPanClientPoint, lastSubregionPointerPoint]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (isTypingTarget) {
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (selectedMarkerId) {
          deleteMarker(selectedMarkerId);
          return;
        }

        if (selectedSubregionId) {
          deleteSubregion(selectedSubregionId);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedMarkerId, selectedSubregionId]);

  useEffect(() => {
    const serializedState = JSON.stringify(state);
    if (serializedState === lastPersistedStateRef.current) {
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      void saveCampaign({
        data: { campaignCode, state, reason: "Autosave" },
      })
        .then((result) => {
          lastPersistedStateRef.current = JSON.stringify(result.snapshot.state);
          applyServerResult(result);
          setPendingMessage("Autosaved.");
        })
        .catch((error) => {
          setPendingMessage(error instanceof Error ? error.message : String(error));
        });
    }, 900);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [campaignCode, state]);

  useEffect(() => {
    if (typeof window === "undefined" || assets.regionMapDataUrl) {
      return;
    }

    let dragDepth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!getDraggedImageFile(event.dataTransfer ?? null)) {
        return;
      }

      event.preventDefault();
      dragDepth += 1;
      setIsMapDropActive(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!getDraggedImageFile(event.dataTransfer ?? null)) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setIsMapDropActive(true);
    };

    const onDragLeave = (event: DragEvent) => {
      if (!getDraggedImageFile(event.dataTransfer ?? null)) {
        return;
      }

      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setIsMapDropActive(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      const imageFile = getDraggedImageFile(event.dataTransfer ?? null);
      dragDepth = 0;
      setIsMapDropActive(false);

      if (!imageFile) {
        return;
      }

      event.preventDefault();
      void uploadMapFile(imageFile);
    };

    const options = { capture: true } as const;

    window.addEventListener("dragenter", onDragEnter, options);
    window.addEventListener("dragover", onDragOver, options);
    window.addEventListener("dragleave", onDragLeave, options);
    window.addEventListener("drop", onDrop, options);
    document.addEventListener("dragenter", onDragEnter, options);
    document.addEventListener("dragover", onDragOver, options);
    document.addEventListener("dragleave", onDragLeave, options);
    document.addEventListener("drop", onDrop, options);

    return () => {
      window.removeEventListener("dragenter", onDragEnter, options);
      window.removeEventListener("dragover", onDragOver, options);
      window.removeEventListener("dragleave", onDragLeave, options);
      window.removeEventListener("drop", onDrop, options);
      document.removeEventListener("dragenter", onDragEnter, options);
      document.removeEventListener("dragover", onDragOver, options);
      document.removeEventListener("dragleave", onDragLeave, options);
      document.removeEventListener("drop", onDrop, options);
    };
  }, [assets.regionMapDataUrl]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onImageDrop = (event: Event) => {
      if (assets.regionMapDataUrl) {
        return;
      }

      const customEvent = event as CustomEvent<{ files: File[] }>;
      const file = customEvent.detail?.files?.[0];
      if (!file) {
        return;
      }

      setIsMapDropActive(false);
      void uploadMapFile(file);
    };

    window.addEventListener("five-leagues:image-drop", onImageDrop);
    return () => {
      window.removeEventListener("five-leagues:image-drop", onImageDrop);
    };
  }, [assets.regionMapDataUrl]);

  function applyServerResult(result: SaveResult) {
    lastPersistedStateRef.current = JSON.stringify(result.snapshot.state);
    setState(result.snapshot.state);
    setVersions(result.snapshot.versions);
    setAssets(result.assets);
  }

  function updateState(updater: (current: CampaignState) => CampaignState) {
    setState((current) => updater(current));
  }

  function getEntityAssetDataUrl(entityId: string, fallback: string | null = null) {
    return assets.entityAssetDataUrls[entityId] ?? fallback;
  }

  function getDraggedImageFile(dataTransfer: DataTransfer | null) {
    if (!dataTransfer) {
      return null;
    }

    return Array.from(dataTransfer.files).find((file) => file.type.startsWith("image/")) ?? null;
  }

  function clearMapSelection() {
    setSelectedMarkerId(null);
    setSelectedSubregionId(null);
    setSelectedHiddenSiteId(null);
    setIsPartyPositionSelected(false);
  }

  function setMapZoomCentered(nextZoom: number) {
    const clampedZoom = Math.min(2.5, Math.max(0.6, Number(nextZoom.toFixed(2))));
    const container = mapContainerRef.current;
    const focusPoint = state.map.partyPosition;

    if (!container || !focusPoint) {
      setMapZoom(clampedZoom);
      return;
    }

    const rect = container.getBoundingClientRect();
    setMapZoom(clampedZoom);
    setMapPan({
      x: rect.width / 2 - focusPoint.x * rect.width * clampedZoom,
      y: rect.height / 2 - focusPoint.y * rect.height * clampedZoom,
    });
  }

  function deleteMarker(markerId: string) {
    setState((current) => {
      const marker = current.map.markers.find((candidate) => candidate.id === markerId);
      if (!marker) {
        return current;
      }

      return {
        ...current,
        map: {
          ...current.map,
          markers: current.map.markers.filter((candidate) => candidate.id !== markerId),
          recentlyDeletedMarkers: [
            {
              deletedAt: new Date().toISOString(),
              marker,
            },
            ...current.map.recentlyDeletedMarkers,
          ].slice(0, 12),
        },
      };
    });
    setSelectedMarkerId(null);
    setPendingMessage("Location removed from the map.");
  }

  function deleteSubregion(subregionId: string) {
    setState((current) => {
      const subregion = current.map.subregions.find((candidate) => candidate.id === subregionId);
      if (!subregion) {
        return current;
      }

      return {
        ...current,
        map: {
          ...current.map,
          subregions: current.map.subregions.filter((candidate) => candidate.id !== subregionId),
          recentlyDeletedSubregions: [
            {
              deletedAt: new Date().toISOString(),
              subregion,
            },
            ...current.map.recentlyDeletedSubregions,
          ].slice(0, 12),
        },
      };
    });
    setSelectedSubregionId(null);
    setPendingMessage("Subregion removed from the map.");
  }

  async function runTask(kind: NonNullable<typeof busy>, task: () => Promise<void>) {
    setBusy(kind);
    try {
      await task();
    } catch (error) {
      setPendingMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveState(reason: string) {
    await runTask("save", async () => {
      const result = await saveCampaign({ data: { campaignCode, state, reason } });
      applyServerResult(result);
      setPendingMessage(`${reason} saved.`);
    });
  }

  async function uploadCharacterPortrait(characterId: string, file: File) {
    await runTask("map", async () => {
      const dataUrl = await fileToDataUrl(file);
      const result = await uploadCampaignAsset({
        data: { campaignCode, kind: "companion", dataUrl, fileName: file.name },
      });
      setAssets((current) => ({
        ...current,
        entityAssetDataUrls: {
          ...current.entityAssetDataUrls,
          [characterId]: result.dataUrl,
        },
      }));
      updateState((current) => ({
        ...current,
        characters: current.characters.map((character) =>
          character.id === characterId ? { ...character, portrait: result.asset } : character,
        ),
      }));
      setPendingMessage(`${file.name} added to the adventurer card.`);
    });
  }

  async function uploadLocationImage(markerId: string, file: File) {
    await runTask("map", async () => {
      const dataUrl = await fileToDataUrl(file);
      const result = await uploadCampaignAsset({
        data: { campaignCode, kind: "location", dataUrl, fileName: file.name },
      });
      setAssets((current) => ({
        ...current,
        entityAssetDataUrls: {
          ...current.entityAssetDataUrls,
          [markerId]: result.dataUrl,
        },
      }));
      updateMarker(markerId, setState, (marker) => ({ ...marker, image: result.asset }));
      setPendingMessage(`${file.name} attached to the location.`);
    });
  }

  async function uploadMapFile(file: File) {
    await runTask("map", async () => {
      const dataUrl = await fileToDataUrl(file);
      const result = await uploadRegionMap({ data: { campaignCode, dataUrl, fileName: file.name } });
      applyServerResult(result);
      setPendingMessage(`Uploaded ${file.name}.`);
    });
  }

  function clearRegionMap() {
    updateState((current) => ({
      ...current,
      map: {
        ...current.map,
        regionMap: null,
      },
    }));
    setAssets((current) => ({
      ...current,
      regionMapDataUrl: null,
    }));
    setMapZoom(1);
    setMapPan({ x: 0, y: 0 });
    setPendingMessage("Removed region map background.");
  }

  async function handleDroppedMapFile(dataTransfer: DataTransfer | null) {
    const imageFile = getDraggedImageFile(dataTransfer);
    if (!imageFile || assets.regionMapDataUrl) {
      return false;
    }

    await uploadMapFile(imageFile);
    return true;
  }

  function updateCharacter(index: number, updater: (character: CharacterSheet) => CharacterSheet) {
    updateState((current) => ({
      ...current,
      characters: current.characters.map((character, characterIndex) =>
        characterIndex === index ? updater(character) : character,
      ),
    }));
  }

  function updateHiddenSite(hiddenSiteId: string, updater: (site: HiddenSite) => HiddenSite) {
    updateState((current) => ({
      ...current,
      map: {
        ...current.map,
        hiddenSites: current.map.hiddenSites.map((site) =>
          site.id === hiddenSiteId ? updater(site) : site,
        ),
      },
    }));
  }

  function getRelativePoint(target: EventTarget | null, clientX: number, clientY: number) {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    return {
      x: clampUnit((clientX - rect.left) / rect.width),
      y: clampUnit((clientY - rect.top) / rect.height),
    };
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
      <section className="grid gap-4 rounded-[28px] border border-[var(--border-strong)] bg-[var(--panel)] p-6 shadow-[0_24px_80px_rgba(42,27,14,0.14)] lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--ink-muted)]">Five Leagues from the Borderlands</p>
          <h1 className="font-display text-4xl text-[var(--ink)] md:text-6xl">Warband chronicle, roster, and living region map.</h1>
          <p className="max-w-3xl text-sm leading-7 text-[var(--ink-soft)] md:text-base">
            Track a full band of eight adventurers, keep the campaign sheet in one place, and pin every delve, hideout,
            and sanctuary straight onto your uploaded region map.
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-[var(--ink-soft)]">
            <StatusPill icon={<Swords className="h-4 w-4" />}>{state.characters.length}/{MAX_CHARACTERS} adventurers</StatusPill>
            <StatusPill icon={<MapPinned className="h-4 w-4" />}>{state.map.markers.length} map locations</StatusPill>
            <StatusPill icon={<Mountain className="h-4 w-4" />}>{state.map.subregions.length} subregions</StatusPill>
          </div>
        </div>
        <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Campaign actions</p>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{pendingMessage}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[var(--ink-muted)]">/{campaignCode}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/"
                search={{ picker: "1" }}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 py-3 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
              >
                Warbands
              </Link>
              <button
                type="button"
                onClick={() => void saveState("Manual save")}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                Save Chronicle
              </button>
            </div>
          </div>
          <div className="mt-6 grid gap-3 text-sm text-[var(--ink-soft)] sm:grid-cols-3">
            <StatTile label="Story points" value={state.storyPoints || "0"} />
            <StatTile label="Gold marks" value={state.goldMark || "0"} />
            <StatTile label="Adventure points" value={state.adventurePoints || "0"} />
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-3 rounded-[24px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-3">
        {[
          ["roster", "Roster"],
          ["campaign", "Campaign"],
          ["map", "Map"],
        ].map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab as WorkspaceTab)}
            className={`rounded-full px-4 py-2 text-sm transition ${
              activeTab === tab
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border-strong)] bg-white/60 text-[var(--ink)] hover:bg-white/80"
            }`}
          >
            {label}
          </button>
        ))}
      </section>

      <div className="space-y-6">
        {activeTab === "roster" ? (
          <SectionCard title="Warband roster" icon={<Swords className="h-5 w-5" />} description="Mirror the roster sheet and keep every hero ready for the next expedition.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Warband name">
                <Input value={state.warbandName} onChange={(value) => updateState((current) => ({ ...current, warbandName: value }))} />
              </Field>
              <Field label="Region">
                <Input value={state.region} onChange={(value) => updateState((current) => ({ ...current, region: value }))} />
              </Field>
              <Field label="Current location">
                <Input value={state.currentLocation} onChange={(value) => updateState((current) => ({ ...current, currentLocation: value }))} />
              </Field>
              <Field label="Story points">
                <Input value={state.storyPoints} onChange={(value) => updateState((current) => ({ ...current, storyPoints: value }))} />
              </Field>
              <Field label="Gold marks">
                <Input value={state.goldMark} onChange={(value) => updateState((current) => ({ ...current, goldMark: value }))} />
              </Field>
              <Field label="Adventure points">
                <Input value={state.adventurePoints} onChange={(value) => updateState((current) => ({ ...current, adventurePoints: value }))} />
              </Field>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Equipment stash">
                <Textarea value={state.equipmentStash} onChange={(value) => updateState((current) => ({ ...current, equipmentStash: value }))} rows={6} />
              </Field>
              <Field label="Backpack">
                <Textarea value={state.backpack} onChange={(value) => updateState((current) => ({ ...current, backpack: value }))} rows={6} />
              </Field>
            </div>

            <div className="mt-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Adventurer cards</p>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">Add up to eight companions and attach a portrait to each card.</p>
              </div>
              <button
                type="button"
                disabled={state.characters.length >= MAX_CHARACTERS}
                onClick={() =>
                  updateState((current) => ({
                    ...current,
                    characters: [...current.characters, createCharacterSheet()],
                  }))
                }
                className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add adventurer
              </button>
            </div>

            <div className="mt-4 grid gap-4">
              {state.characters.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-[var(--border-strong)] bg-white/40 p-6 text-sm text-[var(--ink-soft)]">
                  No adventurer cards yet. Add one to start building the warband.
                </div>
              ) : null}
              {state.characters.map((character, index) => (
                <article key={character.id} className="rounded-[22px] border border-[var(--border-soft)] bg-white/60 p-4 shadow-[0_12px_32px_rgba(42,27,14,0.06)]">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Adventurer {index + 1}</p>
                      <p className="mt-1 font-display text-2xl text-[var(--ink)]">{character.name || "Unnamed companion"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-right text-xs text-[var(--ink-muted)] sm:grid-cols-5">
                      <MiniField label="XP" value={character.xp} onChange={(value) => updateCharacter(index, (current) => ({ ...current, xp: value }))} />
                      <MiniField label="Level" value={character.level} onChange={(value) => updateCharacter(index, (current) => ({ ...current, level: value }))} />
                      <button
                        type="button"
                        onClick={() =>
                          updateState((current) => ({
                            ...current,
                            characters: current.characters.filter((candidate) => candidate.id !== character.id),
                          }))
                        }
                        className="rounded-xl border border-[var(--border-soft)] bg-white/80 px-3 py-2 text-sm text-[var(--ink)] transition hover:bg-white"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="mb-4 grid gap-4 md:grid-cols-[180px_1fr]">
                    <div className="space-y-3">
                      <div className="overflow-hidden rounded-[20px] border border-[var(--border-soft)] bg-[var(--panel)]">
                        {getEntityAssetDataUrl(character.id) ? (
                          <img src={getEntityAssetDataUrl(character.id)} alt={character.name || "Companion portrait"} className="aspect-[4/5] w-full object-cover" />
                        ) : (
                          <div className="grid aspect-[4/5] place-items-center text-sm text-[var(--ink-muted)]">No portrait yet</div>
                        )}
                      </div>
                      <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]">
                        <ImagePlus className="h-4 w-4" />
                        Upload image
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            void uploadCharacterPortrait(character.id, file);
                          }}
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="Name"><Input value={character.name} onChange={(value) => updateCharacter(index, (current) => ({ ...current, name: value }))} /></Field>
                      <Field label="Origin"><Input value={character.origin} onChange={(value) => updateCharacter(index, (current) => ({ ...current, origin: value }))} /></Field>
                      <Field label="Agility"><Input value={character.agility} onChange={(value) => updateCharacter(index, (current) => ({ ...current, agility: value }))} /></Field>
                      <Field label="Speed"><Input value={character.speed} onChange={(value) => updateCharacter(index, (current) => ({ ...current, speed: value }))} /></Field>
                      <Field label="Combat"><Input value={character.combat} onChange={(value) => updateCharacter(index, (current) => ({ ...current, combat: value }))} /></Field>
                      <Field label="Tough."><Input value={character.toughness} onChange={(value) => updateCharacter(index, (current) => ({ ...current, toughness: value }))} /></Field>
                      <Field label="Luck"><Input value={character.luck} onChange={(value) => updateCharacter(index, (current) => ({ ...current, luck: value }))} /></Field>
                      <Field label="Will"><Input value={character.will} onChange={(value) => updateCharacter(index, (current) => ({ ...current, will: value }))} /></Field>
                      <Field label="Casting"><Input value={character.casting} onChange={(value) => updateCharacter(index, (current) => ({ ...current, casting: value }))} /></Field>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <Field label="Proficiencies & spells"><Textarea value={character.proficienciesAndSpells} onChange={(value) => updateCharacter(index, (current) => ({ ...current, proficienciesAndSpells: value }))} rows={5} /></Field>
                    <Field label="Skills"><Textarea value={character.skills} onChange={(value) => updateCharacter(index, (current) => ({ ...current, skills: value }))} rows={5} /></Field>
                    <Field label="Equipment"><Textarea value={character.equipment} onChange={(value) => updateCharacter(index, (current) => ({ ...current, equipment: value }))} rows={5} /></Field>
                  </div>
                </article>
              ))}
            </div>
          </SectionCard>
        ) : null}

        {activeTab === "campaign" ? (
          <SectionCard title="Campaign tracking" icon={<PenSquare className="h-5 w-5" />} description="Everything from the campaign sheet, plus quick restoration to previous saved states.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Friends known"><Textarea value={state.friendsKnown} onChange={(value) => updateState((current) => ({ ...current, friendsKnown: value }))} rows={6} /></Field>
              <Field label="Hidden locations log"><Textarea value={state.hiddenLocations} onChange={(value) => updateState((current) => ({ ...current, hiddenLocations: value }))} rows={6} /></Field>
              <Field label="Quest and contract notes"><Textarea value={state.questAndContractNotes} onChange={(value) => updateState((current) => ({ ...current, questAndContractNotes: value }))} rows={7} /></Field>
              <Field label="Delve notes"><Textarea value={state.delveNotes} onChange={(value) => updateState((current) => ({ ...current, delveNotes: value }))} rows={7} /></Field>
              <Field label="Player notes"><Textarea value={state.playerNotes} onChange={(value) => updateState((current) => ({ ...current, playerNotes: value }))} rows={7} /></Field>
            </div>

            <div className="mt-5 rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Threat levels</p>
              <div className="mt-4 grid gap-3">
                {state.threatTracks.map((track, index) => (
                  <div key={track.id} className="grid gap-3 rounded-2xl border border-[var(--border-soft)] bg-white/60 px-4 py-3 md:grid-cols-[1fr_120px]">
                    <input
                      value={track.label}
                      onChange={(event) =>
                        updateState((current) => ({
                          ...current,
                          threatTracks: current.threatTracks.map((currentTrack, currentIndex) =>
                            currentIndex === index ? { ...currentTrack, label: event.target.value } : currentTrack,
                          ),
                        }))
                      }
                      className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
                      placeholder={`Threat ${index + 1}`}
                    />
                    <input
                      value={track.value}
                      onChange={(event) =>
                        updateState((current) => ({
                          ...current,
                          threatTracks: current.threatTracks.map((currentTrack, currentIndex) =>
                            currentIndex === index ? { ...currentTrack, value: event.target.value } : currentTrack,
                          ),
                        }))
                      }
                      className="field"
                      inputMode="numeric"
                      placeholder="Threat #"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Version history</p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">Restore any recent save if a battle goes sideways.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void saveState("Campaign notes update")}
                  disabled={busy !== null}
                  className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save notes
                </button>
              </div>

              <div className="mt-4 grid gap-3">
                {versions.map((version) => (
                  <div key={version.version} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-soft)] bg-white/60 px-4 py-3">
                    <div>
                      <p className="font-medium text-[var(--ink)]">Version {version.version}</p>
                      <p className="text-sm text-[var(--ink-soft)]">{version.reason} · {formatTimestamp(version.createdAt)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void runTask("restore", async () => {
                          const result = await restoreCampaignVersion({ data: { campaignCode, version: version.version } });
                          applyServerResult(result);
                          setPendingMessage(`Restored version ${version.version}.`);
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Download className="h-4 w-4" />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        ) : null}

        {activeTab === "map" ? (
        <SectionCard title="Region map" icon={<MapPinned className="h-5 w-5" />} description="Upload your map, then place and annotate every notable site, hidden discovery, and travel route.">
          <div className="grid items-start gap-4 lg:grid-cols-[0.72fr_0.28fr]">
            <div className="space-y-4">
              <div className="sticky top-4 z-30 rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel)]/95 p-3 shadow-[0_10px_30px_rgba(42,27,14,0.08)] backdrop-blur-sm">
                <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)]">
                  <Upload className="h-4 w-4" />
                  Upload region map
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) {
                        return;
                      }

                      void uploadMapFile(file);
                    }}
                  />
                </label>
                {assets.regionMapDataUrl ? (
                  <button
                    type="button"
                    onClick={clearRegionMap}
                    className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                  >
                    Remove map
                  </button>
                ) : null}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMapZoomCentered(mapZoom - 0.15)}
                    className="rounded-full border border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                  >
                    -
                  </button>
                  <span className="min-w-16 text-center text-sm text-[var(--ink-soft)]">{Math.round(mapZoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setMapZoomCentered(mapZoom + 0.15)}
                    className="rounded-full border border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMapZoomCentered(1);
                      setMapPan({ x: 0, y: 0 });
                    }}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                  >
                    <Search className="h-4 w-4" />
                    Reset view
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSubregions((current) => !current)}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                      showSubregions
                        ? "border-[var(--accent)] bg-white text-[var(--accent)]"
                        : "border-[var(--border-strong)] text-[var(--ink)] hover:bg-[var(--panel)]"
                    }`}
                  >
                    {showSubregions ? "Hide regions" : "Show regions"}
                  </button>
                </div>
                </div>
              </div>

              <div
                ref={mapContainerRef}
                className={`relative overflow-hidden rounded-[28px] border bg-[var(--map-surface)] transition ${
                  isMapDropActive
                    ? "border-[var(--accent)] shadow-[0_0_0_4px_rgba(158,86,48,0.15)]"
                    : "border-[var(--border-strong)]"
                }`}
                onDragEnterCapture={(event) => {
                  if (!assets.regionMapDataUrl && getDraggedImageFile(event.dataTransfer)) {
                    event.preventDefault();
                    event.stopPropagation();
                    setIsMapDropActive(true);
                  }
                }}
                onDragOverCapture={(event) => {
                  if (!assets.regionMapDataUrl && getDraggedImageFile(event.dataTransfer)) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "copy";
                    setIsMapDropActive(true);
                  }
                }}
                onDropCapture={(event) => {
                  if (!assets.regionMapDataUrl && getDraggedImageFile(event.dataTransfer)) {
                    event.preventDefault();
                    event.stopPropagation();
                    setIsMapDropActive(false);
                    void handleDroppedMapFile(event.dataTransfer);
                  }
                }}
                onDragEnter={(event) => {
                  if (!assets.regionMapDataUrl && getDraggedImageFile(event.dataTransfer)) {
                    event.preventDefault();
                    setIsMapDropActive(true);
                  }
                }}
                onDragOver={(event) => {
                  const imageFile = getDraggedImageFile(event.dataTransfer);

                  if (!assets.regionMapDataUrl && imageFile) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    if (!isMapDropActive) {
                      setIsMapDropActive(true);
                    }
                    return;
                  }

                  if (draggingHiddenSiteId || draggingLibraryItem) {
                    event.preventDefault();
                  }
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target) {
                    setIsMapDropActive(false);
                  }
                }}
                onDrop={(event) => {
                  setIsMapDropActive(false);
                  if (!assets.regionMapDataUrl && getDraggedImageFile(event.dataTransfer)) {
                    event.preventDefault();
                    return;
                  }

                  const point = getRelativePoint(mapViewportRef.current, event.clientX, event.clientY);
                  if (!point) {
                    return;
                  }

                  if (draggingLibraryItem) {
                    event.preventDefault();
                    if (draggingLibraryItem === "party-position") {
                      updateState((current) => ({
                        ...current,
                        map: {
                          ...current.map,
                          partyPosition: {
                            x: point.x,
                            y: point.y,
                            notes: current.map.partyPosition?.notes ?? "",
                          },
                        },
                      }));
                      setDraggingLibraryItem(null);
                      setSelectedMarkerId(null);
                      setSelectedSubregionId(null);
                      setSelectedHiddenSiteId(null);
                      setIsPartyPositionSelected(true);
                      setPendingMessage("Party position placed. Drag it as the warband travels.");
                      return;
                    }

                    const marker = createMarkerFromLibraryKey(draggingLibraryItem, point);
                    updateState((current) => ({
                      ...current,
                      map: {
                        ...current.map,
                        markers: [...current.map.markers, marker],
                      },
                    }));
                    setDraggingLibraryItem(null);
                    setSelectedMarkerId(marker.id);
                    setSelectedSubregionId(null);
                    setSelectedHiddenSiteId(null);
                    setIsPartyPositionSelected(false);
                    setPendingMessage(`${marker.title} placed. Add notes in the inspector.`);
                    return;
                  }

                  if (!draggingHiddenSiteId) {
                    return;
                  }

                  event.preventDefault();

                  const hiddenSite = state.map.hiddenSites.find((site) => site.id === draggingHiddenSiteId);
                  if (!hiddenSite) {
                    return;
                  }

                  updateState((current) => {
                    const hiddenSites = current.map.hiddenSites.filter(
                      (site) => site.id !== draggingHiddenSiteId,
                    );

                    return {
                      ...current,
                      map: {
                        ...current.map,
                        hiddenSites,
                        markers: [
                          ...current.map.markers,
                              {
                                id: crypto.randomUUID(),
                                title: hiddenSite.title || "Hidden location",
                                kind: hiddenSite.kind,
                                townVariant: hiddenSite.kind === "town" ? hiddenSite.townVariant || townVariants[0] : "",
                                image: hiddenSite.image,
                                x: point.x,
                                y: point.y,
                                notes: hiddenSite.notes,
                          },
                        ],
                      },
                    };
                  });

                  setSelectedHiddenSiteId(null);
                  setSelectedMarkerId(null);
                  setSelectedSubregionId(null);
                  setIsPartyPositionSelected(false);
                  setPlacementMode(null);
                  setPendingMessage("Hidden site revealed and placed on the map.");
                  setDraggingHiddenSiteId(null);
                }}
                onClick={(event) => {
                  const point = getRelativePoint(mapViewportRef.current, event.clientX, event.clientY);
                  if (!point) {
                    return;
                  }

                  if (draftSubregion) {
                    setDraftSubregion((current) =>
                      current
                        ? {
                            ...current,
                            points: [...current.points, point],
                          }
                        : current,
                    );
                    return;
                  }

                  if (!placementMode) {
                    clearMapSelection();
                    return;
                  }

                  if (placementMode === "party-position") {
                    updateState((current) => ({
                      ...current,
                      map: {
                        ...current.map,
                        partyPosition: {
                          x: point.x,
                          y: point.y,
                          notes: current.map.partyPosition?.notes ?? "",
                        },
                      },
                    }));
                    setIsPartyPositionSelected(true);
                    setSelectedHiddenSiteId(null);
                    setPendingMessage("Party position placed. Drag it as the warband travels.");
                    setPlacementMode(null);
                    return;
                  }
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || draftSubregion || placementMode) {
                    return;
                  }

                  const target = event.target as HTMLElement | null;
                  if (target?.closest("button") || target?.closest("circle") || target?.closest("polygon")) {
                    return;
                  }

                  event.preventDefault();
                  setIsPanningMap(true);
                  setLastPanClientPoint({ x: event.clientX, y: event.clientY });
                }}
                onWheel={(event) => {
                  if (!event.metaKey && !event.ctrlKey) {
                    return;
                  }

                  event.preventDefault();
                  const next = event.deltaY > 0 ? mapZoom * 0.92 : mapZoom * 1.08;
                  setMapZoomCentered(next);
                }}
              >
                {!assets.regionMapDataUrl && isMapDropActive ? (
                  <div className="absolute inset-0 z-20 grid place-items-center bg-[rgba(244,235,219,0.82)] text-center text-[var(--ink)] pointer-events-none">
                    <div className="rounded-[24px] border border-[var(--accent)] bg-white/80 px-6 py-5 shadow-[0_16px_40px_rgba(42,27,14,0.12)]">
                      <p className="font-display text-2xl">Drop region map</p>
                      <p className="mt-2 text-sm text-[var(--ink-soft)]">Release the image anywhere on the page to set the map.</p>
                    </div>
                  </div>
                ) : null}
                <div className="w-full" style={{ aspectRatio: String(mapAspectRatio) }}>
                  <div
                    ref={mapViewportRef}
                    className="absolute inset-0"
                    style={{ transform: `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})`, transformOrigin: "top left" }}
                  >
                  {assets.regionMapDataUrl ? (
                    <img src={assets.regionMapDataUrl} alt="Uploaded region map" draggable={false} className="pointer-events-none h-full w-full object-contain select-none" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(167,109,54,0.18),_transparent_45%),linear-gradient(180deg,rgba(248,239,219,0.92),rgba(232,216,189,0.92))] p-8 text-center text-[var(--ink-soft)] pointer-events-none">
                      <div className="max-w-md space-y-3">
                        <p>Upload a region map to start placing towns, delves, hidden sites, and subregions.</p>
                        <p className="text-xs uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                          {isMapDropActive ? "Drop image to set the region map" : "You can also drag an image file straight onto this panel."}
                        </p>
                      </div>
                    </div>
                  )}

                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 z-10 h-full w-full">
                    {showSubregions ? state.map.subregions.map((subregion) => (
                      <g key={subregion.id}>
                        <polygon
                          points={subregion.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                          fill={subregion.color}
                          fillOpacity={selectedSubregionId === subregion.id ? 0.36 : 0.24}
                          stroke={subregion.color}
                          strokeWidth={1.15}
                          vectorEffect="non-scaling-stroke"
                          style={{ pointerEvents: "auto", cursor: draggingSubregionId === subregion.id ? "grabbing" : "grab" }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            const point = getRelativePoint(mapViewportRef.current, event.clientX, event.clientY);
                            setSelectedMarkerId(null);
                            setSelectedSubregionId(subregion.id);
                            setSelectedHiddenSiteId(null);
                            setIsPartyPositionSelected(false);
                            setDraggingSubregionId(subregion.id);
                            setLastSubregionPointerPoint(point);
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            const point = getRelativePoint(mapViewportRef.current, event.clientX, event.clientY);
                            if (!point) {
                              return;
                            }
                            updateSubregion(subregion.id, setState, (currentSubregion) => ({
                              ...currentSubregion,
                              points: insertPointIntoSubregion(currentSubregion.points, point),
                            }));
                            setSelectedSubregionId(subregion.id);
                            setPendingMessage("Added a new point to the subregion.");
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedMarkerId(null);
                            setSelectedSubregionId(subregion.id);
                            setSelectedHiddenSiteId(null);
                            setIsPartyPositionSelected(false);
                          }}
                        />
                        <text
                          x={getSubregionCentroid(subregion.points).x * 100}
                          y={getSubregionCentroid(subregion.points).y * 100}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="pointer-events-none fill-black text-[1.35px] italic"
                          style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.9)", strokeWidth: 0.35, strokeLinejoin: "round" }}
                        >
                          {subregion.title || "Subregion"}
                        </text>
                        {selectedSubregionId === subregion.id
                          ? subregion.points.map((point, index) => (
                              <circle
                                key={`${subregion.id}-point-${index}`}
                                cx={point.x * 100}
                                cy={point.y * 100}
                                r={1.3}
                                fill="#fff7e7"
                                stroke={subregion.color}
                                strokeWidth={0.8}
                                vectorEffect="non-scaling-stroke"
                                style={{ pointerEvents: "auto", cursor: "move" }}
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  setDraggingSubregionPoint({ subregionId: subregion.id, pointIndex: index });
                                  setSelectedSubregionId(subregion.id);
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();

                                  if (subregion.points.length <= 3) {
                                    setPendingMessage("A subregion needs at least three points.");
                                    return;
                                  }

                                  updateSubregion(subregion.id, setState, (currentSubregion) => ({
                                    ...currentSubregion,
                                    points: currentSubregion.points.filter((_, pointIndex) => pointIndex !== index),
                                  }));
                                  setSelectedSubregionId(subregion.id);
                                  setPendingMessage("Removed subregion point.");
                                }}
                              />
                            ))
                          : null}
                      </g>
                    )) : null}

                    {draftSubregion && draftSubregion.points.length > 1 ? (
                      <>
                        <polyline
                          points={draftSubregion.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                          fill="none"
                          stroke={draftSubregion.color}
                          strokeWidth={1.2}
                          strokeDasharray="2.4 1.2"
                          vectorEffect="non-scaling-stroke"
                        />
                        {draftSubregion.points.map((point, index) => (
                          <circle
                            key={`${point.x}-${point.y}-${index}`}
                            cx={point.x * 100}
                            cy={point.y * 100}
                            r={1.2}
                            fill="#fff7e7"
                            stroke={draftSubregion.color}
                            strokeWidth={0.7}
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </>
                    ) : null}
                  </svg>

                  {state.map.markers.map((marker) => {
                    const preview = getEntityAssetDataUrl(marker.id, getMarkerPreview(marker, assets));
                    return (
                      <div
                        key={marker.id}
                        className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                        style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
                      >
                        <div className="relative flex items-center justify-center">
                          <button
                            type="button"
                            aria-label={marker.title}
                            draggable={false}
                            className={`rounded-full p-1 transition ${selectedMarkerId === marker.id ? "scale-110" : "hover:scale-105"}`}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const point = getRelativePoint(mapViewportRef.current, event.clientX, event.clientY);
                              if (point) {
                                setDragPointerOffset({ x: marker.x - point.x, y: marker.y - point.y });
                              }
                              setDraggingTarget(marker.id);
                              setSelectedMarkerId(marker.id);
                              setSelectedSubregionId(null);
                              setSelectedHiddenSiteId(null);
                              setIsPartyPositionSelected(false);
                            }}
                            onDragStart={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedMarkerId(marker.id);
                              setSelectedSubregionId(null);
                              setSelectedHiddenSiteId(null);
                              setIsPartyPositionSelected(false);
                            }}
                          >
                            {preview ? (
                              <img src={preview} alt="" draggable={false} className="pointer-events-none h-[clamp(22px,2.4vw,42px)] w-[clamp(22px,2.4vw,42px)] drop-shadow-[0_8px_12px_rgba(0,0,0,0.32)] select-none" />
                            ) : (
                              <div className="grid h-10 w-10 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--panel)] text-xs font-semibold text-[var(--ink)] shadow-[0_8px_16px_rgba(42,27,14,0.16)]">
                                {marker.kind === "town" ? "T" : marker.title[0]}
                              </div>
                            )}
                          </button>
                          {selectedMarkerId === marker.id ? (
                            <button
                              type="button"
                              aria-label={`Remove ${marker.title}`}
                              className="absolute -right-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-full border border-[var(--border-strong)] bg-white text-xs text-[var(--ink)] shadow"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteMarker(marker.id);
                              }}
                            >
                              x
                            </button>
                          ) : null}
                        </div>
                        <div
                          className="pointer-events-none mt-1 whitespace-nowrap text-center text-[clamp(10px,1.15vw,15px)] font-semibold text-black"
                          style={{ textShadow: "-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 4px rgba(255,255,255,0.88)" }}
                        >
                          {marker.title}
                        </div>
                      </div>
                    );
                  })}

                  {state.map.partyPosition ? (
                    <button
                      type="button"
                      aria-label="Current party position"
                      draggable={false}
                      className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full p-1 transition ${
                        isPartyPositionSelected ? "scale-110" : "hover:scale-105"
                      }`}
                      style={{ left: `${state.map.partyPosition.x * 100}%`, top: `${state.map.partyPosition.y * 100}%` }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const point = getRelativePoint(mapViewportRef.current, event.clientX, event.clientY);
                        if (point && state.map.partyPosition) {
                          setDragPointerOffset({
                            x: state.map.partyPosition.x - point.x,
                            y: state.map.partyPosition.y - point.y,
                          });
                        }
                        setDraggingTarget("party");
                        setSelectedMarkerId(null);
                        setSelectedSubregionId(null);
                        setSelectedHiddenSiteId(null);
                        setIsPartyPositionSelected(true);
                      }}
                      onDragStart={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedMarkerId(null);
                        setSelectedSubregionId(null);
                        setSelectedHiddenSiteId(null);
                        setIsPartyPositionSelected(true);
                      }}
                    >
                      <img src={getPartyPositionAssetPath()} alt="" draggable={false} className="pointer-events-none h-[clamp(22px,2.4vw,42px)] w-[clamp(22px,2.4vw,42px)] drop-shadow-[0_8px_12px_rgba(0,0,0,0.32)] select-none" />
                    </button>
                  ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1 xl:[scrollbar-width:none] xl:[-ms-overflow-style:none] xl:[&::-webkit-scrollbar]:hidden">
              {selectedMarker ? (
                <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Selected location</p>
                  <div className="mt-4 space-y-3">
                    <div className="space-y-3">
                      <div className="overflow-hidden rounded-[20px] border border-[var(--border-soft)] bg-[var(--panel)]">
                        {getEntityAssetDataUrl(selectedMarker.id) ? (
                          <img src={getEntityAssetDataUrl(selectedMarker.id)} alt={selectedMarker.title} className="aspect-[4/3] w-full object-cover" />
                        ) : (
                          <div className="grid aspect-[4/3] place-items-center text-sm text-[var(--ink-muted)]">No location image yet</div>
                        )}
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]">
                        <ImagePlus className="h-4 w-4" />
                        Upload location image
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            void uploadLocationImage(selectedMarker.id, file);
                          }}
                        />
                      </label>
                    </div>
                    <Field label="Title"><Input value={selectedMarker.title} onChange={(value) => {
                      updateMarker(selectedMarker.id, setState, (marker) => ({ ...marker, title: value }));
                    }} /></Field>
                    <Field label="Type">
                      <select
                        value={selectedMarker.kind}
                        onChange={(event) =>
                          updateMarker(selectedMarker.id, setState, (marker) => ({
                            ...marker,
                            kind: event.target.value as MapLocationKind,
                            townVariant: event.target.value === "town" ? marker.townVariant || townVariants[0] : "",
                          }))
                        }
                        className="field"
                      >
                        {mapLocationKinds.map((kind) => (
                          <option key={kind} value={kind}>{mapLocationLabels[kind]}</option>
                        ))}
                      </select>
                    </Field>
                    {selectedMarker.kind === "town" ? (
                      <Field label="Town style">
                        <select
                          value={selectedMarker.townVariant}
                          onChange={(event) =>
                            updateMarker(selectedMarker.id, setState, (marker) => ({
                              ...marker,
                              townVariant: event.target.value as TownVariant,
                            }))
                          }
                          className="field"
                        >
                          {townVariants.map((variant) => (
                            <option key={variant} value={variant}>{variant}</option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                    <Field label="Notes"><Textarea value={selectedMarker.notes} onChange={(value) => {
                      updateMarker(selectedMarker.id, setState, (marker) => ({ ...marker, notes: value }));
                    }} rows={8} /></Field>
                    <button
                      type="button"
                      onClick={() => {
                        const hiddenSite: HiddenSite = {
                          id: crypto.randomUUID(),
                          title: selectedMarker.title,
                          kind: selectedMarker.kind,
                          townVariant: selectedMarker.kind === "town" ? selectedMarker.townVariant || townVariants[0] : "",
                          image: selectedMarker.image,
                          notes: selectedMarker.notes,
                        };

                        updateState((current) => ({
                          ...current,
                          map: {
                            ...current.map,
                            markers: current.map.markers.filter((marker) => marker.id !== selectedMarker.id),
                            hiddenSites: [...current.map.hiddenSites, hiddenSite],
                          },
                        }));
                        setSelectedHiddenSiteId(hiddenSite.id);
                        setSelectedMarkerId(null);
                        setPendingMessage("Location hidden and moved back to the hidden sites list.");
                      }}
                      className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                    >
                      Make hidden
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMarker(selectedMarker.id)}
                      className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                    >
                      Remove location
                    </button>
                  </div>
                </div>
              ) : null}

              {selectedSubregion ? (
                <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Selected subregion</p>
                  <div className="mt-4 space-y-3">
                    <Field label="Title"><Input value={selectedSubregion.title} onChange={(value) => updateSubregion(selectedSubregion.id, setState, (subregion) => ({ ...subregion, title: value }))} /></Field>
                    <Field label="Notes"><Textarea value={selectedSubregion.notes} onChange={(value) => updateSubregion(selectedSubregion.id, setState, (subregion) => ({ ...subregion, notes: value }))} rows={6} /></Field>
                    <Field label="Color">
                      <input
                        type="color"
                        value={selectedSubregion.color}
                        onChange={(event) => updateSubregion(selectedSubregion.id, setState, (subregion) => ({ ...subregion, color: event.target.value }))}
                        className="h-12 w-full cursor-pointer rounded-2xl border border-[var(--border-soft)] bg-white/80 p-2"
                      />
                    </Field>
                    <button
                      type="button"
                      onClick={() => deleteSubregion(selectedSubregion.id)}
                      className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                    >
                      Remove subregion
                    </button>
                  </div>
                </div>
              ) : null}

              {selectedHiddenSite ? (
                <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Selected hidden site</p>
                  <div className="mt-4 space-y-3">
                    <Field label="Site name">
                      <Input
                        value={selectedHiddenSite.title}
                        onChange={(value) => {
                          updateHiddenSite(selectedHiddenSite.id, (site) => ({ ...site, title: value }));
                        }}
                      />
                    </Field>
                    <Field label="Actual place type">
                      <select
                        value={selectedHiddenSite.kind}
                        onChange={(event) => {
                          const nextKind = event.target.value as MapLocationKind;
                          updateHiddenSite(selectedHiddenSite.id, (site) => ({
                            ...site,
                            kind: nextKind,
                            townVariant: nextKind === "town" ? site.townVariant || townVariants[0] : "",
                          }));
                        }}
                        className="field"
                      >
                        {mapLocationKinds.map((kind) => (
                          <option key={kind} value={kind}>{mapLocationLabels[kind]}</option>
                        ))}
                      </select>
                    </Field>
                    {selectedHiddenSite.kind === "town" ? (
                      <Field label="Town style">
                        <select
                          value={selectedHiddenSite.townVariant}
                          onChange={(event) => {
                            const townVariant = event.target.value as TownVariant;
                            updateHiddenSite(selectedHiddenSite.id, (site) => ({ ...site, townVariant }));
                          }}
                          className="field"
                        >
                          {townVariants.map((variant) => (
                            <option key={variant} value={variant}>{variant}</option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                    <Field label="Notes">
                      <Textarea
                        value={selectedHiddenSite.notes}
                        onChange={(value) => {
                          updateHiddenSite(selectedHiddenSite.id, (site) => ({ ...site, notes: value }));
                        }}
                        rows={5}
                      />
                    </Field>
                    <button
                      type="button"
                      onClick={() => {
                        updateState((current) => ({
                          ...current,
                          map: {
                            ...current.map,
                            hiddenSites: current.map.hiddenSites.filter((site) => site.id !== selectedHiddenSite.id),
                          },
                        }));
                        setSelectedHiddenSiteId(null);
                        setSelectedMarkerId(null);
                      }}
                      className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                    >
                      Remove hidden site
                    </button>
                  </div>
                </div>
              ) : null}

              {isPartyPositionSelected ? (
                <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Current party</p>
                  {state.map.partyPosition ? (
                    <div className="mt-4 space-y-3">
                      <Field label="Current location label">
                        <Input value={state.currentLocation} onChange={(value) => updateState((current) => ({ ...current, currentLocation: value }))} />
                      </Field>
                      <Field label="Travel notes">
                        <Textarea
                          value={state.map.partyPosition.notes}
                          onChange={(value) =>
                            updateState((current) => ({
                              ...current,
                              map: {
                                ...current.map,
                                partyPosition: current.map.partyPosition
                                  ? { ...current.map.partyPosition, notes: value }
                                  : current.map.partyPosition,
                              },
                            }))
                          }
                          rows={5}
                        />
                      </Field>
                      <button
                        type="button"
                        onClick={() => {
                          updateState((current) => ({
                            ...current,
                            map: {
                              ...current.map,
                              partyPosition: null,
                            },
                          }));
                          setIsPartyPositionSelected(false);
                        }}
                        className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                      >
                        Remove party marker
                      </button>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-[var(--ink-soft)]">Place the horse icon on the map to track the warband's current position.</p>
                  )}
                </div>
              ) : null}

              <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Subregions</p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">Draw named areas on the map, then drag shapes or edit their points.</p>
                  </div>
                  {!draftSubregion ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftSubregion(createDraftSubregion());
                        clearMapSelection();
                        setPlacementMode(null);
                        setPendingMessage("Subregion mode on: click the map to add points, then finish it here.");
                      }}
                      className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                    >
                      Draw subregion
                    </button>
                  ) : null}
                </div>

                {draftSubregion ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl border border-[var(--accent)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-soft)]">
                      Click the map to add boundary points. Double-click an existing subregion edge later to insert more points. Current points: {draftSubregion.points.length}.
                    </div>
                    <Field label="Title"><Input value={draftSubregion.title} onChange={(value) => setDraftSubregion((current) => (current ? { ...current, title: value } : current))} /></Field>
                    <Field label="Notes"><Textarea value={draftSubregion.notes} onChange={(value) => setDraftSubregion((current) => (current ? { ...current, notes: value } : current))} rows={4} /></Field>
                    <Field label="Color">
                      <input
                        type="color"
                        value={draftSubregion.color}
                        onChange={(event) => setDraftSubregion((current) => (current ? { ...current, color: event.target.value } : current))}
                        className="h-12 w-full cursor-pointer rounded-2xl border border-[var(--border-soft)] bg-white/80 p-2"
                      />
                    </Field>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (draftSubregion.points.length < 3) {
                            setPendingMessage("A subregion needs at least three points.");
                            return;
                          }

                          const nextSubregion: Subregion = {
                            id: crypto.randomUUID(),
                            title: draftSubregion.title || "Unnamed subregion",
                            notes: draftSubregion.notes,
                            color: draftSubregion.color,
                            points: draftSubregion.points,
                          };

                          updateState((current) => ({
                            ...current,
                            map: {
                              ...current.map,
                              subregions: [...current.map.subregions, nextSubregion],
                            },
                          }));
                          setSelectedSubregionId(nextSubregion.id);
                          setDraftSubregion(null);
                          setPendingMessage("Subregion added.");
                        }}
                        className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                      >
                        Finish subregion
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDraftSubregion(null);
                          setPendingMessage("Cancelled subregion drawing.");
                        }}
                        className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {!hasMapSelection ? (
              <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Marker library</p>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">Drag any marker from here onto the map. Use the horse button below for current party position.</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {[...townVariants, ...mapLocationKinds.filter((kind) => kind !== "town")].map((key) => {
                    const preview = assets.markerLibraryDataUrls[key] ?? getStaticMarkerAssetPath(key);
                    const label = townVariants.includes(key as TownVariant)
                      ? key
                      : mapLocationLabels[key as MapLocationKind];
                    return (
                      <button
                        key={key}
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          setDraggingLibraryItem(key);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        onDragEnd={() => setDraggingLibraryItem(null)}
                        className="rounded-2xl border border-[var(--border-soft)] bg-white/60 p-2 text-center text-xs text-[var(--ink-soft)] transition hover:bg-white/80"
                      >
                        <div className="mb-1.5 grid h-14 place-items-center rounded-xl bg-[var(--panel)]">
                          {preview ? <img src={preview} alt="" className="h-12 w-12" /> : <span>Pending</span>}
                        </div>
                        {label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    setDraggingLibraryItem("party-position");
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onDragEnd={() => setDraggingLibraryItem(null)}
                  onClick={() => {
                    setPlacementMode("party-position");
                    setDraftSubregion(null);
                    setSelectedMarkerId(null);
                    setSelectedSubregionId(null);
                    setSelectedHiddenSiteId(null);
                    setIsPartyPositionSelected(true);
                    setPendingMessage("Click the map to place the party horse marker.");
                  }}
                  className={`mt-4 flex w-full items-center justify-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                    placementMode === "party-position"
                      ? "border-[var(--accent)] bg-white text-[var(--accent)]"
                      : "border-[var(--border-soft)] bg-white/60 text-[var(--ink)] hover:bg-white/80"
                  }`}
                >
                  <img src={getPartyPositionAssetPath()} alt="" className="h-10 w-10" />
                  Current party
                </button>
              </div>
              ) : null}

              <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Hidden locations</p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">Keep discovered places here, then drag them onto the map when their position becomes known.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const hiddenSite = createHiddenSite();
                      updateState((current) => ({
                        ...current,
                        map: {
                          ...current.map,
                          hiddenSites: [...current.map.hiddenSites, hiddenSite],
                        },
                      }));
                      setSelectedHiddenSiteId(hiddenSite.id);
                      setSelectedMarkerId(null);
                      setSelectedSubregionId(null);
                      setIsPartyPositionSelected(false);
                    }}
                    className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                  >
                    Add hidden site
                  </button>
                </div>

                <div className="mt-4 grid gap-3">
                  {state.map.hiddenSites.length === 0 ? (
                    <p className="text-sm leading-6 text-[var(--ink-soft)]">No hidden places yet. Add one here, then drag it onto the map later.</p>
                  ) : (
                    state.map.hiddenSites.map((site) => {
                          return (
                            <button
                              key={site.id}
                          type="button"
                          draggable
                          onDragStart={() => setDraggingHiddenSiteId(site.id)}
                          onDragEnd={() => setDraggingHiddenSiteId(null)}
                          onClick={() => {
                            setSelectedHiddenSiteId(site.id);
                            setSelectedMarkerId(null);
                            setSelectedSubregionId(null);
                            setIsPartyPositionSelected(false);
                          }}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            selectedHiddenSiteId === site.id
                              ? "border-[var(--accent)] bg-white/85"
                              : "border-[var(--border-soft)] bg-white/60 hover:bg-white/80"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium text-[var(--ink)]">{site.title || "Unnamed hidden site"}</p>
                              <p className="mt-1 text-sm text-[var(--ink-soft)]">Off-map - drag onto the map when located</p>
                            </div>
                            <img
                              src={getEntityAssetDataUrl(site.id, getMarkerPreview({ kind: site.kind, townVariant: site.kind === "town" ? site.townVariant : "" }, assets))}
                              alt=""
                              className="h-10 w-10"
                            />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">Recently deleted</p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">Restore a recently removed map location or subregion if you deleted it by mistake.</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  {state.map.recentlyDeletedMarkers.length === 0 && state.map.recentlyDeletedSubregions.length === 0 ? (
                    <p className="text-sm leading-6 text-[var(--ink-soft)]">No recently deleted locations or subregions.</p>
                  ) : (
                    [
                      ...state.map.recentlyDeletedMarkers.map((entry) => ({ type: "marker" as const, ...entry })),
                      ...state.map.recentlyDeletedSubregions.map((entry) => ({ type: "subregion" as const, ...entry })),
                    ]
                      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt))
                      .map((entry) => (
                      <div key={`${entry.type}-${entry.deletedAt}-${entry.type === "marker" ? entry.marker.id : entry.subregion.id}`} className="rounded-2xl border border-[var(--border-soft)] bg-white/60 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-[var(--ink)]">{entry.type === "marker" ? entry.marker.title : entry.subregion.title || "Unnamed subregion"}</p>
                            <p className="mt-1 text-sm text-[var(--ink-soft)]">Deleted {formatTimestamp(entry.deletedAt)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (entry.type === "marker") {
                                updateState((current) => ({
                                  ...current,
                                  map: {
                                    ...current.map,
                                    markers: [...current.map.markers, entry.marker],
                                    recentlyDeletedMarkers: current.map.recentlyDeletedMarkers.filter(
                                      (candidate) =>
                                        !(candidate.deletedAt === entry.deletedAt && candidate.marker.id === entry.marker.id),
                                    ),
                                  },
                                }));
                                setSelectedMarkerId(entry.marker.id);
                                setPendingMessage(`Restored ${entry.marker.title}.`);
                                return;
                              }

                              updateState((current) => ({
                                ...current,
                                map: {
                                  ...current.map,
                                  subregions: [...current.map.subregions, entry.subregion],
                                  recentlyDeletedSubregions: current.map.recentlyDeletedSubregions.filter(
                                    (candidate) =>
                                      !(candidate.deletedAt === entry.deletedAt && candidate.subregion.id === entry.subregion.id),
                                  ),
                                },
                              }));
                              setSelectedSubregionId(entry.subregion.id);
                              setPendingMessage(`Restored ${entry.subregion.title || "subregion"}.`);
                            }}
                            className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]"
                          >
                            Restore
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
        ) : null}
      </div>
    </main>
  );
}

function updateMarker(
  markerId: string,
  setState: Dispatch<SetStateAction<CampaignState>>,
  updater: (marker: MapMarker) => MapMarker,
) {
  setState((current) => ({
    ...current,
    map: {
      ...current.map,
      markers: current.map.markers.map((marker) => (marker.id === markerId ? updater(marker) : marker)),
    },
  }));
}

function updateSubregion(
  subregionId: string,
  setState: Dispatch<SetStateAction<CampaignState>>,
  updater: (subregion: Subregion) => Subregion,
) {
  setState((current) => ({
    ...current,
    map: {
      ...current.map,
      subregions: current.map.subregions.map((subregion) =>
        subregion.id === subregionId ? updater(subregion) : subregion,
      ),
    },
  }));
}

function getSubregionCentroid(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return { x: 0.5, y: 0.5 };
  }

  const total = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function insertPointIntoSubregion(
  points: Array<{ x: number; y: number }>,
  point: { x: number; y: number },
) {
  if (points.length < 2) {
    return [...points, point];
  }

  let bestSegmentIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const distance = distanceToSegment(point, start, end);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestSegmentIndex = index;
    }
  }

  return [
    ...points.slice(0, bestSegmentIndex + 1),
    point,
    ...points.slice(bestSegmentIndex + 1),
  ];
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  const projectionX = start.x + t * dx;
  const projectionY = start.y + t * dy;
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

function SectionCard(props: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-[var(--border-strong)] bg-[var(--panel)] p-5 shadow-[0_16px_40px_rgba(42,27,14,0.09)] md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--panel-strong)] text-[var(--ink)]">{props.icon}</div>
        <div>
          <h2 className="font-display text-3xl text-[var(--ink)]">{props.title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">{props.description}</p>
        </div>
      </div>
      <div className="mt-5">{props.children}</div>
    </section>
  );
}

function StatusPill(props: { icon: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-2 rounded-full bg-[var(--panel-strong)] px-4 py-2">{props.icon}{props.children}</span>;
}

function StatTile(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-white/60 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.28em] text-[var(--ink-muted)]">{props.label}</p>
      <p className="mt-2 font-display text-3xl text-[var(--ink)]">{props.value}</p>
    </div>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-xs uppercase tracking-[0.24em] text-[var(--ink-muted)]">{props.label}</span>
      {props.children}
    </label>
  );
}

function Input(props: { value: string; onChange: (value: string) => void }) {
  return <input value={props.value} onChange={(event) => props.onChange(event.target.value)} className="field" />;
}

function Textarea(props: { value: string; onChange: (value: string) => void; rows: number }) {
  return <textarea value={props.value} rows={props.rows} onChange={(event) => props.onChange(event.target.value)} className="field resize-y" />;
}

function MiniField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span>{props.label}</span>
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} className="min-w-0 rounded-xl border border-[var(--border-soft)] bg-white/80 px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]" />
    </label>
  );
}
