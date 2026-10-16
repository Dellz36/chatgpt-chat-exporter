# ChatGPT Chat Exporter

**Keep a readable, searchable copy of your ChatGPT conversations on your own computer.**

ChatGPT Chat Exporter is a free, MIT-licensed command-line tool that opens a dedicated browser, lets you sign in yourself, and saves discovered conversations as Markdown and JSON. A built-in local reader lets you search the exported text without uploading your archive to another service.

**Status: early preview (0.1.0).** Offline archive and security regression tests pass. This release has not yet completed a fresh end-to-end export against the current ChatGPT website. Website changes can break discovery, and an export may be incomplete.

[Get started](#quick-start) · [What gets saved](#your-private-files) · [Limitations](#limitations) · [Troubleshooting](TROUBLESHOOTING.md) · [Security](SECURITY.md)

## How it works

1. **Sign in:** the tool opens a separate browser profile. You choose the account and workspace.
2. **Export:** discovered conversations are saved to a private local folder, with checkpoints for resuming.
3. **Search:** open the local reader to search text and read transcripts in your browser.

No API key or paid API subscription is needed. Your existing ChatGPT account must have permission to access the conversations. This is a developer utility that runs from a terminal, rather than a packaged desktop app.

## Features

- Discover active and archived conversations, plus project references visible in captured sidebar responses.
- Preserve raw conversation JSON and generate readable Markdown.
- Resume completed exports with checkpoints and wait through rate limits.
- Search locally with SQLite FTS5 and filter by project or archived status.
- Sign in manually in a dedicated browser profile.

## Quick start

### 1. Download and install prerequisites

- Install [Node.js](https://nodejs.org/) **24 or newer**, including npm.
- On this repository, select **Code → Download ZIP**, extract it, and open a terminal in the extracted folder containing `package.json`.
- Windows, macOS, and Linux can use the commands below. Browser support depends on Playwright's supported operating systems. Automated checks currently target Windows and Linux.

### 2. Install the exporter

```sh
npm install
npm run install-browser
npm test
```

The browser installation downloads Chromium. SQLite is included with Node.js; no separate database server is required.

### 3. Export your conversations

```sh
npm run export
```

Sign in inside the browser opened by the exporter, select your workspace, and wait for its sidebar to load. Return to the terminal and press Enter. No API key is required. Complete any login or verification prompts yourself.

Stop with Ctrl+C. Run `npm run export` again to resume. Use a separate installation folder for each account or workspace: checkpoints are local to that folder. A resumed catalog does not discover newly added conversations; use a fresh installation folder for a fresh full discovery, keeping your previous archive.

### 4. Search your archive

After an export has created the database:

```sh
npm run serve
```

Open <http://127.0.0.1:43110>. The reader binds to loopback only and has no remote hosting or user-account system. Stop it with Ctrl+C. Keep it private to your computer.

Windows users may also run `export.ps1` and `search.ps1` from PowerShell.

## Configuration

Defaults are in `config.example.json`. Optionally copy it to `config.json` and edit that local file. `config.json` is excluded from Git. The default browser is Playwright Chromium; `browserExecutablePath` can select a locally installed compatible browser. Requests are restricted to `https://chatgpt.com`.

The default request delay is 10 seconds; HTTP 429 triggers a cooldown of at least 10 minutes and respects longer Retry-After values. Authentication failures stop the export. Do not lower delays to work around service limits.

## Your private files

| Location | Contents |
| --- | --- |
| `data/raw/` | Original conversation JSON, including metadata |
| `data/markdown/` | Readable transcripts |
| `data/archive.db` | Conversation and message search database |
| `data/checkpoint.json` | Export completion and failure state |
| `data/discovered.json` | Discovered conversation catalog |
| `data/export.log` | Progress, titles, identifiers, and errors |
| `playwright-profile/` | Persistent browser login state |

These files are private and excluded from Git. The exporter is not a redaction tool: exports can contain personal information, secrets present in conversations, and temporary attachment URLs. Protect your backups and never attach these folders to a public issue. Network response bodies and session headers used for discovery remain in memory rather than diagnostic files; browser login state persists in the dedicated profile.

## Search examples

```text
"exact phrase"
installation AND backup
python OR javascript
config*
```

## Limitations

- Unofficial and unaffiliated with OpenAI. Uses internal website endpoints rather than a supported export API.
- Project discovery only sees returned metadata and sidebar responses; projects or conversations may be missing. Compare the archive against your workspace before relying on it.
- Attachments, images, and other binary assets are not downloaded. Links in raw metadata can expire.
- Deleted conversations cannot be recovered.
- Raw JSON retains branch metadata; Markdown flattens messages by timestamp and may show alternate branches together.
- There is no supported import here that recreates native ChatGPT sidebar conversations.
- Export only conversations you are authorized to access and follow applicable workspace policies and service terms.

See [Troubleshooting](TROUBLESHOOTING.md), [Security](SECURITY.md), and [Contributing](CONTRIBUTING.md).

## License

[MIT](LICENSE). This independent project is not affiliated with, endorsed by, or supported by OpenAI. ChatGPT is a trademark of OpenAI.
