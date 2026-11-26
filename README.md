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
| `POST /api/handoff`  | Makes a family help link (24 hours, kept in memory)        |
| `GET /h/:id`         | The help page the family member opens                      |
| `GET /demo/`         | The practice site                                          |

Default models: `claude-sonnet-5-5` plans and `claude-haiku-5-5` rewrites labels.
Override them with `HOPE_PLANNER_MODEL` and `HOPE_SIMPLIFY_MODEL`.

### Using Amazon Bedrock

Hope can call Claude through Amazon Bedrock's `bedrock-mantle` endpoint, which uses the
same Messages API as the Claude API.

1. In the AWS console, open Amazon Bedrock and check that your account has access to the
   Claude models you want (Model access).
2. Create an **API key** in the Amazon Bedrock console. A short-term key lasts up to 12
   hours and only works in the region where you made it. The identity behind it needs the
   `bedrock-mantle:CallWithBearerToken` and `bedrock-mantle:CreateInference` permissions.
3. In `.env`:

   ```sh
   AWS_BEARER_TOKEN_BEDROCK=your-bedrock-api-key
   AWS_REGION=us-east-1
   ```

4. Run `npm start`. The log line should say `planner: bedrock`.

Default Bedrock models are `anthropic.claude-sonnet-5-5` and `anthropic.claude-haiku-5-5`.
If your account can't use them yet, pick models it can use, for example:

```sh
HOPE_PLANNER_MODEL=anthropic.claude-sonnet-5
HOPE_SIMPLIFY_MODEL=anthropic.claude-haiku-4-5
```

Only Bedrock API keys are supported. Signing requests with AWS access keys or IAM roles
(SigV4) is not supported yet.

## Load the extension

1. Start the backend (above).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick
   the `extension/` folder.
3. Open a website, click the Hope icon in the toolbar. The side panel opens.
4. Type or say a goal and press **Start**.

If your server is not on `http://localhost:8787`, change the address under ⚙ Settings.

Permissions: `scripting` and access to all sites let Hope read and act on whichever site
you are using, including after it navigates to another domain. `storage` keeps your
settings and the current task. `sidePanel` shows the cards.

## Try it on the practice site

`npm start` also serves a deliberately cluttered hospital site at
<http://localhost:8787/demo/>, with a cookie banner, a chat widget, a newsletter popup,
jargon labels and an upsell. Open it, open Hope and try "Appointment with a skin doctor".
The mock planner can finish it, and a real model does it with fewer questions.

## What works in this MVP

- Goal by typing or voice. One card at a time: choices, a text answer, "fill this in
  yourself" for private fields, and a check before anything permanent.
- Silent steps, with a "What I did for you" log and "Step 3 of about 6" progress.
- Cookie banners (always turned down, never accepted), chat widgets and upsell popups are
  cleared automatically.
- Fixed code rules force a confirmation for pay, book, submit, delete and similar actions.
- Plain-language rewriting of questions and options.
- Focus, Reading and Calm profiles. Read aloud. Picking up again after the worker restarts.
- Family help links.

## Known limits

- Works in the top page only: no iframes or shadow DOM yet, so some embedded payment forms
  and cookie banners are out of reach.
- One task at a time, in the tab where it started. Links that open new tabs are kept in
  the same tab.
- Help links and the plain-language cache live in server memory and are lost on restart.
- Voice input uses Chrome's speech service, which sends audio to Google.
- The mock planner is only for trying things out. Use a real model for real sites.

## Tests

```sh
npm test          # unit tests (Node test runner + jsdom), no browser needed
npm run e2e       # real Chrome: loads the extension, books on the demo site
```

`npm run e2e` needs the server running (`npm start`) and a local Chrome. Set
`CHROME_PATH` if Chrome is not in the default place. Screenshots go to `e2e-output/`.
