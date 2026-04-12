#!/bin/sh
# Ensure mounted volumes are writable by the app user.
# Named volumes are typically owned by root on first use, so we chown them
# here (running as root) before dropping privileges.
chown -R app:app /app/data /app/acme

# In some rootless + network filesystem setups, bind-mounted files can be
# readable by root but not by the non-root app user even with mode 0644.
# Prefer least privilege, but fall back to root so local dev can still start.
if gosu app test -r /app/config.toml \
	&& gosu app test -r /run/secrets/tls_cert \
	&& gosu app test -r /run/secrets/tls_key; then
	exec gosu app /app/transcendence-backend "$@"
fi

echo "warning: app user cannot read mounted config/secrets; starting as root" >&2
exec /app/transcendence-backend "$@"
