# pi-herdr-tab-namer

A Pi extension that renames the current Herdr tab from a short summary of
your first prompt in the session. Summarization runs in the background
against a separate, pre-configured model — it never delays your prompt and
never appears in the chat transcript.

## Install

```bash
pi install npm:@walidsi/pi-herdr-tab-namer
```

Then edit `config.json` so `model` points at something you actually have
credentials for in pi (check with `pi --list-models`):

```json
{
  "model": { "provider": "anthropic", "id": "claude-haiku-4-5-20251001" },
  "maxWords": 4,
  "maxTitleLength": 40,
  "debug": false
}
```

- `maxWords` / `maxTitleLength` control how terse the generated tab title is.
- `debug: true` enables file logging to `debug.log` next to the loaded
  extension, `/tmp/pi-herdr-tab-namer-debug.log` elsewhere). Leave it `false` 
  to keep the extension completely silent.

## Behavior notes / assumptions

- Only fires on a session's genuine first user message (checked via
  `ctx.sessionManager.getEntries()` in `session_start`). Resuming a session
  that already has history will not re-trigger it.
- If the extension isn't running inside a Herdr-managed pane
  (`HERDR_ENV` / `HERDR_TAB_ID` unset), it's a silent no-op.
- Failures at any step (model not found, no API key, network error, `herdr`
  binary missing) are swallowed — this is cosmetic, so it never surfaces an
  error to you or interrupts the agent.

## Docs consulted

- https://pi.dev/docs/latest/extensions (`before_agent_start`, nested model
  calls via `ctx.modelRegistry` + `complete()`, `pi.exec`)
- https://herdr.dev/docs/cli-reference/ (`herdr tab rename <tab_id> <label>`,
  `HERDR_ENV` / `HERDR_TAB_ID` environment variables)
- https://herdr.dev/docs/integrations/ (guard pattern for Herdr-managed panes)
- https://herdr.dev/docs/concepts/ (tab vs. pane vs. workspace)
