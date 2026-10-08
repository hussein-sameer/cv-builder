# CLAUDE.md — CV Builder

Guidance for Claude Code (and humans) working in this repository. Read this before changing code.
User-facing docs, deployment steps and env vars are in `README.md`; this file covers how the code is
built and the rules that keep it correct.

## What this is

A web app for writing **ATS-friendly CVs** and exporting them as **DOCX and PDF**, with an AI helper
that drafts the profile summary and rewrites bullet points. Multi-user: open sign-up, each user has a
private library of CVs (e.g. "Software Engineer", "DevOps"). The owner is Hussein (GitHub
`hussein-sameer`). Hosting target is **Northflank** (Docker service + Postgres addon), set up to
redeploy automatically on every push to `main`.

- Backend: **FastAPI** (Python 3.12 in Docker; 3.12–3.13 supported), python-docx, ReportLab, httpx,
  psycopg 3. No ORM.
- Frontend: **React 19 + TypeScript 7 + Vite 8**, pdf.js 6 (legacy build), lucide-react icons, plain
  CSS with design tokens. No UI framework, no state library.
- One container: FastAPI serves the built UI from `STATIC_DIR` and the API under `/api`.

## Commands

```bash
# backend (from backend/)
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload                       # http://localhost:8000  (add AUTH_ENABLED=false to skip login locally)
pytest                                              # all tests on SQLite
TEST_DATABASE_URL=postgresql://user@localhost:5432/cvtest pytest   # also run DB tests on Postgres
python -m app.manage list-users | reset-password EMAIL | delete-user EMAIL | create-user EMAIL

# frontend (from frontend/)
npm install
npm run dev          # http://localhost:5173, proxies /api -> :8000
npm run build        # tsc typecheck + production build into dist/  (this is the frontend "test")

# everything in one container (repo root)
docker compose up -d --build                         # http://localhost:8000
```

**Before every commit/PR:** `cd backend && pytest` must pass and `cd frontend && npm run build` must
succeed with zero TypeScript errors. If you touch SQL, also run the Postgres test run.

## Repository map

```
backend/app/
  main.py          FastAPI app: guard middleware (CSRF origin check, 2 MB body cap, security headers),
                   export endpoints, SPA static serving, lifespan (DB init/close)
  config.py        Settings from env (+ optional .env). Frozen dataclass; read as `config.settings` at call time
  models.py        Pydantic CV schema — the contract shared with frontend/src/types.ts
  layout.py        Templates (international, europass) + CV -> RenderDoc IR. Dates, headings, years of experience
  render_docx.py   python-docx writer for the IR (ATS-safe, see invariants)
  render_pdf.py    ReportLab writer for the IR (embedded TTF fonts, real text layer)
  fonts.py         Finds Calibri/Arial/... or metric-compatible Carlito/Liberation/Caladea, falls back to DejaVu/Helvetica
  db.py            SQLite or Postgres behind one tiny API (`get_db().tx()` -> Conn.execute/one/all); schema + migrations
  auth.py          Users, scrypt passwords, cookie sessions, throttling, /api/auth/* routes, `current_user` dependency
  storage.py       CV library CRUD, always scoped by user_id;  cvs_router.py = /api/cvs routes
  manage.py        Admin CLI (no email password reset exists)
  ai/providers.py  Raw-REST adapters: openai-compatible, anthropic, gemini, ollama; resolve() = key/base-URL policy + SSRF guard
  ai/prompts.py    Prompt builders (summary, bullets), CV -> plain text, output cleaners
  ai/router.py     /api/ai/* routes, shared-key daily limit
backend/tests/     pytest; conftest.py has the fixtures (see Testing)

frontend/src/
  main.tsx, App.tsx    App = AuthGate > StoreProvider > Shell (editor | live preview)
  session.tsx          AuthGate: login / sign-up screen, session context, 401 handling
  store.tsx            The single store: cv state, mutate(), undo, autosave, CV library, AI settings, toasts
  api.ts               All HTTP calls (fetch wrapper, ApiError, 401 -> 'cv:unauthorized' event)
  types.ts             TS mirror of backend/app/models.py (+ API types)
  sectionTypes.ts      Registry of section types: field specs, tips, which get AI bullets
  defaults.ts          uid(), emptyItem/newSection/emptyCV/exampleCV, normalizeCV (back-compat for old saves)
  storage.ts           localStorage/sessionStorage, namespaced per user id
  atsCheck.ts          Client-side ATS lint rules shown in the "ATS check" panel
  useAI.ts             Hook wrapping AI calls (readiness, busy flag, error toasts, low-quota notice)
  theme.ts             light/dark/system theme hook; index.html applies it before first paint
  styles.css           ALL styling; design tokens at the top, dark theme overrides in :root[data-theme='dark']
  components/          TopBar, CvSwitcher, AccountMenu, EditorCards (personal/target/add-section), SectionCard,
                       ItemCard (+RowItem), fields (inputs, BulletsEditor, TagInput, MonthYear, DateRange),
                       AiSettingsModal, PdfPreview, AtsPanel, ui (Modal, Popover, ConfirmDelete, Spinner)
```

