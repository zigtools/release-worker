A Cloudflare Worker for managing ZLS build artifacts.

# API

The API Endpoint is `releases.zigtools.org`.

## /v1/zls/select-version?zig_version=${VERSION}&compatibility=${COMPATIBILITY}

Will respond with metadata about a ZLS build that is useable with the given Zig version.
The response body is similar to Zig's [index.json](https://ziglang.org/download/index.json).

The `compatibility` query-string must be either `only-runtime` or `full`:

- `full`: Request a ZLS build that can be built and used with the given Zig version.
- `only-runtime`: Request a ZLS build that can be used at runtime with the given Zig version but may not be able to build ZLS from source.

<details>
  <summary>Example</summary>
  
  ```bash
  curl "https://releases.zigtools.org/v1/zls/select-version?zig_version=0.13.0-dev.7%2B73c6c13a&compatibility=only-runtime" # 0.13.0-dev.7+73c6c13a
  ```
  
  ```json
  {
    "version": "0.12.0",
    "date": "2024-04-26",
    "windows-x86_64": {
      "tarball": "https://builds.zigtools.org/zls-x86_64-windows-0.12.0.zip",
      "shasum": "9656942a98e6d582b8e1d7486d0d3523ee80b0120d4a1d0740e963e45ea88954",
      "size": "3697303"
    },
    "windows-x86": {
      "tarball": "https://builds.zigtools.org/zls-x86-windows-0.12.0.zip",
      "shasum": "4a27fa034f0d2c0f32481eb4b32e198b68115440d501b126463bfa72000c4b38",
      "size": "3850972"
    },
    "linux-x86_64": {
      "tarball": "https://builds.zigtools.org/zls-x86_64-linux-0.12.0.tar.xz",
      "shasum": "3a055bc2ead457d45d71fe16d63166ac9586beea2728ac2af12e0fd8217fbe2e",
      "size": "3241444"
    },
    "macos-x86_64": {
      "tarball": "https://builds.zigtools.org/zls-x86_64-macos-0.12.0.tar.xz",
      "shasum": "6360f923e6e9a68ad317a73bd2990bc3e445c0815ec1c914329a188385660f3a",
      "size": "1038340"
    },
    "linux-x86": {
      "tarball": "https://builds.zigtools.org/zls-x86-linux-0.12.0.tar.xz",
      "shasum": "1d9905c22787242273c6064a76032b8eb9357150c2fd24d1442c70a21f686f39",
      "size": "3308004"
    },
    "linux-aarch64": {
      "tarball": "https://builds.zigtools.org/zls-aarch64-linux-0.12.0.tar.xz",
      "shasum": "9f34884ff22791c2f7c2c7acbe7b9497c4c15321c6ce9c769346b4f4c3d73172",
      "size": "3059812"
    },
    "macos-aarch64": {
      "tarball": "https://builds.zigtools.org/zls-aarch64-macos-0.12.0.tar.xz",
      "shasum": "2e672621bfa671e25a5343b2102cd8a671bebcb7b88c9088d86eecba7bc94bac",
      "size": "913236"
    },
    "wasi-wasm32": {
      "tarball": "https://builds.zigtools.org/zls-wasm32-wasi-0.12.0.tar.xz",
      "shasum": "d81151910728a5b0bd36f0d3f135ad53b6456e5ae26e211ca99fe6156631f93c",
      "size": "2235120"
    }
  }
  ```
  
</details>

### Error Handling

<details>
  <summary> See Here</summary>

The `/v1/zls/select-version` request may be unable to respond with a compatible Zig version.

If the request is valid but cannot be satified, a JSON response with an `code` and `message` field will be send.

```bash
curl "https://releases.zigtools.org/v1/zls/select-version?zig_version=0.30.0&compatibility=full"
```

```json
{
  "code": 1,
  "message": "ZLS 0.30.* does not exist (yet)"
}
```

#### Unsupported

This error _should_ only occur when specifying a very old Zig version like `0.8.0`. Please open an issue when encounting this error on recent Zig versions.

```json
{
  "code": 0,
  "message": "Zig ${ZIG_VERSION} is not supported by ZLS"
}
```

#### Unsupported Release Cycle

The most common scenario for this error is after Zig has tagged a new release but ZLS hasn't updated yet.

Let's say that Zig `0.12.0` has been released but ZLS not yet released ZLS `0.12.0`. ZLS's latest build is therefore a `0.12.0-dev` build.
A request with `?zig_version=0.13.0-dev` will error because there is no ZLS `0.12.*` or ZLS `0.13.0-dev` builds.

Version Order Guide: `0.12.0-dev` < `0.12.0` < `0.13.0-dev` < `0.13.0`

