# Troubleshooting

## Installation

Use Node.js 24 or newer with npm. SQLite uses Node's built-in module, so no C++ build tools or separate SQLite package are required. Node may display an experimental SQLite warning.

If Chromium is missing, run `npm run install-browser`. For a compatible installed browser, set its executable path in your ignored `config.json`.

## Login or workspace selection

Sign in manually in the dedicated browser. Select the workspace, wait until its chats are visible, then press Enter in the terminal. If the page is navigating, wait for it to settle. A 401 or 403 stops the operation; resolve access in the browser before rerunning. Never paste cookies, access tokens, or authorization headers into a configuration file or issue.

## Discovery fails or appears incomplete

Internal endpoints may change. Inspect the conversation-list requests in your browser's Network panel and update endpoint templates in `config.json`. Copy only endpoint structure, never a full request with headers or personal identifiers. Supported paging placeholders are `{offset}`, `{limit}`, and `{cursor}`. Restart after changing configuration.

Project names come from sidebar response metadata. Open relevant projects before confirming readiness. This does not guarantee complete discovery. Check active, archived, and project counts manually before relying on the archive.

## Rate limits

Leave default pacing in place or increase `requestDelayMs`. HTTP 429 uses a cooldown of at least ten minutes. Retry-After may extend it. Keep the terminal and browser open while waiting.

## Search

Run an export before starting the reader. Search uses SQLite FTS5 syntax: quote phrases and simplify punctuation if a query fails. If the default port is busy, set `PORT` to another local port before starting the reader.

## Reporting bugs

Share steps, operating system, Node version, and a sanitized error. Do not share exports, browser profiles, database files, raw network responses, personal chat titles, or screenshots containing private information.
