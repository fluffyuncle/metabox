#!/bin/sh

#set -e

DENO_CMD="$(command -v deno 2>/dev/null || true)"
if [ -z "$DENO_CMD" ]; then
	DENO_INSTALL="${DENO_INSTALL:-$HOME/.deno}"
	DENO_CMD="$DENO_INSTALL/bin/deno"
	if [ "$OS" = "Windows_NT" ]; then
		DENO_CMD="${DENO_CMD}.exe"
	fi

	if ! [ -x "$DENO_CMD" ]; then
		. ./scripts/install_deno.sh --no-modify-path --yes
	fi
fi

"$DENO_CMD" task start