```json
{
  "code": 1,
  "message": "No builds for the ${ZIG_MAJOR_VERSION}.${ZIG_MINOR_VERSION} release cycle are available"
}
```

This error only occurs on development/nightly builds of Zig.

#### Incompatible development build

The version selection algorithm has identified the given Zig version as incompatible with any available ZLS build. When encountering this error on the latest Zig master version, it usually means that a breaking change occured that needs ZLS to be updated.

```json
{
  "code": 2,
  "message": "Zig ${ZIG_VERSION} has no compatible ZLS build (yet)"
}
```

This error only occurs on development/nightly builds of Zig.

#### Incompatible tagged release

```json
{
  "code": 3,
  "message": "ZLS ${ZIG_MAJOR_VERSION}.${ZIG_MINOR_VERSION}.* does not exist (yet)"
}
```

This error only occurs on tagged releases of Zig.

</details>

## /v1/zls/index.json

The response body imitates Zig's [index.json](https://ziglang.org/download/index.json) except that there is no field for `master`. Development builds of ZLS should be queried by supplying the Zig version that is being used.

<details>
  <summary>Show Example</summary>
  
  ```bash
  curl "https://releases.zigtools.org/v1/zls/index.json"
  ```
  
  ```json
  {
    "0.12.0": {
      "date": "2024-04-26",
      "windows-x86_64": {
        "tarball": "https://builds.zigtools.org/zls-x86_64-windows-0.12.0.zip",
        "shasum": "9656942a98e6d582b8e1d7486d0d3523ee80b0120d4a1d0740e963e45ea88954",
        "size": "3697303"
      },
      "windows-x86": {
        "tarball": "https://builds.zigtools.org/zls-x86-windows-0.12.0.zip",
        "shasum": "4a27fa034f0d2c0f32481eb4b32e198b68115440d501b126463bfa72000c4b38",
        "size": "3850972"
      },
      "linux-x86_64": {
        "tarball": "https://builds.zigtools.org/zls-x86_64-linux-0.12.0.tar.xz",
        "shasum": "3a055bc2ead457d45d71fe16d63166ac9586beea2728ac2af12e0fd8217fbe2e",
        "size": "3241444"
      },
      "macos-x86_64": {
        "tarball": "https://builds.zigtools.org/zls-x86_64-macos-0.12.0.tar.xz",
        "shasum": "6360f923e6e9a68ad317a73bd2990bc3e445c0815ec1c914329a188385660f3a",
        "size": "1038340"
      },
      "linux-x86": {
        "tarball": "https://builds.zigtools.org/zls-x86-linux-0.12.0.tar.xz",
        "shasum": "1d9905c22787242273c6064a76032b8eb9357150c2fd24d1442c70a21f686f39",
        "size": "3308004"
      },
      "linux-aarch64": {
        "tarball": "https://builds.zigtools.org/zls-aarch64-linux-0.12.0.tar.xz",
        "shasum": "9f34884ff22791c2f7c2c7acbe7b9497c4c15321c6ce9c769346b4f4c3d73172",
        "size": "3059812"
      },
      "macos-aarch64": {
        "tarball": "https://builds.zigtools.org/zls-aarch64-macos-0.12.0.tar.xz",
        "shasum": "2e672621bfa671e25a5343b2102cd8a671bebcb7b88c9088d86eecba7bc94bac",
        "size": "913236"
      },
      "wasi-wasm32": {
        "tarball": "https://builds.zigtools.org/zls-wasm32-wasi-0.12.0.tar.xz",
        "shasum": "d81151910728a5b0bd36f0d3f135ad53b6456e5ae26e211ca99fe6156631f93c",
        "size": "2235120"
      }
    },
    "0.11.0": {
      "date": "2023-08-13",
      "windows-x86_64": {
        "tarball": "https://builds.zigtools.org/zls-x86_64-windows-0.11.0.zip",
        "shasum": "db9232d0e48adb12b0879fe774c245035bc69749ddd5e9d5271e651871cb05c8",
        "size": "3408276"
      },
      "windows-x86": {
        "tarball": "https://builds.zigtools.org/zls-x86-windows-0.11.0.zip",
        "shasum": "a86e12c17ae9724370a3ec24ddeddc2714ed168c35f1cd57b7d0f44c45f63d8d",
        "size": "3543072"
      },
      "linux-x86_64": {
        "tarball": "https://builds.zigtools.org/zls-x86_64-linux-0.11.0.tar.xz",
        "shasum": "844feab9d7180febdaa4385e32af389bdd5fa816dd475fa8d9187cdb3499b7f7",
        "size": "3443492"
      },
      "macos-x86_64": {
        "tarball": "https://builds.zigtools.org/zls-x86_64-macos-0.11.0.tar.xz",
        "shasum": "0af3e904f8430e05c6cc13d6f5016123f4a1b039d628f75f0aaa87704abf38b8",
        "size": "1026132"
      },
      "linux-x86": {
        "tarball": "https://builds.zigtools.org/zls-x86-linux-0.11.0.tar.xz",
        "shasum": "f9b905932f59ef7a7cdd3ab2b0a8f4a0b08f9465607e6895b3a76861622d3ee3",
        "size": "3397568"
      },
      "linux-aarch64": {
        "tarball": "https://builds.zigtools.org/zls-aarch64-linux-0.11.0.tar.xz",
        "shasum": "ab358ea6fe86ab95e07c6d0e7ec3d8b292617f082509165743f47bc54d6a2eff",
        "size": "3271512"
      },
      "macos-aarch64": {
        "tarball": "https://builds.zigtools.org/zls-aarch64-macos-0.11.0.tar.xz",
        "shasum": "dbc814e86f4b2a83facee1909e7f39541c0b017925ea3bd21903d75d4f5d4b45",
        "size": "864160"
      },
      "wasi-wasm32": {
        "tarball": "https://builds.zigtools.org/zls-wasm32-wasi-0.11.0.tar.xz",
        "shasum": "dbc814e86f4b2a83facee1909e7f39541c0b017925ea3bd21903d75d4f5d4b45",
        "size": "864160"
      }
    },
    "0.10.0": {
      "date": "2022-11-02",
      "windows-x86_64": {
        "tarball": "https://builds.zigtools.org/zls-x86_64-windows-0.10.0.zip",
        "shasum": "384a237d363d058812a2a484123dffbbf90f262365c39f2f22c437d1be471533",
        "size": "1583337"
      },
      "windows-x86": {
        "tarball": "https://builds.zigtools.org/zls-x86-windows-0.10.0.zip",
        "shasum": "614ea61cd656b74f45008f327e3173f23ed61d903ec9de33fe6625f920b6eb6a",
        "size": "1645096"
      },
      "linux-x86_64": {
        "tarball": "https://builds.zigtools.org/zls-x86_64-linux-0.10.0.tar.xz",
        "shasum": "aac793e730cc936b48daff1f3387d60cd074cbc0cdf226e3ff7e2a031d7aa8ed",
        "size": "1168552"
      },
      "macos-x86_64": {
        "tarball": "https://builds.zigtools.org/zls-x86_64-macos-0.10.0.tar.xz",
        "shasum": "b530a24aa284f4a8562744061c02b874eb2544f06366b280e72b2ab0345b0450",
        "size": "485864"
      },
      "linux-x86": {
        "tarball": "https://builds.zigtools.org/zls-x86-linux-0.10.0.tar.xz",
        "shasum": "ee4aba40eb222cb97e49235e38d9803d43e07bdda666420dd389a836b6d1fb52",
        "size": "1143148"
      },
      "linux-aarch64": {
        "tarball": "https://builds.zigtools.org/zls-aarch64-linux-0.10.0.tar.xz",
        "shasum": "9dee6b11c99a713e05412a1a15512facd2bed4e5e780fcefb524b0d4067f8b50",
        "size": "1091384"
      },
      "macos-aarch64": {
        "tarball": "https://builds.zigtools.org/zls-aarch64-macos-0.10.0.tar.xz",
        "shasum": "9a1d0660b53ca67727b5c3298c1b583a803855f6e6c602c3675b2a70e8a8c1c4",
        "size": "378364"
      }
    }
  }
  ```
  
