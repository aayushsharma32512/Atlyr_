#!/bin/bash
# Setup script for query-your-helper repo
# Usage: bash setup.sh

set -e

# Check for bun
if ! command -v bun &> /dev/null; then
  echo "bun could not be found. Please install bun from https://bun.sh/docs/install before running this script."
  exit 1
fi

echo "Installing dependencies with bun..."
bun install

echo "Setup complete!"
echo "If you need to set up the database, follow the README or run your Supabase migrations." 