#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

EXCLUDES=(
  -not -path '*/node_modules/*'
  -not -path '*/target/*'
  -not -path '*/dist/*'
  -not -path '*/.next/*'
  -not -path '*/generated/*'
  -not -path '*/*.generated.*'
  -not -path '*/prisma/migrations/*'
)

SRC=( -name '*.rs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.sh' )

count() {
  find "$1" "${EXCLUDES[@]}" \( "${@:2}" \) | xargs cat 2>/dev/null | wc -l | tr -d ' '
}

echo "Lines of code by language:"
echo "=========================="
printf "%-20s %s\n" "Rust"       "$(count "$ROOT" -name '*.rs')"
printf "%-20s %s\n" "TypeScript" "$(count "$ROOT" -name '*.ts' -o -name '*.tsx')"
printf "%-20s %s\n" "CSS"        "$(count "$ROOT" -name '*.css')"
printf "%-20s %s\n" "Shell"      "$(count "$ROOT" -name '*.sh')"
echo "=========================="

echo ""
echo "Lines of code by package:"
echo "=========================="
for dir in crates/willow-core packages/chat packages/mcp-server packages/shared; do
  printf "%-20s %s\n" "$dir" "$(count "$ROOT/$dir" "${SRC[@]}")"
done
echo "=========================="
