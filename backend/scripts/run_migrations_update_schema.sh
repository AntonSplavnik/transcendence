#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(git -C "${BACKEND_DIR}" rev-parse --show-toplevel)"
REPO_PREFIX="$(git -C "${BACKEND_DIR}" rev-parse --show-prefix)"

SCHEMA_REL="src/schema.rs"
PATCH_REL="src/schema.patch"
SCHEMA_PATH="${BACKEND_DIR}/${SCHEMA_REL}"
PATCH_PATH="${BACKEND_DIR}/${PATCH_REL}"
REPO_SCHEMA_REL="${REPO_PREFIX}${SCHEMA_REL}"

if ! command -v diesel >/dev/null 2>&1; then
    echo "Error: diesel CLI not found in PATH." >&2
    exit 1
fi

if ! command -v git >/dev/null 2>&1; then
    echo "Error: git not found in PATH." >&2
    exit 1
fi

TMP_DIR="$(mktemp -d)"
BASE_SCHEMA="${TMP_DIR}/schema.base.rs"
NEW_PATCH="${TMP_DIR}/schema.new.patch"
TMP_INDEX="${TMP_DIR}/index"

cleanup() {
    rm -rf "${TMP_DIR}"
}

trap cleanup EXIT

pushd "${BACKEND_DIR}" >/dev/null

: > "${PATCH_PATH}"

run_migrations() {
    diesel migration revert --all && diesel migration run
}

if ! run_migrations; then
    echo "Migration sequence failed. Resetting database and retrying once..." >&2
    rm -f "${BACKEND_DIR}/data/diesel.sqlite" "${BACKEND_DIR}/data/diesel.sqlite-shm" "${BACKEND_DIR}/data/diesel.sqlite-wal"
    if ! diesel database reset; then
        echo "Error: database reset failed; aborting with empty ${PATCH_REL}." >&2
        exit 1
    fi
fi

cp "${SCHEMA_PATH}" "${BASE_SCHEMA}"

perl -0pi -e 's/\bTimestamp\b/TimestamptzSqlite/g' "${SCHEMA_PATH}"

BASE_BLOB="$(git hash-object -w "${BASE_SCHEMA}")"

GIT_INDEX_FILE="${TMP_INDEX}" git -C "${REPO_ROOT}" read-tree --empty
GIT_INDEX_FILE="${TMP_INDEX}" git -C "${REPO_ROOT}" update-index \
    --add \
    --cacheinfo 100644,"${BASE_BLOB}","${REPO_SCHEMA_REL}"

set +e
GIT_INDEX_FILE="${TMP_INDEX}" git -C "${REPO_ROOT}" diff -U6 -- "${REPO_SCHEMA_REL}" > "${NEW_PATCH}"
DIFF_STATUS=$?
set -e

if [[ ${DIFF_STATUS} -gt 1 ]]; then
    echo "Error: failed to generate ${PATCH_REL} diff." >&2
    exit 1
fi

mkdir -p "$(dirname -- "${PATCH_PATH}")"
cp "${NEW_PATCH}" "${PATCH_PATH}"

if [[ ! -s "${PATCH_PATH}" ]]; then
    echo "No schema changes needed; wrote empty ${PATCH_REL}."
else
    echo "Updated ${PATCH_REL} from current ${SCHEMA_REL}."
fi

popd >/dev/null