## How it works

**Data model.** A CV is JSON: `{ personal, sections[], design, target }`. Every section has
`type`, `title` (empty = template default heading), `visible`, `content` (text sections) and `items[]`.
Items are *generic*: one `Item` shape (`title, organization, location, startDate, endDate, current,
date, description, bullets[], tags[], grade, link, level`) whose meaning depends on the section type.
This is what makes "add any section on demand" cheap. Dates are `"YYYY"` or `"YYYY-MM"`.
`target` (role + job description) feeds the AI and is never printed.

**Rendering pipeline.** `layout.build_document(cv)` turns the CV into a `RenderDoc` IR made of blocks
(`paragraphs | entries | pairs | lines`). `render_docx` and `render_pdf` only know how to draw the IR,
so both formats always contain the same content in the same order. Section *kinds* live in
`layout.SECTION_KIND`; template differences (headings, date style, entry order, personal-details block)
live in `layout.TEMPLATES`.

**Live preview** is the real PDF: the frontend POSTs the CV to `/api/export/pdf?inline=true`
(debounced 450 ms), and draws it with pdf.js into canvases that are swapped in at once. The
`X-Page-Count` header feeds the page badge and the ATS check.

**State (frontend).** One store in `store.tsx`. Change the CV only through
`mutate(draft => { ... })` (it structuredClones, records undo history, and triggers autosave).
Use `findSection` / `findItem` / `moveInArray` helpers. Autosave: local backup after 300 ms, server
`PUT /api/cvs/{id}` after 900 ms; `saveNow()` flushes (used before switching CV and on logout).
Per-card UI state (collapsed, AI suggestion) is local component state; `EditorBody` is keyed by CV id
so it resets when switching CVs.

**Auth.** Email + password. Passwords: scrypt (`auth.hash_password`). Sessions: random token in an
`HttpOnly; SameSite=Lax` cookie named `cvb_session` (`Secure` on HTTPS); the DB stores only its
SHA-256. Protect any new route with `user: User = Depends(current_user)`. `AUTH_ENABLED=false` makes
every request run as `LOCAL_USER` (id `"local"`). Admins = emails in `ADMIN_EMAILS` (exempt from the AI
daily limit). Throttles are in-memory (fine: production runs a single instance).

**AI.** `resolve()` merges the request's provider settings with server env defaults. A blank
`baseUrl` on the client means "server default endpoint", which is the only case where the server's key
is used. Shared-key generations are counted in `ai_usage` per user per UTC day (`AI_DAILY_LIMIT`).
Prompts follow a recruiter brief: use only facts in the CV, no buzzwords, no invented metrics; missing
numbers become `[X%]`-style placeholders that the ATS check flags.

