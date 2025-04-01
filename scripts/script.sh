#!/bin/sh

INPUT_JSON="$1"
ROOT_DIR="$2"

# Step 1: Extract paths from file_map values only
TMP_PATHS=$(mktemp)
jq -r '.file_map | to_entries[] | .value.path' "$INPUT_JSON" > "$TMP_PATHS"
echo "Extracted paths:"
cat "$TMP_PATHS"
# Step 2: Compute the common prefix from these paths
common_prefix=""
first=1
while IFS= read -r path; do
  if [ "$first" -eq 1 ]; then
    common_prefix="$path"
    first=0
  else
    # Reduce common_prefix until it is a prefix of the current path
    while [ "${path#$common_prefix}" = "$path" ] && [ -n "$common_prefix" ]; do
      common_prefix="${common_prefix%/*}"
    done
  fi
done < "$TMP_PATHS"

echo "Common prefix: $common_prefix"

# Step 3: Process each file_map entry: compute its relative path and write the source content.
jq -r --arg prefix "$common_prefix/" '
  .file_map | to_entries[] |
  { rel_path: (.value.path | sub("^" + $prefix; "")), source: .value.source } | @base64
' "$INPUT_JSON" | while IFS= read -r encoded; do
  # Decode the JSON object from base64
  json=$(echo "$encoded" | base64 --decode)
  rel_path=$(echo "$json" | jq -r '.rel_path')
  source=$(echo "$json" | jq -r '.source')
  full_output_path="$ROOT_DIR/$rel_path"

  mkdir -p "$(dirname "$full_output_path")"
  echo "$source" > "$full_output_path"
  echo "Created: $full_output_path"
done

rm "$TMP_PATHS"
