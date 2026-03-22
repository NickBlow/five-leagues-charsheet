# Five Leagues CharSheet

Single-user Five Leagues from the Borderlands campaign tracker built with TanStack Start, Cloudflare Workers, Durable Objects, R2, and Alchemy.

## Features

- Warband roster for up to 8 characters
- Tabbed workflow for roster, campaign tracking, and map management
- Add/remove adventurer cards instead of starting with 8 prefilled slots
- Campaign tracking sheet fields and notes
- Numeric threat tracks with custom names
- Region map upload with draggable locations and drawable subregions
- Image uploads for companion cards and placed map locations
- Cookie-backed campaign URLs like `/my-campaign-code` with redirect back to the last opened campaign
- Per-location notes on the map
- Horse icon for the party's current position on the map
- Locally generated transparent marker art library stored as static assets
- Durable Object snapshot history with restore support

## Local development

```bash
pnpm install
pnpm cf-typegen
pnpm dev
```

Local marker generation:

```bash
pnpm generate:markers
```

## Validation

```bash
pnpm test
pnpm build
pnpm typecheck
```

## Deployment

```bash
pnpm deploy
```

## Important files

- `src/server.ts` - custom Cloudflare Worker entrypoint
- `scripts/generate-marker-library.mjs` - local OpenAI marker generation script for static assets
- `src/server/campaign-store.ts` - Durable Object state store
- `src/server/campaign-api.ts` - server functions for loading, saving, uploads, and marker generation
- `src/components/CampaignWorkspace.tsx` - main UI
- `alchemy.run.ts` - infrastructure definition
- `wrangler.jsonc` - local Cloudflare bindings and migrations
