# CV Builder

A web app for writing **ATS-friendly CVs** and exporting them as **DOCX and PDF**, with an AI helper that drafts your profile summary and rewrites bullet points using the provider you choose: OpenAI-compatible APIs, Anthropic, Google Gemini or a local Ollama model. It supports multiple users, each with their own private CV library, and can be hosted for free (see [Free hosting on Northflank](#free-hosting-on-northflank)).

- **Form editor.** Personal details, then sections you add when you need them: experience, education, skills, languages, certifications, projects, courses, volunteering, awards, publications, interests, references, plus custom entry or free-text sections. You can rename, reorder, hide or delete any section.
- **Live preview of the real PDF.** The server renders the PDF and the browser draws it with pdf.js, so the preview is the file you download. It also shows the page count.
- **Two layouts.** *International ATS* (no personal data, `Mar 2021 – Present`) and *EU / UK* (nationality, work permit and driving licence block, `03/2021` dates first, CEFR language levels). Both are single-column and ATS-safe.
- **CV library.** Save as many CVs as you like (for example *Software Engineer* and *DevOps*). Use **Duplicate to tailor** to copy one, then set its **Target job** so the AI tailors the wording. Edits save automatically.
- **AI writing.** "Generate with AI" for the summary. "Improve / Draft with AI" for each experience or project entry, with a review step before anything is applied. The prompts forbid inventing facts. Where a number would help, the AI leaves a `[X%]` placeholder, and the ATS check flags any left in.
- **ATS check.** Flags missing contact details, missing dates, weak bullet openers ("Responsible for…"), unfilled placeholders, emoji and page count.
- **Design.** Font (Calibri, Arial, Cambria, Times New Roman, Georgia), size, accent colour, A4 or Letter.
- **Accounts.** Sign up / log in with email and password; every user only sees their own CVs. Change password, log out, delete account (removes all their CVs).
- **Comfortable editing.** Light, dark or system theme (remembered per browser). **Collapse all / Expand all** on every section with entries. Undo with Ctrl+Z.

## What makes the output ATS-friendly

| | DOCX | PDF |
|---|---|---|
| Single column, no tables or text boxes | ✅ (enforced by tests) | ✅ |
| Contact details in the body, not the header or footer | ✅ | ✅ |
| Real Word `Heading 1` section headings and `List Bullet` bullets | ✅ | n/a |
| Real text layer with embedded TrueType fonts (copy and paste works) | n/a | ✅ |
| Standard headings ("Experience", "Education", "Skills"…) | ✅ | ✅ |
| Unicode names (é, ł, ü…) | ✅ | ✅ |

## Quick start with Docker (your own machine)

```bash
cp .env.example .env        # optional: server-side AI keys, see below
docker compose up -d --build
# open http://localhost:8000 and create an account
```

Your CVs live in the `cv-data` volume (SQLite at `/data/cvs.db`). Only using it yourself on your own computer? Add `AUTH_ENABLED=false` to `.env` to skip the login screen.

## Free hosting on Northflank

Northflank's free **Developer Sandbox** includes 2 always-on services and 1 database, which is enough for this app (the app uses about 140 MB of RAM). Northflank may ask for a card to verify your account; the sandbox itself is free.

1. **Put the code on GitHub** (a private repo is fine).
2. **Create a project** on [northflank.com](https://northflank.com), in the region closest to you.
3. **Add the database:** *Create new → Addon → PostgreSQL*. Give it a name such as `cv-db`, keep the smallest size, and wait until it says *Running*.
4. **Add the app:** *Create new → Service → Combined service*.
   - Connect GitHub, pick the repo and the `main` branch.
   - Build type **Dockerfile**, path `/Dockerfile`, build context `/`.
   - Networking: port **8000**, protocol HTTP, **Publicly expose** on.
5. **Connect the database to the app.** Easiest: *Create new → Secret group*, link the `cv-db` addon and select `POSTGRES_URI`, then apply the group to the service. The app reads `POSTGRES_URI` directly (or `DATABASE_URL` if you prefer to alias it).
6. **Set environment variables** on the service (*Environment* tab):

   | Variable | Example | Why |
   |---|---|---|
   | `ADMIN_EMAILS` | `you@example.com` | Your account isn't limited by the daily AI cap |
   | `SECRET_KEY` | 32+ random characters (`python -c "import secrets; print(secrets.token_urlsafe(32))"`) | Encrypts the API keys people save to their accounts. Required on Postgres; keep it stable, because changing it means everyone has to paste their key again |
   | `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` | Shared AI provider (any OpenAI-compatible API) |
   | `OPENAI_API_KEY` | `sk-or-...` | Shared key that every user's "Generate with AI" uses |
   | `OPENAI_MODEL` | a model ID from your provider | Default model, so users don't have to pick one |
   | `AI_DAILY_LIMIT` | `30` | Generations per user per day on your key (0 = unlimited) |
   | `SIGNUP_ENABLED` | `true` | Set to `false` later to stop new sign-ups |

   Use Anthropic or Gemini instead with `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` or `GEMINI_API_KEY`/`GEMINI_MODEL` and `AI_DEFAULT_PROVIDER`.
7. **Deploy.** Northflank builds the Dockerfile and gives you a public HTTPS URL (on `code.run`). Every push to `main` redeploys automatically.
8. **Create your account** on the live URL first.

**Admin tasks.** There's no email-based password reset. Open the service's **Shell** in Northflank and run:

```bash
python -m app.manage list-users
python -m app.manage reset-password someone@example.com
python -m app.manage delete-user someone@example.com
python -m app.manage create-user someone@example.com   # useful when SIGNUP_ENABLED=false
```

**Same image elsewhere:** any Docker host works the same way. For example, Render's free web service plus a free Neon Postgres (`DATABASE_URL=postgresql://...`). Render sleeps after 15 minutes idle; Northflank doesn't.

## Local development

```bash
# API (http://localhost:8000)
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload

# UI (http://localhost:5173, proxies /api to :8000)
cd frontend
npm install
npm run dev
```

Production without Docker: run `npm run build`, then start the API with `STATIC_DIR=../frontend/dist`. That serves the UI and the API on one port, and you can put Nginx in front.

Run the tests with `cd backend && pytest`. They cover the renderers, ATS-safety checks, all four AI adapters (against a mock transport, with no keys needed), accounts and sessions, per-user isolation, the shared-key limits, encrypted per-user saved keys and the SSRF guard. Set `TEST_DATABASE_URL=postgresql://...` to run every database test against Postgres as well as SQLite.

## Connecting an AI provider

Click **Connect AI** in the top bar:

| Provider | What to enter |
|---|---|
| **OpenAI-compatible** | Pick a preset (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, LM Studio) or any base URL, then an API key |
| **Anthropic** | API key |
| **Google Gemini** | API key from Google AI Studio |
| **Ollama** | Base URL. Use `http://localhost:11434` in local dev, or `http://host.docker.internal:11434` when the app runs in Docker |

**Load models** checks the connection and fills the model list.

**Shared server key:** put a key in the server environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) and every signed-in user can generate without pasting one, up to `AI_DAILY_LIMIT` generations per day each (admins are exempt). The key itself never reaches the browser, and it's only ever sent to the server's own configured endpoint, never to a base URL a user types in.

**Personal keys (per account):** each person can paste their own key in AI settings; requests on your own key aren't limited. With **Save API keys to my account** ticked (the default), the key is stored on the server, encrypted, and tied to that person's account, so it works on any device they log in from and nobody else can use it. Key precedence for each request is: a key typed in this tab → your saved key → the server's shared key.

- Saved keys are encrypted with AES-256-GCM using `SECRET_KEY`. On SQLite installs with no `SECRET_KEY`, a random key is created once in `secret.key` next to the database. **Postgres deployments must set `SECRET_KEY`**; without it, saving keys is switched off and keys stay in the browser tab as before.
- Each saved key is bound to the endpoint (provider + base URL) it was saved for and is only ever sent there. To use a different base URL, save the key again for that URL.
- The API never returns a saved key, only its last 4 characters. Remove saved keys in AI settings; deleting the account deletes them too.
- Untick **Save API keys to my account** to keep a key in the current browser tab only; the server then just forwards it to the provider without storing it.

To make everyone bring their own key, don't set a server key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`).

## Security notes

- **Passwords** are hashed with scrypt (random salt per user). **Sessions** are random 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS); only a SHA-256 of each token is stored, so a database leak doesn't expose live sessions. Changing your password signs out your other devices.
- **Brute-force protection:** 8 failed logins per email or 40 per IP in 15 minutes → temporary block; 5 sign-ups per IP per hour. Unknown emails and wrong passwords get the same answer.
- **Isolation:** every CV query is filtered by the owner's id; tests check one user can't read, change, duplicate or delete another's CVs.
- **CSRF / abuse:** state-changing API calls from another site's origin are rejected; request bodies over 2 MB are refused; the PDF/DOCX/AI endpoints require login.
- **Saved AI keys** are encrypted at rest (AES-256-GCM, `SECRET_KEY`), bound to their owner and endpoint, and never sent back to the browser. Someone who steals a session can use the victim's key through the app, but can't read it or point it at another host.
- **SSRF:** with accounts on, AI base URLs that resolve to localhost or private/internal IPs are blocked (`ALLOW_PRIVATE_BASE_URLS=false`), and redirects aren't followed. This is why Ollama only works on self-hosted installs.
- **Open sign-up + shared AI key** means anyone who finds the URL can spend up to `AI_DAILY_LIMIT` generations a day of your credit. Keep the limit modest, set a spending cap at your AI provider, and switch `SIGNUP_ENABLED=false` once your friends have accounts.
- **Backups:** export important CVs as JSON (⋯ menu), and/or back up the Postgres database (`pg_dump`) or the `cv-data` volume.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/export/pdf` | CV JSON → PDF (`X-Page-Count` header; `?inline=true` for preview) |
| `POST` | `/api/export/docx` | CV JSON → DOCX |
| `GET` | `/api/meta` | Templates, default headings, resolved PDF fonts |
| `POST` | `/api/auth/signup`, `/login`, `/logout`, `/password`, `/delete-account` | Accounts and sessions (cookie) |
| `GET` | `/api/auth/me`, `/api/auth/config` | Current user; whether sign-up is open |
| `GET/POST` | `/api/cvs` | List / create (`{name, data}` or `{name, sourceId}` to duplicate) |
| `GET/PUT/DELETE` | `/api/cvs/{id}` | Load / save (`{name?, data?}`) / delete |
| `GET` | `/api/ai/config` | Providers, whether a server key exists (never the key), whether keys can be saved to accounts |
| `GET/PUT` | `/api/ai/keys` | List your saved keys (provider, base URL, last 4 characters) / save one (`{provider: {type, baseUrl, apiKey}}`) |
| `DELETE` | `/api/ai/keys/{id}` | Remove a saved key |
| `POST` | `/api/ai/models` | List models (connection test) |
| `POST` | `/api/ai/generate` | `task: "summary" \| "bullets"` → `{text}` / `{bullets}` |

Interactive docs are at `/docs`.

## Project layout

```
backend/app/
  models.py        Pydantic CV schema (shared shape with the UI)
  layout.py        templates + CV → render IR (both renderers draw the same IR)
  render_docx.py   python-docx writer
  render_pdf.py    ReportLab writer (embedded TTF fonts)
  fonts.py         finds Calibri/Arial… or metric-compatible Carlito/Liberation/Caladea
  ai/              provider adapters (raw REST, no SDKs), prompts, routes, encrypted per-user keys
  db.py            SQLite or Postgres (DATABASE_URL / POSTGRES_URI), schema + migrations
  auth.py          accounts, scrypt passwords, cookie sessions, throttling
  storage.py       per-user CV library;  cvs_router.py  its routes
  manage.py        admin CLI (list users, reset password, delete user)
frontend/src/
  sectionTypes.ts  section registry: fields, tips, which get AI bullets
  session.tsx      login / sign-up screen and session gate
  store.tsx        state, undo, autosave, CV library
  components/      editor cards, fields, AI settings, PDF preview, CV switcher
```

**Adding a section type:** add it to `SectionType` in `models.py` and `types.ts`, give it a layout kind and heading in `layout.py`, and add its field list in `sectionTypes.ts`.
