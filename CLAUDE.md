# Alavu

Alavu is an expense tracker with budgets. There is an offline-first iPhone app and a web app, both syncing through one Convex backend.

## Layout

- `convex/`: the backend (Convex functions, schema, crons, R2 receipts) and its vitest tests (`*.test.ts`, run with `convex-test` in the edge runtime). `convex/_generated/` is committed.
- `apps/web/`: one Cloudflare Worker serving alavu.praveenjuge.com.
  - `public/` holds the static marketing pages.
  - `app/` + `src/app/` is the React SPA at `/app/`.
  - `src/worker/` holds the sign-in routes and the SPA fallback.
  - It is built with Vite and the `cf` CLI, and imports Convex types through the `@convex/*` alias.
- `apps/ios/`: the SwiftUI app, widgets and intents, plus the `AlavuKit` package. The Xcode project is generated with XcodeGen from `project.yml`. TestFlight uploads go through fastlane.
- `.github/workflows/`: `ci.yml` (backend, web, iOS) and `release.yml` (deploys on `v*` tags).

Bun 1.4.4 is the package manager. There are two installs: the repo root (Convex) and `apps/web`.

## Commands

Run these from the repo root:

| Command | What it does |
| - | - |
| `bun run check` | Everything CI runs except iOS: biome, Convex typecheck and tests, then web typecheck, tests and build |
| `bun run lint` / `bun run format` | Biome check / fix (2 spaces, 100 columns) |
| `bun run typecheck` | `tsc -p convex` |
| `bun run test` | Convex tests |
| `bun run e2e` | Browser smoke test of the site and app (starts the dev server if needed) |
| `bun run --cwd apps/web dev` | Web dev server on http://localhost:8787 (Convex dev deployment, WorkOS Staging) |

Run `bun run check` before you commit. After a change to the web app or the Worker, also run `bun run e2e`.

## Conventions

- Synced records use a client-generated `uid`, `editedAt` (last write wins), `deletedAt` tombstones and a per-space `seq`. See the comment at the top of `convex/schema.ts`. Keep the iOS app (`apps/ios/Alavu/Sync`, `AlavuKit`) and the web app in step when you change the wire format.
- Web money, period and summary logic in `apps/web/src/app/lib/` mirrors `AlavuKit` on iOS. Change both together.
- Public client config lives in `apps/web/.env.development` and `.env.production`. Secrets never go in the repo.

## Claude Code cloud sessions

`.claude/settings.json` runs `scripts/cloud-session-start.sh` at session start. In the cloud, that script installs both dependency trees, skipping the install when nothing has changed. Locally it does nothing.

What works in the cloud:

- `bun run check`, the dev server, and `bun run e2e`. The e2e test uses the pre-installed Playwright and Chromium.
- To show a UI change, take screenshots. The user can't open the VM's localhost. `bun run e2e` writes screenshots to `apps/web/e2e/output/`; send them, or write a small Playwright script for the screen in question.
- `bunx convex codegen`. The environment sets `CONVEX_DEPLOY_KEY` to a deploy key for the Convex dev deployment. When you add or rename a Convex module, run codegen and commit the updated `convex/_generated/` files. Codegen uploads the functions so it can analyze them, but it doesn't deploy them.
- Signed-in e2e checks need a WorkOS Staging test user. Set `WORKOS_API_KEY`, `ALAVU_E2E_EMAIL` and `ALAVU_E2E_PASSWORD` as environment variables. Without them, only the signed-out checks run. The Worker's dev-only `POST /app/auth/test-session` route turns the minted refresh token into a session cookie.

What doesn't work, or shouldn't be run, in the cloud:

- iOS. The VM is Linux, and `AlavuKit` imports SwiftData and SwiftUI, so nothing Swift builds there. For Swift changes, keep edits small and consistent with the surrounding code. Rely on the `ios` CI job (macOS) on the pull request, and say that the change wasn't built locally.
- `convex dev`. It would push your functions to the dev deployment, which the local web dev server also uses. Don't run it unless the user asks.
- Deploys happen only through `release.yml` on a `v*` tag. Don't deploy from a session.
