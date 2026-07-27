# @walidsi/pi-herdr-tab-namer

A [Pi](https://pi.dev) extension that automatically renames the current
[Herdr](https://herdr.dev) tab based on a short summary of your first prompt.
The summarization runs in the background against a separate, configurable
model, so it never delays your turn or appears in the chat transcript.

## Install

```bash
pi install npm:@walidsi/pi-herdr-tab-namer
```

You can also install directly from GitHub:

```bash
pi install git:github.com/walidsi/pi-herdr-tab-namer
```

## Configure

Edit `config.json` in the installed extension folder so `model` points at a
model you have credentials for in Pi:

```json
{
  "model": { "provider": "anthropic", "id": "claude-haiku-4-5-20251001" },
  "maxWords": 4,
  "maxTitleLength": 40,
  "debug": false
}
```

| Option | Description |
|--------|-------------|
| `model.provider` / `model.id` | The model used to summarize the prompt. |
| `maxWords` | Maximum number of words in the generated title. |
| `maxTitleLength` | Hard character limit for the generated title. |
| `debug` | Write diagnostic logs to `debug.log` when `true`. |

## How it works

- Triggers once per session on the first real user message.
- Calls a lightweight model to summarize the prompt into a short tab title.
- Runs `herdr tab rename` in the background to update the Herdr tab label.
- If Herdr environment variables are missing, it silently does nothing.
- All failures are swallowed so the extension never interrupts your workflow.

## Requirements

- [Pi](https://pi.dev) coding agent
- [Herdr](https://herdr.dev) terminal workspace manager with the `herdr` CLI on
  your `PATH`
- A Pi model you have credentials for

## Keywords

`pi`, `pi-extension`, `pi-package`, `herdr`, `tab`, `rename`, `terminal`,
`workspace`, `productivity`

## Docs consulted

- https://pi.dev/docs/latest/extensions
- https://herdr.dev/docs/cli-reference/
- https://herdr.dev/docs/integrations/
- https://herdr.dev/docs/concepts/
