[![CI](https://github.com/zigtools/release-worker/workflows/CI/badge.svg)](https://github.com/zigtools/release-worker/actions)
[![codecov](https://codecov.io/gh/zigtools/release-worker/graph/badge.svg?token=A3YHEUHMT2)](https://codecov.io/gh/zigtools/release-worker)

A Cloudflare Worker for managing ZLS build artifacts.

# API

The API Endpoint is `releases.zigtools.org`.

## Build Artifacts

Build artifacts that target windows are compressed as `.zip` files. All other targets are available as `.tar.xz` and `.tar.gz`.

All artifacts are signed with [minisign](https://jedisct1.github.io/minisign/) using the following public key:

```
RWR+9B91GBZ0zOjh6Lr17+zKf5BoSuFvrx2xSeDE57uIYvnKBGmMjOex
```

The signature file can be found by appending `.minisig` to the artifact file URI.

## /v1/zls/select-version

Will respond with metadata about a ZLS build that is usable with the given Zig version.
The response body is similar to Zig's [index.json](https://ziglang.org/download/index.json).

### Query Parameters

The `zig_version` query parameter must be the Zig Version that is being used. (e.g. `0.14.0-dev.7+45b62c452`)

The `compatibility` query parameter must be either `only-runtime` or `full`:

- `full`: Request a ZLS build that can be built and used with the given Zig version.
- `only-runtime`: Request a ZLS build that can be used at runtime with the given Zig version but may not be able to build ZLS from source.

<details>
  <summary>Example</summary>
  
  ```bash
  curl "https://releases.zigtools.org/v1/zls/select-version?zig_version=0.14.0-dev.7%2B45b62c452&compatibility=only-runtime" # 0.14.0-dev.7+45b62c452
  ```
  
  ```json
  {
    "version": "0.14.0-dev.263+fa650ca",
    "date": "2024-12-20",
    "x86_64-windows": {
      "tarball": "https://builds.zigtools.org/zls-windows-x86_64-0.14.0-dev.263+fa650ca.zip",
      "shasum": "691c93933e8645e60144e6321d9dbe0288a4c79fbf271d58d1c9026bc802fe50",
      "size": "3916683"
    },
    "x86_64-linux": {
      "tarball": "https://builds.zigtools.org/zls-linux-x86_64-0.14.0-dev.263+fa650ca.tar.xz",
      "shasum": "b7a6ffd27771557c6935ab04cbb9cdd69e2334c0d78730e8fcae83c84d692575",
      "size": "3294836"
    },
    "x86_64-macos": {
      "tarball": "https://builds.zigtools.org/zls-macos-x86_64-0.14.0-dev.263+fa650ca.tar.xz",
      "shasum": "1dd653afd3100bcc60375bfeaa8d02ac668f78048002e512bc0d399dbd107f70",
      "size": "1038884"
    },
    "x86-windows": {
      "tarball": "https://builds.zigtools.org/zls-windows-x86-0.14.0-dev.263+fa650ca.zip",
      "shasum": "4358ad9294edda9d35724c307ae0f6c7e7e5310bbce6aaacce64f4db20174773",
      "size": "3979874"
    },
    "x86-linux": {
      "tarball": "https://builds.zigtools.org/zls-linux-x86-0.14.0-dev.263+fa650ca.tar.xz",
      "shasum": "ac757035b40d605473d933a7c50dd6588f84ffc79158dea9103c172a6ef1fcd9",
      "size": "3285184"
    },
    "aarch64-windows": {
      "tarball": "https://builds.zigtools.org/zls-windows-aarch64-0.14.0-dev.263+fa650ca.zip",
      "shasum": "9365cd7fd7eed5aedef229b3147b3b3cd9e76d363a24ecf2aff91f187a2823f5",
      "size": "3709946"
    },
    "aarch64-linux": {
      "tarball": "https://builds.zigtools.org/zls-linux-aarch64-0.14.0-dev.263+fa650ca.tar.xz",
      "shasum": "bf1a94eba812be4fdc73798677c9513f5d70f68dd5721ca534a1858b6bc79047",
      "size": "3125200"
    },
    "aarch64-macos": {
      "tarball": "https://builds.zigtools.org/zls-macos-aarch64-0.14.0-dev.263+fa650ca.tar.xz",
      "shasum": "11a0552a85c451eb6087e5ebfe7d2d72f751ed5eb10b1b56c7800e96867bc8ea",
      "size": "878672"
    },
    "arm-linux": {
      "tarball": "https://builds.zigtools.org/zls-linux-arm-0.14.0-dev.263+fa650ca.tar.xz",
      "shasum": "52ee5fd67cef696a095650f6cb40689a9a77efabd042bc75943e23a31b2da207",
      "size": "3233876"
    },
    "wasm32-wasi": {
      "tarball": "https://builds.zigtools.org/zls-wasi-wasm32-0.14.0-dev.263+fa650ca.tar.xz",
      "shasum": "d77ab7c6b3f788e2dd658d23c1e6c2c8ed9bb092b69953939dad8848b21c41e5",
      "size": "2217504"
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
  "message": "ZLS 0.30 has not been released yet"
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
  "message": "No builds for the ${ZIG_MAJOR_VERSION}.${ZIG_MINOR_VERSION} release cycle are currently available"
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
  "message": "ZLS ${ZIG_MAJOR_VERSION}.${ZIG_MINOR_VERSION} has not been released yet"
}
```

This error only occurs on tagged releases of Zig.

</details>

## /v1/zls/index.json

> [!CAUTION]
> This request has been moved to [index.json](https://builds.zigtools.org/index.json)

## index.json

The [index.json](https://builds.zigtools.org/index.json) imitates Zig's [index.json](https://ziglang.org/download/index.json) except that there is no field for `master`. Development builds of ZLS should be queried by supplying the Zig version that is being used.

<details>
  <summary>Show Example</summary>
  
  ```bash
  curl "https://builds.zigtools.org/index.json"
  ```
  
  ```json
  {
    "0.14.0": {
      "date": "2025-03-06",
      "aarch64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-aarch64-0.14.0.tar.xz",
        "shasum": "d85f4679af3961db149ead8a355eab4652c3e738eecaad69174cab5f1a1196cc",
        "size": "3369008"
      },
      "aarch64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-aarch64-0.14.0.tar.xz",
        "shasum": "dfb627e1f9603583678f552d8035a12dce878215c0a507b32d6f1b9d074d6c4d",
        "size": "927968"
      },
      "aarch64-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-aarch64-0.14.0.zip",
        "shasum": "7a6d649bafe5d09334b095829b461de1ee7f09278e068b28b90f1566df710a38",
        "size": "4150974"
      },
      "armv7a-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-armv7a-0.14.0.tar.xz",
        "shasum": "34a41ddf6790959b220724957dedd2919f276298277f3e985dc68c7f9b47d3a0",
        "size": "3535916"
      },
      "loongarch64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-loongarch64-0.14.0.tar.xz",
        "shasum": "ce006e31084451a8cdb493965f93f8355485ec4693f54fcba377766ed61597f2",
        "size": "3244668"
      },
      "powerpc64le-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-powerpc64le-0.14.0.tar.xz",
        "shasum": "c5d88b19017d8b9904a03cb088521f5bbd17171214b84bf2e712947f975b5b9f",
        "size": "3548180"
      },
      "riscv64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-riscv64-0.14.0.tar.xz",
        "shasum": "892915a4b06b0503681e45eb45d7bf67a7d7d48daeb73c4ffd0bfb0d59b27a4b",
        "size": "4320460"
      },
      "x86-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86-0.14.0.tar.xz",
        "shasum": "79ca762b6cd5cffc165d473636fe0e1b225d2a4f75e5fed555261be4f046166b",
        "size": "3604608"
      },
      "x86-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86-0.14.0.zip",
        "shasum": "6c2d907830768f69a6296a6794da419597cb08d796243cf81e95452124649252",
        "size": "4564797"
      },
      "x86_64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86_64-0.14.0.tar.xz",
        "shasum": "661f8d402ba3dc9b04b6e9bc3026495be7b838d2f18d148db2bd98bd699c1360",
        "size": "3567628"
      },
      "x86_64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-x86_64-0.14.0.tar.xz",
        "shasum": "baee69e4645deeccb42970b4a01f573592209dc1cf72e32893c59ca06af511dc",
        "size": "1086696"
      },
      "x86_64-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86_64-0.14.0.zip",
        "shasum": "10bb73102bab4d2fa9fd00ef48ad84ff2332b91e7fc449de751676367fe7dfd2",
        "size": "4382699"
      },
      "wasm32-wasi": {
        "tarball": "https://builds.zigtools.org/zls-wasi-wasm32-0.14.0.tar.xz",
        "shasum": "cf9f77982c8d2549603c4361a4653817107974e29811ff7a857ef9230b6ad748",
        "size": "2320208"
      }
    },
    "0.13.0": {
      "date": "2024-06-09",
      "x86_64-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86_64-0.13.0.zip",
        "shasum": "d87ed0834df3c30feae976843f0c6640acd31af1f31c0917907f7bfebae5bd14",
        "size": "3773703"
      },
      "x86_64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86_64-0.13.0.tar.xz",
        "shasum": "ec4c1b45caf88e2bcb9ebb16c670603cc596e4f621b96184dfbe837b39cd8410",
        "size": "3292516"
      },
      "x86_64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-x86_64-0.13.0.tar.xz",
        "shasum": "4b63854d6b76810abd2563706e7d768efc7111e44dd8b371d49198e627697a13",
        "size": "1047656"
      },
      "x86-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86-0.13.0.zip",
        "shasum": "8d71f0fde1238082ee3b7fb5d9e361411183fad2d7a55a78b403ed7cd4fc2d13",
        "size": "3876223"
      },
      "x86-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86-0.13.0.tar.xz",
        "shasum": "9b1632f53528ec29b214286a6056ba1b352737335311926c48317daf1f73f234",
        "size": "3342824"
      },
      "aarch64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-aarch64-0.13.0.tar.xz",
        "shasum": "8e258711168c2e3e7e81d6074663cfe291309b779928aaa4c66aed1affeba1aa",
        "size": "3117620"
      },
      "aarch64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-aarch64-0.13.0.tar.xz",
        "shasum": "9848514524f5e5d33997ac280b7d92388407209d4b8d4be3866dc3cf30ca6ca8",
        "size": "929348"
      },
      "wasm32-wasi": {
        "tarball": "https://builds.zigtools.org/zls-wasi-wasm32-0.13.0.tar.xz",
        "shasum": "ed2af8a5c8661a3eeaa5d498db150c237fe721dd5f48f99ec14833c2b5208493",
        "size": "2231904"
      }
    },
    "0.12.0": {
      "date": "2024-06-08",
      "aarch64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-aarch64-0.12.0.tar.xz",
        "shasum": "ea81ee5c64c8b39aaf23c26d641e263470738d76bee945db9f7207bad10f6d6f",
        "size": "3058360"
      },
      "x86-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86-0.12.0.tar.xz",
        "shasum": "f9ed28d9eb12701b85aafd1956d0d2622086a11761a68561de26677f6410ae6c",
        "size": "3307028"
      },
      "x86_64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86_64-0.12.0.tar.xz",
        "shasum": "a1049798c9d3b14760f24de5c0a6b5a176abd404979828342b7319939563dfaa",
        "size": "3238880"
      },
      "aarch64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-aarch64-0.12.0.tar.xz",
        "shasum": "48892e8e75ebd8cbe1d82548e20094c4c9f7f1b81fdabe18b430f334d93dc76c",
        "size": "912760"
      },
      "x86_64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-x86_64-0.12.0.tar.xz",
        "shasum": "6c6b24d2d57de6fcae8c44d8c484a359262b4a46339fe339a6fade433fc7c6b6",
        "size": "1038668"
      },
      "wasm32-wasi": {
        "tarball": "https://builds.zigtools.org/zls-wasi-wasm32-0.12.0.tar.xz",
        "shasum": "82f9fa4394676c25e4b090253f4bcc811f2cc0186abef6e29e90d908af5c60a8",
        "size": "2235168"
      },
      "x86-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86-0.12.0.zip",
        "shasum": "38bf431c3d8eb484458c77a8b7517a44d1bdbc8e1b85d664f8e8f616d94a92c0",
        "size": "3850972"
      },
      "x86_64-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86_64-0.12.0.zip",
        "shasum": "3ff600660081c1867a83a800d22ad784849d1bee2e18bbe4495b95164e3de136",
        "size": "3697303"
      }
    },
    "0.11.0": {
      "date": "2024-06-08",
      "aarch64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-aarch64-0.11.0.tar.xz",
        "shasum": "43184d2d324b27d2f18b72818676b367e6633264a0f4d74d1249b8a0824d1e1c",
        "size": "2871712"
      },
      "x86-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86-0.11.0.tar.xz",
        "shasum": "580e8de3980778dc77aa0a77fb60efc0c71a17e12987f43379b326fc4c5dcf6c",
        "size": "2954488"
      },
      "x86_64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86_64-0.11.0.tar.xz",
        "shasum": "bd65d0cd79e83395b98035991b100821589b07ed8716fb2a44b1e234c9167f3f",
        "size": "2965448"
      },
      "aarch64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-aarch64-0.11.0.tar.xz",
        "shasum": "5152757727a958e6991b09fee4fb1b89c42b0e1c19f6b866e3567a83a126851c",
        "size": "1605664"
      },
      "x86_64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-x86_64-0.11.0.tar.xz",
        "shasum": "8d3d83c8e1fc7a13d0c58624a9a0bdb289771c3714d01d7aace24277c95e70fb",
        "size": "1746000"
      },
      "wasm32-wasi": {
        "tarball": "https://builds.zigtools.org/zls-wasi-wasm32-0.11.0.tar.xz",
        "shasum": "06e13738a34625fe36dd397dc095c8dd986ba49c214574d5a7d04aa0a5ca669d",
        "size": "2799028"
      },
      "x86-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86-0.11.0.zip",
        "shasum": "8fd720f60de35e59ea3ac465d83fe4c15fd002a3abd5c259abd1cabf30756626",
        "size": "4530355"
      },
      "x86_64-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86_64-0.11.0.zip",
        "shasum": "b14608a9541e89cbe8993ff22a6e3cf6248dd326cc5d42c4ee5469f2933e155b",
        "size": "4186972"
      }
    },
    "0.10.0": {
      "date": "2024-06-08",
      "x86-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86-0.10.0.tar.xz",
        "shasum": "dfc6f2d791b84ff7bd7bfe24e17bc1fed430b6f2db7d8a31735fa19c892334e4",
        "size": "1142116"
      },
      "x86_64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86_64-0.10.0.tar.xz",
        "shasum": "9a6cda8a9dc4b536f76439285541ad197eb30f67b0df47746411043c48091351",
        "size": "1168192"
      },
      "aarch64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-aarch64-0.10.0.tar.xz",
        "shasum": "543c9f7d8895ab12b8c0b860601513c54d354ffd558a439fed9152af74c65ce6",
        "size": "378028"
      },
      "x86_64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-x86_64-0.10.0.tar.xz",
        "shasum": "bebd917db44e8fff8daf5aab9f06dbee183dad1ce351bc6ecb264ccae710d951",
        "size": "486076"
      },
      "x86-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86-0.10.0.zip",
        "shasum": "8b1e20ddf16419d956473830c450dbe6eb3f9022404b65a85bc0707437419405",
        "size": "1645296"
      },
      "x86_64-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86_64-0.10.0.zip",
        "shasum": "f9a29b8e5a743282112c53caa28de7f8534e4c83cf801011263202266fc5ff2e",
        "size": "1582483"
      }
    },
    "0.9.0": {
      "date": "2024-06-08",
      "x86_64-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86_64-0.9.0.tar.xz",
        "shasum": "0bb16e2e3a1c4dab22b1d6b25deeefd2212abcc2e88702a3f58705164703a7f8",
        "size": "1145776"
      },
      "x86-linux": {
        "tarball": "https://builds.zigtools.org/zls-linux-x86-0.9.0.tar.xz",
        "shasum": "4596d0fcf236da331fa3afd9f282ac2492f22469f1b673465035b80850f4bd01",
        "size": "1187788"
      },
      "x86_64-macos": {
        "tarball": "https://builds.zigtools.org/zls-macos-x86_64-0.9.0.tar.xz",
        "shasum": "d8f2e8deda1751d7d46979b686784ebd5c843a9ba8f0bce69424351c4bfbea5f",
        "size": "417592"
      },
      "x86-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86-0.9.0.zip",
        "shasum": "30cdf11c1c4cfe8ec260596dbf80ec498740ecd7fce6a025006176e21a90cd52",
        "size": "1648827"
      },
      "x86_64-windows": {
        "tarball": "https://builds.zigtools.org/zls-windows-x86_64-0.9.0.zip",
        "shasum": "0a99b39124c536fc277208b71c1ddb82a8ba29aa9de1df5a4e824d633420f62e",
        "size": "1627474"
      }
    }
  }
  ```
  
</details>

## /zls/publish

> [!IMPORTANT]
> This request is only intended to be used by ZLS's GitHub CI.

The body is a JSON object with the following fields:

- `zlsVersion`: The ZLS version which must be a semantic version
- `zigVersion`: The Zig version which must be a semantic version
- `minimumBuildZigVersion`: The minimum Zig version that is required to compile and test ZLS
- `minimumRuntimeZigVersion`: The minimum Zig version that is required to run ZLS
- `compatibility`: Describes how compatible the Zig and ZLS version are (valid values: `"none"`, `"only-runtime"`, `"full"`)
- `artifacts`: A `Map<string, { shasum: string; size: number }>`. `shasum` is the sha256 has of the file and `size` is the size of the file in bytes.

The key of `artifacts` is the file name of a release artifact with the following format:

`zls-${OS}-${ARCH}-${ZLS_VERSION}.(tar.xz|tar.gz|zip)` (Example: `zls-linux-x86_64-0.1.0.tar.xz`)

Artifacts that target windows must be `.zip` files. All other non windows targets must include `.tar.xz` **and** `.tar.gz`.

## Development

```bash
# start a local worker
git clone https://github.com/zigtools/release-worker
cd release-worker
npm install
npx wrangler d1 execute staging-db-backend --local --file=./migrations/0000_initial.sql
npm run dev
```

```bash
# Publish a ZLS release (Requires `tar` and `7z`)
git clone https://github.com/zigtools/zls
cd zls
zig build release
ZLS_WORKER_ENDPOINT=http://localhost:8787 zig run .github/workflows/publish_release.zig
```
