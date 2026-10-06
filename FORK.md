# This is a fork

`WILSCH-AI-SERVICES/twenty-cli` is the house's fork of
[`salmonumbrella/twenty-cli`](https://github.com/salmonumbrella/twenty-cli), a
community CLI for [Twenty CRM](https://github.com/twentyhq/twenty). The upstream is
MIT-licensed (see `LICENSE`, unchanged); the fork keeps that licence.

The house maintains this fork as the binary every agent act against Twenty runs
through. It exists because the upstream is a single-commit repository with no
release cadence the house controls, and because two things the house needs were
not in it: a command that reads the workspace configuration back out as text, and a
check that says out loud when Twenty's next version breaks an act the house relies on.

## Where it was cut from

| Fact                                                      | Value                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Upstream repository                                       | `salmonumbrella/twenty-cli`                                                                                                      |
| Upstream commit the fork was cut from                     | `52d8965` — "Initial commit", 2026-06-20, the upstream's only commit                                                             |
| Version the upstream **manifest** declared at that commit | `0.1.10` (`packages/twenty-sdk/package.json`)                                                                                    |
| Version the upstream **release** was tagged               | `v0.1.14`, four platform tarballs (`linux_amd64`, `linux_arm64`, `darwin_amd64`, `darwin_arm64`), pkg-built for Node 24          |
| Source commit the `v0.1.14` tarballs were built from      | **Not recorded upstream.** The tarball's `twenty-release.json` carries only `archiveSuffix`, `nodeMajor`, `pkgTarget`, `target`. |
| npm                                                       | `@salmonumbrella/twenty-cli` is not published (registry answers 404); the release tarball was the only install route             |

So the upstream's manifest and its release disagree by four patch versions, and the
source those four versions of tarballs were built from is not in the repository. The
fork does not inherit that gap silently: it is stated here, and the fork's own version
line starts after it.

## Version line

The fork's versions are `0.1.15-wilsch.N` — after the upstream's last release tag,
carrying the house's name, never bare `0.1.14`. The manifest in
`packages/twenty-sdk/package.json` is authoritative for the fork; a build embeds the
commit it was built from, and `twenty --version` reports both:

```
0.1.15-wilsch.2 (WILSCH-AI-SERVICES/twenty-cli@<commit>; forked from salmonumbrella/twenty-cli@52d8965, released as v0.1.14, manifest 0.1.10)
```

A binary whose `--version` prints bare `0.1.14` is the upstream tarball, not this fork.

## What the fork adds

- `twenty config export` — reads the workspace configuration back out as text:
  objects with every field, views with their fields, filters, filter groups, groups and
  sorts, and roles with their permission flags, object permissions and field
  permissions. Emission is the API's own order, untouched, so two exports of an
  unchanged workspace are byte-identical without any post-processing. Every list is
  paged to completion and its count checked against the server's `totalCount`; a
  mismatch is a hard error, never a silently short export. The document names the
  entity kinds it carries and the kinds it omits.
- `twenty auth login --email <you> --base-url <instance>` — signs in as the person:
  their password, then their second factor when the workspace enforces one. The
  session (a refresh token and a short-lived access token) is kept in
  `~/.twenty/config.json` at mode 0600 and renews itself on every command, so `twenty`
  reaches the instance from any directory with no `.env` and nothing exported — and
  every write it makes names that person's workspace member, where an API key would
  name only the key. An exported `TWENTY_API_TOKEN` still overrides it.
- `twenty parity check` — drives the seven acts the house relies on against a live
  instance, each witnessed on a separate re-read from the store, and exits non-zero the
  moment any of them does not land. See `packages/twenty-sdk/src/cli/commands/parity/`.
- `twenty tasks create` / `twenty tasks close` / `twenty opportunities close` — Tasks and
  Opportunities written in the house's shape (DaveX2001/deliverable-tracking#3266): an open
  Task's note holds the address it rests on and the issue it sits on, a closed one ends in
  `Closed DD.MM · proof: [what it is](address)`, a closed Opportunity carries `whyStopped`.
  The same rules hold on every write the CLI sends — record commands, batch and upsert
  forms, `graphql`, `raw rest`, `raw graphql`, `mcp exec` — through a guard in the HTTP
  transport (`packages/twenty-sdk/src/cli/utilities/house-rules/`) that refuses the write
  before it leaves the machine and names what is missing.

## Building and installing from source

`scripts/install-from-source.sh` builds the fork with pnpm and installs a launcher at
the path the house's harnesses resolve the CLI from (default
`~/twenty-cli-3021/dist/twenty`, override with `DEST=`), and links it as `twenty` into
`~/.local/bin` (override with `BIN_DIR=`) so a shell resolves it by name. Whatever stood
at either path before is preserved beside it, never deleted. The launcher execs
`packages/twenty-sdk/dist/cli/cli.js` under the host's `node`; nothing in it is copied
from a release tarball.

```bash
git clone https://github.com/WILSCH-AI-SERVICES/twenty-cli.git ~/twenty-cli
~/twenty-cli/scripts/install-from-source.sh
~/twenty-cli-3021/dist/twenty --version
```

Node: the upstream pinned `^24.5.0`; the fork accepts `>=24.5.0` because the house's
hosts run Node 25.

## Keeping up with upstream

```bash
git remote add upstream https://github.com/salmonumbrella/twenty-cli.git
git fetch upstream
git log --oneline HEAD..upstream/main
```

Merge upstream changes onto `main`, re-run `pnpm check` and `twenty parity check`
against the house's instance before cutting the next `0.1.15-wilsch.N` tag.

## CI

The upstream's `.github/workflows` are kept as-is except that the release workflow
publishes nothing outside this repository (no Homebrew tap, no npm) — see the
workflow files for what was disabled and why.
