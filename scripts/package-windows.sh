#!/bin/sh
set -eu
node "$(dirname "$0")/package-windows.mjs" "$@"
