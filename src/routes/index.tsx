import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Compass, KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const COOKIE_KEY = "five_leagues_campaign";
const RECENT_CAMPAIGNS_KEY = "five-leagues-recent-campaigns";

export const Route = createFileRoute("/")({
  component: CampaignLauncher,
  head: () => ({
    meta: [
      { title: "Five Leagues CharSheet" },
      {
        name: "description",
        content: "Create or reopen a Five Leagues from the Borderlands campaign by code.",
      },
    ],
  }),
});

function CampaignLauncher() {
  const navigate = useNavigate();
  const [campaignCode, setCampaignCode] = useState("");
  const storedCode = readCampaignCookie();
  const [recentCampaigns, setRecentCampaigns] = useState<string[]>([]);

  useEffect(() => {
    setRecentCampaigns(readRecentCampaigns());
  }, []);

  const suggestedCode = useMemo(() => createCampaignCode(), []);

  function openCampaign(code: string) {
    const normalized = normalizeCampaignCode(code);
    if (!normalized) {
      return;
    }

    void navigate({
      to: "/$campaignCode" as never,
      params: { campaignCode: normalized } as never,
    });
  }

  function forgetCampaign(code: string) {
    if (typeof window === "undefined") {
      return;
    }

    const confirmed = window.confirm(`Forget /${code} from recent warbands on this browser?`);
    if (!confirmed) {
      return;
    }

    const next = recentCampaigns.filter((entry) => entry !== code);
    setRecentCampaigns(next);
    window.localStorage.setItem(RECENT_CAMPAIGNS_KEY, JSON.stringify(next));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-4 py-10 md:px-6">
      <section className="grid w-full gap-6 rounded-[32px] border border-[var(--border-strong)] bg-[var(--panel)] p-6 shadow-[0_30px_90px_rgba(42,27,14,0.16)] md:grid-cols-[1.1fr_0.9fr] md:p-10">
        <div className="space-y-5">
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--ink-muted)]">Familiar Games</p>
          <h1 className="font-display text-4xl text-[var(--ink)] md:text-6xl">Step back into your borderlands campaign.</h1>
          <p className="max-w-2xl text-base leading-8 text-[var(--ink-soft)]">
            Each campaign lives at its own code-based URL like `five-leagues.familiar.games/my-campaign-code` and the latest one you open is remembered in local storage on this browser.
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-[var(--ink-soft)]">
            <span className="rounded-full bg-[var(--panel-strong)] px-4 py-2">8-character roster</span>
            <span className="rounded-full bg-[var(--panel-strong)] px-4 py-2">Campaign notes + history</span>
            <span className="rounded-full bg-[var(--panel-strong)] px-4 py-2">Map markers + subregions</span>
          </div>
        </div>

        <div className="space-y-4 rounded-[26px] border border-[var(--border-soft)] bg-[var(--panel-strong)] p-5">
          {storedCode ? (
            <button
              type="button"
              onClick={() => openCampaign(storedCode)}
              className="flex w-full items-center justify-between rounded-[22px] border border-[var(--border-soft)] bg-white/65 px-4 py-4 text-left transition hover:bg-white/85"
            >
              <span>
                <span className="block text-xs uppercase tracking-[0.24em] text-[var(--ink-muted)]">Resume last campaign</span>
                <span className="mt-2 block font-display text-2xl text-[var(--ink)]">/{storedCode}</span>
              </span>
              <Compass className="h-5 w-5 text-[var(--accent)]" />
            </button>
          ) : null}

          {recentCampaigns.length > 0 ? (
            <div className="rounded-[22px] border border-[var(--border-soft)] bg-white/65 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--ink-muted)]">Recent warbands</p>
              <div className="mt-3 grid gap-2">
                {recentCampaigns.map((recentCode) => (
                  <div
                    key={recentCode}
                    className="flex items-center gap-2 rounded-2xl border border-[var(--border-soft)] bg-white/70 px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => openCampaign(recentCode)}
                      className="flex-1 px-1 py-1 text-left text-sm text-[var(--ink)] transition hover:text-[var(--accent)]"
                    >
                      /{recentCode}
                    </button>
                    <button
                      type="button"
                      onClick={() => forgetCampaign(recentCode)}
                      className="grid h-9 w-9 place-items-center rounded-full border border-[var(--border-soft)] text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      aria-label={`Forget ${recentCode}`}
                      title={`Forget ${recentCode}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => openCampaign(suggestedCode)}
            className="flex w-full items-center justify-between rounded-[22px] bg-[var(--accent)] px-4 py-4 text-left text-white transition hover:bg-[var(--accent-strong)]"
          >
            <span>
              <span className="block text-xs uppercase tracking-[0.24em] text-white/80">Create a new campaign</span>
              <span className="mt-2 block font-display text-2xl">/{suggestedCode}</span>
            </span>
            <Plus className="h-5 w-5" />
          </button>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              openCampaign(campaignCode);
            }}
            className="space-y-3 rounded-[22px] border border-[var(--border-soft)] bg-white/65 p-4"
          >
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.24em] text-[var(--ink-muted)]">Open by campaign code</span>
              <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-soft)] bg-white/85 px-3 py-2">
                <KeyRound className="h-4 w-4 text-[var(--ink-muted)]" />
                <input
                  value={campaignCode}
                  onChange={(event) => setCampaignCode(normalizeCampaignCode(event.target.value))}
                  placeholder="my-campaign-code"
                  className="w-full bg-transparent outline-none"
                />
              </div>
            </label>
            <button type="submit" className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--panel)]">
              Open campaign
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function createCampaignCode() {
  const adjective = pick(["ashen", "brass", "crooked", "dusken", "ember", "gilded", "hollow", "iron", "kindled", "moss"]);
  const noun = pick(["border", "camp", "crown", "delve", "ford", "march", "rubble", "spire", "trail", "watch"]);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${adjective}-${noun}-${suffix}`;
}

function pick<T>(values: readonly T[]) {
  return values[Math.floor(Math.random() * values.length)] as T;
}

function normalizeCampaignCode(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function readCampaignCookie() {
  if (typeof document === "undefined") {
    return null;
  }

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${COOKIE_KEY}=`));

  if (!cookie) {
    return null;
  }

  return normalizeCampaignCode(decodeURIComponent(cookie.split("=")[1] ?? "")) || null;
}

function readRecentCampaigns() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RECENT_CAMPAIGNS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as string[];
    return parsed.map(normalizeCampaignCode).filter(Boolean) as string[];
  } catch {
    return [];
  }
}
