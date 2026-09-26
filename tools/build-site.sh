#!/usr/bin/env bash
# Builds the website for deployment into the given directory:
#
#   <out>/                      site from the current checkout (tracked files only)
#   <out>/vX.Y.Z/               widget of each release tag, never changes (use with SRI)
#   <out>/vX/                   newest release of each major version
#   <out>/versions.json         released versions with integrity hashes (used by the configurator)
#
# Release tags look like v2.0.1. The VERSION constant in the tagged whatsapp-widget.js
# must match the tag, otherwise the build fails.
#
# Usage: tools/build-site.sh <output directory>

set -euo pipefail

out=${1:?Usage: tools/build-site.sh <output directory>}
root=$(git rev-parse --show-toplevel)
cd "$root"

if [ -e "$out" ] && [ -n "$(ls -A "$out")" ]; then
  echo "Output directory $out is not empty." >&2
  exit 1
fi
mkdir -p "$out"

# 1. Site: all tracked files except repository-only files.
git ls-files -z \
  | grep -zvE '^(\.github/|tests/|tools/|addons/|\.gitignore$|README\.md$|api/config\.sample\.php$)' \
  | xargs -0 -I{} cp --parents {} "$out/"

# 2. Released versions.
tags=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V || true)

integrity() {
  echo "sha384-$(openssl dgst -sha384 -binary "$1" | openssl base64 -A)"
}

# Headers for Apache (mod_headers). CORS is needed for integrity checks across origins.
write_htaccess() {
  cat > "$1/.htaccess" <<EOF
<IfModule mod_headers.c>
    Header set Access-Control-Allow-Origin "*"
    Header set Cache-Control "$2"
</IfModule>
EOF
}

declare -A newest
json_versions=""
for tag in $tags; do
  version=${tag#v}
  dir="$out/$tag"
  mkdir -p "$dir"
  git show "$tag:whatsapp-widget.js" > "$dir/whatsapp-widget.js"
  declared=$(grep -oE "const VERSION = '[^']+'" "$dir/whatsapp-widget.js" | cut -d"'" -f2 || true)
  if [ "$declared" != "$version" ]; then
    echo "Tag $tag: whatsapp-widget.js declares VERSION '$declared'." >&2
    exit 1
  fi
  write_htaccess "$dir" "public, max-age=31536000, immutable"
  json_versions+="${json_versions:+,}\"$version\":{\"integrity\":\"$(integrity "$dir/whatsapp-widget.js")\"}"
  newest[${version%%.*}]=$version # tags are sorted, so the last one wins
done

json_majors=""
latest=""
for major in $(printf '%s\n' "${!newest[@]}" | sort -n); do
  version=${newest[$major]}
  mkdir -p "$out/v$major"
  cp "$out/v$version/whatsapp-widget.js" "$out/v$major/whatsapp-widget.js"
  write_htaccess "$out/v$major" "public, max-age=3600"
  json_majors+="${json_majors:+,}\"$major\":\"$version\""
  latest=$version
done

printf '{"latest":%s,"majors":{%s},"versions":{%s}}\n' \
  "$( [ -n "$latest" ] && printf '"%s"' "$latest" || printf 'null' )" \
  "$json_majors" "$json_versions" > "$out/versions.json"

echo "Built site in $out. Releases: $(echo $tags)"