**Database.** `DATABASE_URL`, else `POSTGRES_URI` (Northflank addon), else SQLite at
`DATA_DIR/cvs.db`. Tables: `users, sessions, cvs, ai_usage`. Schema is created idempotently on startup
in `db.SCHEMA`; there is no migration framework.

## Invariants — do not break these

1. **ATS safety of DOCX:** single column; **no tables, text boxes, images or content in headers/footers**;
   section headings use the real `Heading 1` style; bullets use `List Bullet`; contact details are in the
   body. `tests/test_export.py` enforces this. (The PDF may use a borderless ReportLab table for the
   title/date row; that's only layout, the text layer stays linear.)
2. **Both renderers stay in sync.** New CV content goes into `layout.py` (IR) first, then into *both*
   renderers. Never special-case one format.
3. **PDFs keep a real text layer** with embedded TTF fonts (Unicode names must survive; there's a test).
   Never rasterise text or switch to HTML-to-image tools.
4. **Every CV query is scoped by `user_id`** (`... WHERE id = ? AND user_id = ?`). Users must never see,
   change, duplicate or delete another user's data; `test_users_cannot_see_each_others_cvs` guards this.
5. **The server's AI key is only ever sent to the server's configured base URL**, never to a URL a user
   typed. Keep the SSRF guard (`_assert_public_host`, no redirects) active whenever auth is on. Never
   return keys from any endpoint.
6. **SQL must run on both SQLite and Postgres.** Use `?` placeholders (rewritten to `%s` for Postgres),
   portable types (TEXT/INTEGER), ISO-8601 TEXT timestamps, no `rowid`, no `AUTOINCREMENT`,
   no SQLite-only pragmas outside `db.py`. `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` is fine.
   Schema changes must be idempotent (`CREATE ... IF NOT EXISTS`; add columns with a guarded `ALTER`).
7. **AI prompts must not invent facts.** Keep the "use only facts in the CV" and placeholder rules when
   editing `prompts.py`.
8. **pdf.js must use the legacy build** (`pdfjs-dist/legacy/build/pdf.mjs` + its worker). The modern
   v6 build calls `Map.prototype.getOrInsertComputed`, which many browsers lack, so the preview breaks.
9. **No blocking browser dialogs** (`alert/confirm/prompt`). Use `ConfirmDelete` (two-step button) or
   `Modal` from `components/ui.tsx`.
10. **Styling uses tokens.** Never hard-code colours in components or CSS rules; add a token to `:root`
    *and* its dark value under `:root[data-theme='dark']`. When adding a coloured button variant, also
    define its `:hover:not(:disabled)` state (the generic `.btn:hover` otherwise turns it white).
11. **No personal data in the repo.** Placeholders and sample data use generic names (Alex Morgan,
    example.com). Never commit `.env`, keys, or database files.

## Recipes

**Add a section type** (e.g. "patents"):
1. `backend/app/models.py`: add to `SectionType`.
2. `backend/app/layout.py`: add to `SECTION_KIND` (`text | entries | groups | languages | lines`) and a
   default heading in `_COMMON_HEADINGS` (or per template); `TAGS_LABEL` if it has tags.
3. `frontend/src/types.ts`: add to `SectionType`.
4. `frontend/src/sectionTypes.ts`: add a `SectionTypeDef` (label, icon, kind, fields, addLabel,
   `multiple`, optional `aiBullets`/`tip`) and put it in `ADDABLE_ORDER`.
5. If prompts should see it differently, check `ai/prompts.py::cv_to_text` (handles kinds generically).
6. Add/adjust a test in `tests/test_export.py`.

**Add a field to items:** `models.Item` + `types.Item` + `defaults.emptyItem` (+ `normalizeCV` handles
old saves) + `sectionTypes` field spec + the IR/renderers if it's printed.

**Add an API endpoint:** put it in the relevant router, depend on `current_user`, scope data by
`user.id`, return JSON with `detail` on errors (the frontend shows `detail` in toasts), add a typed
method in `frontend/src/api.ts`, add tests using the `client` fixture (and `anon` for the 401 case).

**Add an env setting:** field on `config.Settings` + `load_settings()`; read it as `config.settings.x`
at call time (tests monkeypatch `config.settings`); document it in `.env.example` and `README.md`.

**Add a DB table/column:** append to `db.SCHEMA` (idempotent) and, for columns on existing tables, add a
guarded upgrade in `Database._init_schema` for SQLite *and* `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
for Postgres. Add the table to `TABLES` in `tests/conftest.py` so tests start clean.

**Add an AI provider:** adapter functions in `ai/providers.py` (`chat` + `list_models` branches,
`PROVIDER_INFO` entry, default in `config.py`), extend `ProviderType` in both languages, add a mocked
test in `tests/test_ai.py`.

## Testing

- Fixtures (`backend/tests/conftest.py`):
  `database` (fresh SQLite per test; also Postgres when `TEST_DATABASE_URL` is set),
  `settings(**overrides)` (patches runtime settings; defaults: auth on, sign-up on, private URLs allowed),
  `anon` (logged-out `TestClient`), `client` (signed up as alex@example.com), `sample` (sample CV dict),
  `signup(client, email=...)` helper for extra users.
- AI tests never hit the network: the `fake` fixture swaps `ai.router.make_client` for an
  `httpx.MockTransport` recorder; `server_key` gives the server an OpenAI key; SSRF tests monkeypatch
  `providers._host_ips`.
- Frontend has no unit tests; `npm run build` (tsc) is the gate. For UI changes, describe what you
  verified, and when possible check it in a browser (desktop and ~390 px wide, light and dark theme).

## Deployment (Northflank)

- Combined service built from the root `Dockerfile` (node build stage -> python:3.12-slim with
  Carlito/Caladea/Liberation/DejaVu fonts). Listens on `$PORT` (default 8000), trusts proxy headers so
  HTTPS and client IPs are detected. Runs as a non-root user.
- Postgres addon linked to the service via a secret group (`POSTGRES_URI`).
- Production env (set in Northflank, never in git): `ADMIN_EMAILS`, `OPENAI_BASE_URL`,
  `OPENAI_API_KEY`, `OPENAI_MODEL` (or Anthropic/Gemini equivalents + `AI_DEFAULT_PROVIDER`),
  `AI_DAILY_LIMIT`, `SIGNUP_ENABLED`.
- Push to `main` = deploy. Schema changes therefore must be backward compatible and idempotent; the
  app creates/upgrades tables on startup.
- Admin tasks run in the Northflank service shell: `python -m app.manage ...`.

## Working agreement for Claude Code

- Work on a branch and open a **pull request** to `main`; don't push to `main` directly unless asked.
  Keep each PR focused on one requirement; explain what changed, how you verified it, and any env vars
  or migrations it needs.
- Run the backend tests and the frontend build before pushing. Add tests for new backend behaviour.
- Update `README.md` (user-facing behaviour, env vars, API table) and this file (architecture, rules)
  when they change.
- Don't add dependencies or bump major versions without saying why in the PR. Prefer the standard
  library and the existing patterns (raw REST for AI, tiny DB layer, plain CSS).
- Ask before anything destructive or hard to undo: dropping/renaming tables or columns, changing the
  session cookie or password hashing, removing endpoints the UI uses.
- Match the existing style: Python with type hints and short docstrings explaining *why*; TypeScript
  strict mode, function components, no `any`; user-facing text in plain, friendly English.

## Known limitations / ideas

- No email-based password reset (admin CLI only); no email verification on sign-up.
- Login/sign-up throttles are in-memory, so they reset on restart and assume one instance.
- No frontend unit or E2E tests in the repo yet (Playwright would fit).
- Northflank doesn't publish the free sandbox's RAM; the app uses roughly 140 MB.
- Possible next features: cover-letter generator, job-description keyword match score, per-section AI
  rewrite, Google sign-in, admin page for users, scheduled DB backups.
