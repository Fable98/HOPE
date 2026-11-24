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
