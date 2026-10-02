#!/usr/bin/env bash
# Build this fork from source and install a launcher at the path the house's harnesses
# resolve the CLI from.
#
# WHY A LAUNCHER AND NOT A TARBALL. The upstream's only install route was a pkg-built
# release tarball whose source commit is not recorded anywhere (see FORK.md). A binary
# that cannot say which source it was built from cannot be the maintainer. This script
# builds `packages/twenty-sdk/dist` with tsc from the checkout it lives in, embeds the
# checkout's commit into the build (`twenty --version` reports it), and installs a
# two-line launcher that execs that dist under the host's node. Nothing at $DEST comes
# from a release archive.
#
# Non-interactive by construction: no prompts, no sudo, pnpm fetched through npx when
# the host has none. Re-runnable: whatever stood at $DEST before is preserved beside it
# with a timestamp, never deleted, and a launcher this script wrote earlier is simply
# overwritten.
#
#   DEST=~/twenty-cli-3021/dist/twenty   the harness path (env.sh: TW=~/twenty-cli-3021/dist/twenty)
#   PNPM="npx -y pnpm@10.28.0"           override to use a preinstalled pnpm
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST=${DEST:-$HOME/twenty-cli-3021/dist/twenty}
PNPM=${PNPM:-npx -y pnpm@10.28.0}
NODE_BIN=${NODE_BIN:-$(command -v node)}

echo "--- fork checkout : $ROOT"
echo "--- commit        : $(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet || echo ' (dirty)')"
echo "--- node          : $("$NODE_BIN" --version) at $NODE_BIN"
echo "--- install to    : $DEST"

cd "$ROOT"
echo "--- pnpm install (frozen lockfile)"
$PNPM install --frozen-lockfile
echo "--- pnpm build (tsc + build-info)"
$PNPM build

DIST_CLI="$ROOT/packages/twenty-sdk/dist/cli/cli.js"
[ -f "$DIST_CLI" ] || { echo "build produced no $DIST_CLI" >&2; exit 1; }

mkdir -p "$(dirname "$DEST")"
if [ -e "$DEST" ] && ! grep -qs "twenty-cli fork launcher" "$DEST"; then
  KEEP="$DEST.pre-fork.$(date -u +%Y%m%dT%H%M%SZ)"
  echo "--- preserving what stood at $DEST -> $KEEP"
  mv "$DEST" "$KEEP"
fi

cat > "$DEST" <<EOF
#!/usr/bin/env bash
# twenty-cli fork launcher — written by $ROOT/scripts/install-from-source.sh
# Runs the build at $DIST_CLI (WILSCH-AI-SERVICES/twenty-cli). Not a release archive.
exec "$NODE_BIN" "$DIST_CLI" "\$@"
EOF
chmod 0755 "$DEST"

echo "--- installed. version reported by $DEST:"
"$DEST" --version

# On PATH, by name (#3236): a launcher only reachable by its full path is one no shell
# resolves, so an operator's `twenty` from any directory would find nothing (#3119).
BIN_DIR=${BIN_DIR:-$HOME/.local/bin}
mkdir -p "$BIN_DIR"
if [ -e "$BIN_DIR/twenty" ] && [ ! -L "$BIN_DIR/twenty" ]; then
  KEEP="$BIN_DIR/twenty.pre-fork.$(date -u +%Y%m%dT%H%M%SZ)"
  echo "--- preserving what stood at $BIN_DIR/twenty -> $KEEP"
  mv "$BIN_DIR/twenty" "$KEEP"
fi
ln -sfn "$DEST" "$BIN_DIR/twenty"
echo "--- linked $BIN_DIR/twenty -> $DEST"
LOGIN_PATH=$("${SHELL:-/bin/sh}" -lic 'printf %s "$PATH"' 2>/dev/null || true)
case ":$LOGIN_PATH:" in
  *":$BIN_DIR:"*) echo "--- a fresh login shell resolves: $("${SHELL:-/bin/sh}" -lic 'command -v twenty' 2>/dev/null)" ;;
  *) echo "--- WARNING: $BIN_DIR is not on a fresh login shell's PATH; add it to your shell profile" >&2 ;;
esac
