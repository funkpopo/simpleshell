#!/usr/bin/env sh
set -eu

REPO="${SIMPLESHELL_REPO:-funkpopo/simpleshell}"
VERSION="${SIMPLESHELL_VERSION:-latest}"
API_BASE="${GITHUB_API_URL:-https://api.github.com}"
TMP_DIR=""

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'SimpleShell install error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT INT TERM

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

sudo_cmd() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  command -v sudo >/dev/null 2>&1 || fail "sudo is required when not running as root"
  sudo "$@"
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64)
      printf '%s\n' "x64 amd64 x86_64"
      ;;
    aarch64 | arm64)
      printf '%s\n' "arm64 aarch64"
      ;;
    *)
      fail "unsupported CPU architecture: $(uname -m)"
      ;;
  esac
}

detect_package_type() {
  if command -v apt-get >/dev/null 2>&1 || command -v dpkg >/dev/null 2>&1; then
    printf '%s\n' "deb"
    return
  fi

  if command -v dnf >/dev/null 2>&1 ||
    command -v yum >/dev/null 2>&1 ||
    command -v zypper >/dev/null 2>&1 ||
    command -v rpm >/dev/null 2>&1; then
    printf '%s\n' "rpm"
    return
  fi

  fail "unsupported Linux distribution: apt/dpkg or rpm/dnf/yum/zypper is required"
}

release_api_url() {
  if [ "$VERSION" = "latest" ]; then
    printf '%s/repos/%s/releases/latest\n' "$API_BASE" "$REPO"
  else
    case "$VERSION" in
      v*) tag="$VERSION" ;;
      *) tag="v$VERSION" ;;
    esac
    printf '%s/repos/%s/releases/tags/%s\n' "$API_BASE" "$REPO" "$tag"
  fi
}

github_api_get() {
  url="$1"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      "$url"
  else
    curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      "$url"
  fi
}

asset_urls_from_release() {
  sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

pick_asset_url() {
  package_type="$1"
  arch_tokens="$2"
  release_json="$3"

  candidates=$(printf '%s\n' "$release_json" | asset_urls_from_release | grep -Ei "\.${package_type}($|\?)" || true)
  [ -n "$candidates" ] || fail "no .$package_type asset found in GitHub release"

  for token in $arch_tokens; do
    match=$(printf '%s\n' "$candidates" | grep -Ei "(^|[-_.])${token}([-_.]|\.|$)" | head -n 1 || true)
    if [ -n "$match" ]; then
      printf '%s\n' "$match"
      return
    fi
  done

  count=$(printf '%s\n' "$candidates" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')
  if [ "$count" = "1" ]; then
    printf '%s\n' "$candidates"
    return
  fi

  fail "multiple .$package_type assets found, but none match architecture tokens: $arch_tokens"
}

download_asset() {
  url="$1"
  dest="$2"

  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fL \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -o "$dest" \
      "$url"
  else
    curl -fL -o "$dest" "$url"
  fi
}

install_deb() {
  file="$1"

  if command -v apt-get >/dev/null 2>&1; then
    sudo_cmd apt-get update
    sudo_cmd apt-get install -y "$file"
    return
  fi

  sudo_cmd dpkg -i "$file" || {
    sudo_cmd apt-get install -f -y
    sudo_cmd dpkg -i "$file"
  }
}

install_rpm() {
  file="$1"

  if command -v dnf >/dev/null 2>&1; then
    sudo_cmd dnf install -y "$file"
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    sudo_cmd yum install -y "$file"
    return
  fi

  if command -v zypper >/dev/null 2>&1; then
    sudo_cmd zypper --non-interactive install "$file"
    return
  fi

  sudo_cmd rpm -Uvh "$file"
}

main() {
  need_command curl
  need_command uname
  need_command sed
  need_command grep
  need_command mktemp

  package_type=$(detect_package_type)
  arch_tokens=$(detect_arch)
  api_url=$(release_api_url)

  log "Fetching SimpleShell release metadata from $api_url"
  release_json=$(github_api_get "$api_url") || fail "failed to fetch GitHub release metadata"
  asset_url=$(pick_asset_url "$package_type" "$arch_tokens" "$release_json")

  TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/simpleshell-install.XXXXXX")
  package_file="$TMP_DIR/$(basename "$asset_url" | sed 's/[?].*$//')"

  log "Downloading $asset_url"
  download_asset "$asset_url" "$package_file" || fail "failed to download release asset"

  log "Installing $package_file"
  case "$package_type" in
    deb) install_deb "$package_file" ;;
    rpm) install_rpm "$package_file" ;;
    *) fail "unsupported package type: $package_type" ;;
  esac

  log "SimpleShell installed. Start it with: simpleshell"
}

main "$@"
