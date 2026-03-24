#!/bin/sh
# Ensure mounted volumes are writable by the app user.
# Named volumes are typically owned by root on first use, so we chown them
# here (running as root) before dropping privileges.
chown -R app:app /app/data /app/acme
exec gosu app /app/transcendence-backend "$@"
