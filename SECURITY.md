# Security and privacy

The browser profile contains authenticated session material. Exports, logs, catalogs, and checkpoints contain private conversation data. Keep `data/`, `playwright-profile/`, and `config.json` local. Git ignores are a convenience, not an access-control boundary; do not force-add them.

The search reader listens on `127.0.0.1` and must not be exposed through a reverse proxy, public tunnel, or shared hosting. Other programs on your computer may still access it.

For a suspected vulnerability, use the repository's private vulnerability reporting feature if enabled. If unavailable, open an issue requesting a private reporting channel without including exploit details or private data.

Never post cookies, tokens, account identifiers, raw response captures, browser state, or real conversations in issues or pull requests.
