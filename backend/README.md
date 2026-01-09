# Getting Started

```shell
# Run the project
cargo run
# Run tests
cargo test
```

## Local TLS certs (WebTransport / HTTP3)

Browsers require a trusted TLS certificate for QUIC/WebTransport. If you see errors like
`QUIC_TLS_CERTIFICATE_UNKNOWN` / `CERTIFICATE_VERIFY_FAILED`, generate a locally-trusted
development certificate:

```shell
./scripts/dev-cert.sh --install-deps --force
```

This writes `./certs/cert.pem` and `./certs/key.pem` (matching `config.toml`), then you can restart the backend.

If HTTPS loads but WebTransport/HTTP3 still fails with `CERTIFICATE_VERIFY_FAILED`, you are likely using a sandboxed Chromium (e.g. Snap) that has its own certificate store. Re-run the script after installing NSS tools (`libnss3-tools`) so it can import the mkcert root CA into the browser store.

## diesel database orm doc/guide

You chose diesel, please check the documentation here <https://diesel.rs/guides/>

## diesel_cli

```shell
# TODO
```

<https://diesel.rs/guides/configuring-diesel-cli.html>

## Database initialization

- Please set the database connection string in .env
- Make sure the database exists, then run `diesel migration run`
- For more diesel-cli functions, please check /migration/README.md.

## About Salvo

You can view the salvo documentation and more examples at <https://salvo.rs/>.

## Authentication

- ../docs/backend-auth.md
