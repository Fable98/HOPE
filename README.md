# Hope

Hope is a Chrome extension that guides someone through a cluttered website one decision
at a time. The user types or says a goal, such as "Appointment with a skin doctor". An AI
agent reads the real page, does the steps that need no decision, and asks the user only
what it has to. Each question appears as a large card with plain wording and a few big
buttons.

It is for people with ADHD or dyslexia, elderly or anxious users, and anyone tired or
stressed. Reader mode and high-contrast tools change how a page looks. Hope reduces how
much the user has to think.

> Status: early MVP. Expect rough edges.

## Repository layout

| Path         | What it is                                                   |
|--------------|--------------------------------------------------------------|
| `extension/` | The Chrome extension (Manifest V3, plain JavaScript, no build step) |
| `server/`    | The backend: holds the AI API key, plans steps, runs help links |
| `demo/`      | A deliberately cluttered practice site for trying Hope       |
| `docs/`      | Architecture and design notes                                |
| `test/`      | Tests, run with Node's built-in test runner                  |

See [docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## Requirements

- Node.js 22 or newer
- Chrome 116 or newer

## Run the backend

```sh
cp .env.example .env   # optional: add ANTHROPIC_API_KEY or OPENAI_API_KEY
npm start              # http://localhost:8787
```

Without an API key the server uses a rule-based mock planner. It is enough to click
through the demo site, but it is not smart.

| Route                | Purpose                                                    |
|----------------------|------------------------------------------------------------|
| `GET /health`        | Liveness check, reports the planner provider               |
| `POST /api/plan`     | `{ goal, page, history }` → `{ decision }`                 |
| `POST /api/simplify` | `{ texts: [...] }` → `{ texts: [...] }` in plain language  |

Default models: `claude-sonnet-5-5` plans and `claude-haiku-5-5` rewrites labels.
Override them with `HOPE_PLANNER_MODEL` and `HOPE_SIMPLIFY_MODEL`.

## Tests

```sh
npm test
```