</details>

## /zls/publish

> [!IMPORTANT]
> This request is only intended to be used by ZLS's GitHub CI.

The body is a `multipart/form-data` with the following key value pairs:

- `zls-version`: The ZLS version which must be a semantic version
- `zig-version`: The Zig version which must be a semantic version
- `minimum-build-zig-version`: The minimum Zig version that is required to compile and test ZLS
- `minimum-runtime-zig-version`: The minimum Zig version that is required to run ZLS
- `compatibility`: Describes how compatible the Zig and ZLS version are (valid values: `"none"`, `"only-runtime"`, `"full"`)

All other fields are interpreted as release artifacts. The key must have the following format:

`zls-${OS}-${ARCH}-${ZLS_VERSION}.(tar.xz|tar.gz|zip)` (Example: `zls-linux-x86_64-0.1.0.tar.xz`)

Artifacts that target windows must be `.zip` files. All other non windows targets must include `.tar.xz` **and** `.tar.gz`.

Release artifacts can also be signed with [minisign](https://jedisct1.github.io/minisign/) by publishing an additional `.minisig` file for every artifact. (Example: `zls-linux-x86_64-0.1.0.tar.xz.minisig`)

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
ZLS_WORKER_ENDPOINT=http://localhost:8787 zig build publish --summary all
```
