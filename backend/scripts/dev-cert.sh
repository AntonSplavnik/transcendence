#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
  backend/scripts/dev-cert.sh [--install-deps] [--force]

Generates a locally-trusted TLS certificate for WebTransport/HTTP3 development.

- Installs a local mkcert CA into your trust stores (mkcert -install)
- Generates certs for: localhost, 127.0.0.1, ::1
- Writes:
    backend/certs/cert.pem
    backend/certs/key.pem

Options:
  --install-deps   Attempt to install mkcert + NSS tools via your system package manager
  --force          Overwrite existing cert/key without prompting
EOF
}

INSTALL_DEPS=0
FORCE=0

for arg in "$@"; do
	case "$arg" in
		--install-deps) INSTALL_DEPS=1 ;;
		--force) FORCE=1 ;;
		-h|--help) usage; exit 0 ;;
		*) echo "Unknown argument: $arg"; echo; usage; exit 2 ;;
	esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CERT_DIR="$BACKEND_DIR/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

if [[ -f "$CERT_FILE" || -f "$KEY_FILE" ]]; then
	if [[ $FORCE -ne 1 ]]; then
		echo "Refusing to overwrite existing certs:" >&2
		[[ -f "$CERT_FILE" ]] && echo "  $CERT_FILE" >&2
		[[ -f "$KEY_FILE" ]] && echo "  $KEY_FILE" >&2
		echo "Re-run with --force to overwrite." >&2
		exit 1
	fi
fi

install_deps_linux() {
	if command -v apt-get >/dev/null 2>&1; then
		sudo apt-get update
		sudo apt-get install -y mkcert libnss3-tools ca-certificates
		return
	fi
	if command -v dnf >/dev/null 2>&1; then
		sudo dnf install -y mkcert nss-tools ca-certificates
		return
	fi
	if command -v pacman >/dev/null 2>&1; then
		sudo pacman -Sy --noconfirm mkcert nss ca-certificates
		return
	fi
	if command -v zypper >/dev/null 2>&1; then
		sudo zypper install -y mkcert mozilla-nss-tools ca-certificates
		return
	fi
	echo "No supported package manager found. Please install mkcert manually:" >&2
	echo "  https://github.com/FiloSottile/mkcert" >&2
	exit 1
}

if ! command -v mkcert >/dev/null 2>&1; then
	if [[ $INSTALL_DEPS -eq 1 ]]; then
		install_deps_linux
	else
		echo "mkcert is not installed." >&2
		echo "Install it, or re-run with --install-deps." >&2
		exit 1
	fi
fi

mkdir -p "$CERT_DIR"

# Install a local CA into system/browser trust stores.
# On Linux this may require NSS tools (libnss3-tools / certutil).
mkcert -install

if ! command -v certutil >/dev/null 2>&1; then
	echo >&2
	echo "Warning: 'certutil' (NSS tools) is not installed." >&2
	echo "Chromium-based browsers often rely on an NSS DB for trust, and QUIC/WebTransport" >&2
	echo "may still fail with CERTIFICATE_VERIFY_FAILED even if HTTPS looks fine." >&2
	echo "Install NSS tools (e.g. 'libnss3-tools') or rerun with --install-deps." >&2
fi

install_ca_into_nssdb() {
	local nssdb_dir="$1"
	local ca_pem="$2"
	local nick="mkcert dev CA"

	# Skip directories without an NSS DB.
	if [[ ! -f "$nssdb_dir/cert9.db" && ! -f "$nssdb_dir/cert8.db" ]]; then
		return 0
	fi

	# If already present, do nothing.
	if certutil -d "sql:$nssdb_dir" -L -n "$nick" >/dev/null 2>&1; then
		return 0
	fi

	# Add as a trusted CA for SSL/TLS websites.
	certutil -d "sql:$nssdb_dir" -A -n "$nick" -t "C,," -i "$ca_pem" 2>/dev/null || true
}

install_ca_into_firefox_profiles() {
	local ca_pem="$1"
	local profiles_ini="$2"
	local base_dir="$3"

	[[ -f "$profiles_ini" ]] || return 0

	# Parse Path / IsRelative pairs from profiles.ini (INI format).
	# We only care about profile directories.
	local path=""
	local is_relative="1"
	while IFS= read -r line; do
		case "$line" in
			Path=*)
				path="${line#Path=}"
				;;
			IsRelative=*)
				is_relative="${line#IsRelative=}"
				;;
			"" )
				# Profile section boundary: process if we have a path.
				if [[ -n "$path" ]]; then
					local profile_dir
					if [[ "$is_relative" == "1" ]]; then
						profile_dir="$base_dir/$path"
					else
						profile_dir="$path"
					fi
					install_ca_into_nssdb "$profile_dir" "$ca_pem"
					path=""
					is_relative="1"
				fi
				;;
		esac
	done < "$profiles_ini"

	# Handle last profile section (file might not end with blank line).
	if [[ -n "$path" ]]; then
		local profile_dir
		if [[ "$is_relative" == "1" ]]; then
			profile_dir="$base_dir/$path"
		else
			profile_dir="$path"
		fi
		install_ca_into_nssdb "$profile_dir" "$ca_pem"
	fi
}

# Some sandboxed browser packages (notably Chromium Snap) use a separate NSS DB
# that mkcert doesn't always discover. If present, install the mkcert root CA
# into that DB as well so QUIC/WebTransport trust checks succeed.
if command -v certutil >/dev/null 2>&1; then
	CAROOT="$(mkcert -CAROOT)"
	ROOT_CA_PEM="$CAROOT/rootCA.pem"
	if [[ -f "$ROOT_CA_PEM" ]]; then
		# Standard NSS DB used by many Chromium/Chrome builds on Linux.
		STD_NSSDB="$HOME/.pki/nssdb"
		if [[ -d "$STD_NSSDB" ]]; then
			install_ca_into_nssdb "$STD_NSSDB" "$ROOT_CA_PEM"
		fi

		# Firefox uses per-profile NSS DBs (cert9.db/cert8.db).
		# Install into classic and sandboxed (Flatpak/Snap) profile locations when present.
		install_ca_into_firefox_profiles "$ROOT_CA_PEM" "$HOME/.mozilla/firefox/profiles.ini" "$HOME/.mozilla/firefox"
		install_ca_into_firefox_profiles "$ROOT_CA_PEM" "$HOME/.var/app/org.mozilla.firefox/.mozilla/firefox/profiles.ini" "$HOME/.var/app/org.mozilla.firefox/.mozilla/firefox"
		install_ca_into_firefox_profiles "$ROOT_CA_PEM" "$HOME/snap/firefox/common/.mozilla/firefox/profiles.ini" "$HOME/snap/firefox/common/.mozilla/firefox"

		for NSSDB in \
			"$HOME/snap/chromium/current/.pki/nssdb" \
			"$HOME/snap/chromium/common/.pki/nssdb"; do
			if [[ -d "$NSSDB" ]]; then
				install_ca_into_nssdb "$NSSDB" "$ROOT_CA_PEM"
			fi
		done
	fi
fi

# Generate a cert valid for local development hosts.
mkcert \
	-cert-file "$CERT_FILE" \
	-key-file "$KEY_FILE" \
	localhost 127.0.0.1 ::1

echo
echo "Wrote:"
echo "  $CERT_FILE"
echo "  $KEY_FILE"

echo
echo "Next steps:"
echo "  1) Restart the backend (it reads backend/config.toml tls.cert/key)"
echo "  2) Open https://127.0.0.1:8443/ (or your chosen host)"
echo "  3) WebTransport should no longer fail with CERTIFICATE_VERIFY_FAILED"
