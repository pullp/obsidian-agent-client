#!/bin/bash
# Install agent-client plugin to Obsidian vault
set -e

VAULT_DIR="/Users/xkw/obsidian-valuts/invest-notes"
PLUGIN_DIR="${VAULT_DIR}/.obsidian/plugins/agent-client"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null

echo "==> Building plugin..."
node esbuild.config.mjs production

echo "==> Installing to ${PLUGIN_DIR}..."
mkdir -p "$PLUGIN_DIR"
cp main.js "$PLUGIN_DIR/"
cp manifest.json "$PLUGIN_DIR/"
cp styles.css "$PLUGIN_DIR/"

echo "==> Done! Restart Obsidian or reload plugins to activate."
