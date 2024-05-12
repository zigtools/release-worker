A Cloudflare Worker for managing ZLS build artifacts.

# API

The API Endpoint is `releases.zigtools.org`.

## /v1/select-zls-version?zig_version=${VERSION}

> [!IMPORTANT]
> If you are developing a tool that automatically installs ZLS then you came to the right place!

Will respond with metadata about a ZLS build that is compatible with the given Zig version.
The response body is similar to Zig's [index.json](https://ziglang.org/download/index.json).

### Example

```bash
curl "https://releases.zigtools.org/v1/select-zls-version?zig_version=0.12.0"
>>> TODO
```

```bash
curl "https://releases.zigtools.org/v1/select-zls-version?zig_version=0.13.0-dev.7%2B73c6c13a" # 0.13.0-dev.7+73c6c13a
>>> TODO
```

```bash
curl "https://releases.zigtools.org/v1/select-zls-version?zig_version=1.0.0"
>>> null
```

## /v1/select-zls-version

The response body imitates Zig's [index.json](https://ziglang.org/download/index.json) except that there is no field for `master`. Development builds of ZLS should be queried by supplying the Zig version that is being used.

### Example

```bash
curl "https://releases.zigtools.org/v1/select-zls-version"
>>> TODO
```

## /v1/publish

> [!IMPORTANT]
> This request is only intended to be used by ZLS's GitHub CI.

The body is a `multipart/form-data` with the following key value pairs:

- `zls-version`: The ZLS version which must be a semantic version
- `zig-version`: The Zig version which must be a semantic version
- `minimum-build-zig-version`: The minimum Zig version that is required to compile and test ZLS:
- `minimum-runtime-zig-version`: The minimum Zig version that is required to run ZLS:

All other fields are interpreted as release artifacts. The key must have the following format:

`zls-${OS}-${ARCH}-${ZLS_VERSION}.(tar.xz|zip)` (Example: `zls-linux-x86_64-0.1.0.tar.xz`)

Release artifacts can also be signed with [minisign](https://jedisct1.github.io/minisign/) by publishing an additional `.minisign` file for every artifact. (Example: `zls-linux-x86_64-0.1.0.tar.xz.minisign`)

## Development

```bash
# start a local worker
git clone https://github.com/zigtools/release-worker
cd release-worker
npm install
npx wrangler d1 execute production-db-backend --local --file=./migrations/0000_initial.sql
npm run dev
```

```bash
# Publish a ZLS release (Requires `tar` and `7z`)
git clone https://github.com/zigtools/zls
cd zls
ZLS_WORKER_ENDPOINT=http://localhost:8787 zig build release -Drelease-publish=success --summary all
```
