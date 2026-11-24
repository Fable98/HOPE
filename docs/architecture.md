# Hope architecture (MVP)

Hope has two parts: a Chrome extension (Manifest V3) and a small Node backend.

```
┌──────────── Chrome ─────────────────────────────────────────────┐
│                                                                 │
│  Side panel (sidepanel/)        Service worker (background.js)  │
│  - goal input, voice            - agent loop (lib/agent.js)     │
│  - one card at a time   ◄─port─► - safety rules (lib/safety.js) │
│  - progress, "What I did" log   - decision checks (protocol.js) │
│                                  - task state in storage        │
│                                        │ scripting.executeScript│
│                                        ▼                        │
│                          Page script (content/hope-page.js)     │
│                          - snapshot: list controls, give IDs,   │
│                            blank out sensitive values           │
│                          - act: click / type / select, verify   │
│                          - clutter: cookie banners, chat, popups│
└────────────────────────────────────────┬────────────────────────┘
                                         │ HTTPS (JSON)
                               ┌─────────▼──────────┐
                               │ Backend (server/)  │
                               │ POST /api/plan     │──► planner model
                               │ POST /api/simplify │──► cheaper model
                               │ POST /api/handoff  │
                               │ GET  /h/:id        │  family help page
                               └────────────────────┘
```

## The loop

1. The page script hides clutter it recognises and records what it did.
2. The page script takes a snapshot of the page.
3. The backend's planner returns one **decision**.
4. The extension checks the decision against the snapshot (`protocol.js`), then runs
   the fixed safety rules (`safety.js`). Safety rules can only make a decision
   stricter, for example turn a silent click into a confirmation. They never relax it.
5. Depending on the decision, the extension either acts on the page and loops, or shows a
   card and waits for the user.

The task state lives in `chrome.storage.local` because Manifest V3 service workers stop
when idle. When the worker starts again, an interrupted task shows a "Continue?" card.

## Decision format

The planner returns JSON with one of these `type` values:

| type      | meaning                                     | required fields                       |
|-----------|---------------------------------------------|---------------------------------------|
| `act`     | do one step without asking                  | `action`, `log`                       |
| `ask`     | ask the user one question                   | `question` and one of `options`, `input`, `manual` |
| `confirm` | show a check before something permanent     | `action`, `summary`                   |
| `done`    | the goal is reached or cannot be reached    | `message`                             |

All types may include `reason` (not shown to the user), `help` (one short line shown
under the question) and `progress: { step, total }`.

An `action` is `{ kind, targetId, value? }` where `kind` is one of `click`, `type`,
`select`, `check` or `scroll`.

Ask variants:

- `options`: 2 to 5 buttons, each `{ label, action }`. The planner decides in advance what
  each answer does on the page.
- `input`: `{ targetId, kind, placeholder? }`. The user's text is typed into that field.
- `manual`: `{ targetId, instruction }`. Used for passwords, card numbers and one-time
  codes. Hope highlights the field and the user fills it in on the page. Hope never sees
  or types these values.

## Safety rules

`safety.js` is plain code with no model involved. A click counts as irreversible when:

- the control's label contains words such as pay, buy, place order, book, submit, send,
  delete, transfer, cancel subscription, sign, authorise, donate; or
- the control submits a form and its label is not on a short safe list (search, next,
  continue, sign in, and so on); or
- the page looks like a payment page (card fields, or `checkout` / `payment` in the URL or
  title) and the label is continue, proceed, next or confirm.

An irreversible `act` becomes a `confirm`. An `ask` option that leads to an irreversible
click shows a confirmation card after the user picks it. Typing into a sensitive field is
always turned into a `manual` card.

## Privacy

- The page script replaces values of sensitive fields (passwords, card data, CVV, OTP,
  PIN, account numbers, Aadhaar, PAN, SSN) with `[hidden]` before anything leaves the page.
- Long digit runs in page text (12 or more digits, as in card or ID numbers) are replaced
  with `[number hidden]`.
- Family help links never include the page's query string or fragment.
- The backend does not log request bodies.
