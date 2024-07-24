import { env, SELF } from "cloudflare:test";
import assert from "node:assert";
import { describe, test, expect, beforeEach } from "vitest";
import {
  D2JsonData,
  ReleaseArtifact,
  SQLiteQueryPlanRow,
  VersionCompatibility,
} from "../src/shared";
import {
  handleSelectZLSVersion,
  SelectZLSVersionWithoutVersionResponse,
  SelectZLSVersionWithVersionResponse,
} from "../src/select-zls-version";
import { SemanticVersion } from "../src/semantic-version";

const defaultArtifacts: ReleaseArtifact[] = [
  {
    arch: "x86_64",
    os: "linux",
    version: "0.11.0",
    extension: "tar.xz",
    fileShasum: "aaa",
    fileSize: 12,
  },
  {
    arch: "x86_64",
    os: "linux",
    version: "0.11.0",
    extension: "tar.gz",
    fileShasum: "bbb",
    fileSize: 12,
  },
  {
    arch: "aarch64",
    os: "windows",
    version: "0.11.0",
    extension: "zip",
    fileShasum: "ccc",
    fileSize: 12,
  },
];

const samples: D2JsonData[] = [
  {
    date: 0,
    zlsVersion: "0.9.0-dev.3+aaaaaaaaa",
    zigVersion: "0.9.0-dev.20+aaaaaaaaa",
    minimumBuildZigVersion: "0.9.0-dev.25+aaaaaaaaa",
    minimumRuntimeZigVersion: "0.9.0-dev.15+aaaaaaaaa",
    minisign: false,
    artifacts: defaultArtifacts,
    testedZigVersions: {
      "0.9.0-dev.20+aaaaaaaaa": VersionCompatibility.Full,
      "0.9.0-dev.25+aaaaaaaaa": VersionCompatibility.Full,
      "0.9.0-dev.30+aaaaaaaaa": VersionCompatibility.OnlyRuntime,
    },
  },
  {
    date: 0,
    zlsVersion: "0.11.0",
    zigVersion: "0.11.0",
    minimumBuildZigVersion: "0.11.0",
    minimumRuntimeZigVersion: "0.11.0",
    minisign: false,
    artifacts: defaultArtifacts,
    testedZigVersions: { "0.11.0": VersionCompatibility.Full },
  },
  {
    date: 0,
    zlsVersion: "0.12.0-dev.1+aaaaaaaaa",
    zigVersion: "0.11.0",
    minimumBuildZigVersion: "0.11.0",
    minimumRuntimeZigVersion: "0.11.0",
    minisign: false,
    artifacts: defaultArtifacts,
    testedZigVersions: {
      "0.11.0": VersionCompatibility.Full,
      "0.12.0-dev.2+aaaaaaaaa": VersionCompatibility.Full,
      "0.12.0-dev.3+aaaaaaaaa": VersionCompatibility.Full,
      "0.12.0-dev.5+aaaaaaaaa": VersionCompatibility.Full,
      "0.12.0-dev.7+aaaaaaaaa": VersionCompatibility.None,
    },
  },
  {
    date: 0,
    zlsVersion: "0.12.0-dev.2+aaaaaaaaa",
    zigVersion: "0.12.0-dev.7+aaaaaaaaa",
    minimumBuildZigVersion: "0.11.0",
    minimumRuntimeZigVersion: "0.12.0-dev.7+aaaaaaaaa",
    minisign: false,
    artifacts: defaultArtifacts,
    testedZigVersions: {
      "0.12.0-dev.7+aaaaaaaaa": VersionCompatibility.Full,
      "0.12.0-dev.8+aaaaaaaaa": VersionCompatibility.Full,
      "0.12.0-dev.9+aaaaaaaaa": VersionCompatibility.None,
      "0.12.0-dev.11+aaaaaaaaa": VersionCompatibility.None,
    },
  },
  {
    date: 0,
    zlsVersion: "0.12.0-dev.3+aaaaaaaaa",
    zigVersion: "0.12.0-dev.17+aaaaaaaaa",
    minimumBuildZigVersion: "0.11.0",
    minimumRuntimeZigVersion: "0.12.0-dev.14+aaaaaaaaa",
    minisign: false,
    artifacts: defaultArtifacts,
    testedZigVersions: {
      "0.12.0-dev.17+aaaaaaaaa": VersionCompatibility.Full,
    },
  },
  {
    date: 0,
    zlsVersion: "0.12.0",
    zigVersion: "0.12.0",
    minimumBuildZigVersion: "0.12.0",
    minimumRuntimeZigVersion: "0.12.0",
    minisign: false,
    artifacts: defaultArtifacts,
    testedZigVersions: {
      "0.12.0": VersionCompatibility.Full,
      "0.12.1": VersionCompatibility.Full,
      "0.12.2": VersionCompatibility.Full,
    },
  },
  {
    date: 0,
    zlsVersion: "0.12.1",
    zigVersion: "0.12.0",
    minimumBuildZigVersion: "0.12.0",
    minimumRuntimeZigVersion: "0.12.0",
    minisign: false,
    artifacts: defaultArtifacts,
    testedZigVersions: { "0.12.0": VersionCompatibility.Full },
  },
  {
    date: 0,
    zlsVersion: "0.13.0",
    zigVersion: "0.13.0",
    minimumBuildZigVersion: "0.13.0",
    minimumRuntimeZigVersion: "0.13.0",
    minisign: false,
    artifacts: defaultArtifacts,
    testedZigVersions: {
      "0.13.0": VersionCompatibility.Full,
      "0.14.0-dev.2+aaaaaaaaa": VersionCompatibility.Full,
      "0.14.0-dev.4+aaaaaaaaa": VersionCompatibility.None,
    },
  },
];

async function selectZLSVersion(
  zigVersion: string,
  compatibility: VersionCompatibility,
): Promise<SelectZLSVersionWithVersionResponse> {
  assert(compatibility != VersionCompatibility.None);
  const url = new URL("https://example.com/v1/select-zls-version");
  url.searchParams.set("zig_version", zigVersion);
  url.searchParams.set("compatibility", compatibility);

  const response = await SELF.fetch(url);
  expect(response.status).toBe(200);
  return await response.json();
}

function shuffleArray(array: unknown[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

describe("/v1/select-zls-version", () => {
  test("method should be 'GET'", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/select-zls-version",
      {
        method: "POST",
      },
    );
    expect(await response.text()).toBe("method must be 'GET'");
    expect(response.status).toBe(405);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(response.headers.has("Access-Control-Allow-Methods")).toBe(false);
  });

  test.each<unknown>([null, "", {}, []])(
    "check for invalid R2_PUBLIC_URL: %j",
    async (value) => {
      const response = await handleSelectZLSVersion(
        new Request("https://example.com/v1/select-zls-version"),
        {
          API_TOKEN: env.API_TOKEN,
          R2_PUBLIC_URL: value as string,
          ZIGTOOLS_BUILDS: env.ZIGTOOLS_BUILDS,
          ZIGTOOLS_DB: env.ZIGTOOLS_DB,
        },
      );
      expect(response.status).toBe(500);
    },
  );

  test("invalid zig version", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/select-zls-version?zig_version=foo",
    );
    expect(await response.text()).toBe(
      "Query component 'zig_version' with value 'foo' is not a valid version!",
    );
    expect(response.status).toBe(400);
  });

  test("missing compatibility query", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/select-zls-version?zig_version=0.11.0",
    );
    expect(await response.text()).toBe(
      "Expected query component 'compatibility'!",
    );
    expect(response.status).toBe(400);
  });

  test.each<string>(["", "foo", "none", "None", "OnlyRuntime", "Full"])(
    "invalid compatibility string: '%s'",
    async (compatibility) => {
      const response = await SELF.fetch(
        `https://example.com/v1/select-zls-version?zig_version=0.11.0&compatibility=${compatibility}`,
      );
      expect(await response.text()).toBe(
        `form item 'compatibility' with value '${compatibility}' must be one of ["only-runtime","full"]!`,
      );
      expect(response.status).toBe(400);
    },
  );

  test("search on empty database", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/select-zls-version",
    );
    expect(await response.json()).toStrictEqual({});
    expect(response.status).toBe(200);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(true);
    expect(response.headers.has("Access-Control-Allow-Methods")).toBe(true);
  });

  test("search on empty database with Zig version", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/select-zls-version?zig_version=0.11.0&compatibility=full",
    );
    expect(await response.json()).toStrictEqual({
      error: "ZLS 0.11.* does not exist!",
    });
    expect(response.status).toBe(200);
  });

  describe("test on sample database", () => {
    beforeEach(async () => {
      shuffleArray(samples);
      const statements = samples.map((sample) => {
        const zlsVersion = SemanticVersion.parse(sample.zlsVersion);
        assert(zlsVersion !== null);

        return env.ZIGTOOLS_DB.prepare(
          "INSERT INTO ZLSReleases VALUES (?1, ?2, ?3, ?4, ?5, ?6, json(?7))",
        ).bind(
          sample.zlsVersion satisfies string,
          zlsVersion.major satisfies number,
          zlsVersion.minor satisfies number,
          zlsVersion.patch satisfies number,
          (zlsVersion.commitHeight ?? null) satisfies number | null,
          zlsVersion.isRelease satisfies boolean,
          JSON.stringify(sample satisfies D2JsonData),
        );
      });
      await env.ZIGTOOLS_DB.batch(statements);
    });

    test("search without version", async () => {
      const response = await SELF.fetch(
        "https://example.com/v1/select-zls-version",
      );
      const body =
        await response.json<SelectZLSVersionWithoutVersionResponse>();

      expect(Object.keys(body)).toStrictEqual([
        "0.13.0",
        "0.12.1",
        "0.12.0",
        "0.11.0",
      ]);
      expect(body).toStrictEqual({
        "0.11.0": {
          date: "1970-01-01",
          "x86_64-linux": {
            tarball: `${env.R2_PUBLIC_URL}/zls-linux-x86_64-0.11.0.tar.xz`,
            shasum: "aaa",
            size: "12",
          },
          "aarch64-windows": {
            tarball: `${env.R2_PUBLIC_URL}/zls-windows-aarch64-0.11.0.zip`,
            shasum: "ccc",
            size: "12",
          },
        },
        "0.12.0": {
          date: "1970-01-01",
          "x86_64-linux": {
            tarball: `${env.R2_PUBLIC_URL}/zls-linux-x86_64-0.11.0.tar.xz`,
            shasum: "aaa",
            size: "12",
          },
          "aarch64-windows": {
            tarball: `${env.R2_PUBLIC_URL}/zls-windows-aarch64-0.11.0.zip`,
            shasum: "ccc",
            size: "12",
          },
        },
        "0.12.1": {
          date: "1970-01-01",
          "x86_64-linux": {
            tarball: `${env.R2_PUBLIC_URL}/zls-linux-x86_64-0.11.0.tar.xz`,
            shasum: "aaa",
            size: "12",
          },
          "aarch64-windows": {
            tarball: `${env.R2_PUBLIC_URL}/zls-windows-aarch64-0.11.0.zip`,
            shasum: "ccc",
            size: "12",
          },
        },
        "0.13.0": {
          date: "1970-01-01",
          "x86_64-linux": {
            tarball: `${env.R2_PUBLIC_URL}/zls-linux-x86_64-0.11.0.tar.xz`,
            shasum: "aaa",
            size: "12",
          },
          "aarch64-windows": {
            tarball: `${env.R2_PUBLIC_URL}/zls-windows-aarch64-0.11.0.zip`,
            shasum: "ccc",
            size: "12",
          },
        },
      });
      expect(response.status).toBe(200);
    });

    test("search for with Version 0.11.0", async () => {
      const response = await selectZLSVersion(
        "0.11.0",
        VersionCompatibility.Full,
      );
      expect(response).toStrictEqual<SelectZLSVersionWithVersionResponse>({
        date: "1970-01-01",
        version: "0.11.0",
        "x86_64-linux": {
          tarball: `${env.R2_PUBLIC_URL}/zls-linux-x86_64-0.11.0.tar.xz`,
          shasum: "aaa",
          size: "12",
        },
        "aarch64-windows": {
          tarball: `${env.R2_PUBLIC_URL}/zls-windows-aarch64-0.11.0.zip`,
          shasum: "ccc",
          size: "12",
        },
      });
    });

    test.each<[string, keyof typeof VersionCompatibility, string | null]>([
      ["0.0.0", "Full", null],
      ["0.0.0-dev.1+aaaaaaaaa", "Full", null],
      ["0.7.0-dev.5+aaaaaaaaa", "Full", null],
      ["0.9.0-dev.10+aaaaaaaaa", "Full", null],
      ["0.9.0-dev.15+aaaaaaaaa", "Full", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.20+aaaaaaaaa", "Full", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.25+aaaaaaaaa", "Full", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.27+aaaaaaaaa", "OnlyRuntime", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.27+aaaaaaaaa", "Full", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.30+aaaaaaaaa", "OnlyRuntime", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.30+aaaaaaaaa", "Full", null],
      ["0.9.0-dev.35+aaaaaaaaa", "OnlyRuntime", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.35+aaaaaaaaa", "Full", null],
      ["0.9.0", "Full", null],
      ["0.10.0-dev.5+aaaaaaaaa", "Full", null],
      ["0.10.0", "Full", null],
      ["0.11.0-dev.1+aaaaaaaaa", "Full", null],
      ["0.11.0-dev.5+aaaaaaaaa", "Full", null],
      ["0.11.0", "Full", "0.11.0"],
      ["0.11.1", "Full", "0.11.0"],
      ["0.12.0-dev.1+aaaaaaaaa", "Full", "0.12.0-dev.1+aaaaaaaaa"],
      ["0.12.0-dev.2+aaaaaaaaa", "Full", "0.12.0-dev.1+aaaaaaaaa"],
      ["0.12.0-dev.5+aaaaaaaaa", "Full", "0.12.0-dev.1+aaaaaaaaa"],
      ["0.12.0-dev.6+aaaaaaaaa", "Full", "0.12.0-dev.1+aaaaaaaaa"],
      ["0.12.0-dev.7+aaaaaaaaa", "Full", "0.12.0-dev.2+aaaaaaaaa"],
      ["0.12.0-dev.8+aaaaaaaaa", "Full", "0.12.0-dev.2+aaaaaaaaa"],
      ["0.12.0-dev.9+aaaaaaaaa", "Full", null],
      ["0.12.0-dev.10+aaaaaaaaa", "Full", null],
      ["0.12.0-dev.13+aaaaaaaaa", "Full", null],
      ["0.12.0-dev.14+aaaaaaaaa", "Full", "0.12.0-dev.3+aaaaaaaaa"],
      ["0.12.0-dev.15+aaaaaaaaa", "Full", "0.12.0-dev.3+aaaaaaaaa"],
      ["0.12.0-dev.17+aaaaaaaaa", "Full", "0.12.0-dev.3+aaaaaaaaa"],
      ["0.12.0-dev.18+aaaaaaaaa", "Full", "0.12.0-dev.3+aaaaaaaaa"],
      ["0.12.0", "Full", "0.12.1"],
      ["0.12.1", "Full", "0.12.1"],
      ["0.13.0-dev.1+aaaaaaaaa", "Full", "0.12.1"],
      ["0.13.0", "Full", "0.13.0"],
      ["0.14.0", "Full", null],
      ["0.15.0", "Full", null],
    ])(
      "Zig %s, %s -> ZLS %s",
      async (zigVersion, compatibility, expectedZLSVersion) => {
        const response = await selectZLSVersion(
          zigVersion,
          VersionCompatibility[compatibility],
        );
        if (expectedZLSVersion === null) {
          expect(response).not.toHaveProperty("version");
          expect(response).toHaveProperty("error");
        } else {
          expect(response).not.toHaveProperty("error");
          assert(!("error" in response));
          expect(response.version).toBe<string>(expectedZLSVersion);
        }
      },
    );

    test.each<[string, string]>([
      ["0.10.0", "ZLS 0.10.* does not exist!"],
      ["0.10.1", "ZLS 0.10.* does not exist!"],
      ["0.15.0", "ZLS 0.15.* does not exist!"],
      ["0.10.0", "ZLS 0.10.* does not exist!"],
      [
        "0.10.0-dev.5+aaaaaaaaa",
        "No builds for the 0.10 release cycle are available",
      ],
      [
        "0.9.0-dev.10+aaaaaaaaa",
        "Zig 0.9.0-dev.10+aaaaaaaaa is not supported by ZLS",
      ],
      [
        "0.12.0-dev.13+aaaaaaaaa",
        "Zig 0.12.0-dev.13+aaaaaaaaa has no compatible ZLS build (yet)",
      ],
    ])("Zig %s should error with '%s'", async (zigVersion, expectedError) => {
      const response = await selectZLSVersion(
        zigVersion,
        VersionCompatibility.Full,
      );
      expect(response).toStrictEqual({
        error: expectedError,
      });
    });
  });

  test("explain query plan when searching all tagged releases", async () => {
    const response = await env.ZIGTOOLS_DB.prepare(
      "EXPLAIN QUERY PLAN SELECT JsonData FROM ZLSReleases WHERE IsRelease = 1 ORDER BY ZLSVersionMajor DESC, ZLSVersionMinor DESC, ZLSVersionPatch DESC",
    ).all<SQLiteQueryPlanRow>();

    // TODO test `response.meta.rows_read` on an example database

    expect(response.results).toMatchObject([
      {
        notused: 0,
        detail:
          "SEARCH ZLSReleases USING INDEX idx_zls_releases_is_release_major_minor_patch (IsRelease=?)",
      },
    ]);
  });

  test("explain query plan when searching on tagged release", async () => {
    const response = await env.ZIGTOOLS_DB.prepare(
      "EXPLAIN QUERY PLAN SELECT JsonData FROM ZLSReleases WHERE IsRelease = 1 AND ZLSVersionMajor = ?1 AND ZLSVersionMinor = ?2",
    )
      .bind(0, 12)
      .all<SQLiteQueryPlanRow>();

    // TODO test `response.meta.rows_read` on an example database

    expect(response.results).toMatchObject([
      {
        notused: 0,
        detail:
          "SEARCH ZLSReleases USING INDEX idx_zls_releases_is_release_major_minor_patch (IsRelease=? AND ZLSVersionMajor=? AND ZLSVersionMinor=?)",
      },
    ]);
  });

  test("explain query plan when searching on tagged release (sorted)", async () => {
    const response = await env.ZIGTOOLS_DB.prepare(
      "EXPLAIN QUERY PLAN SELECT JsonData FROM ZLSReleases WHERE IsRelease = 1 AND ZLSVersionMajor = ?1 AND ZLSVersionMinor = ?2 ORDER BY ZLSVersionPatch DESC",
    )
      .bind(0, 12)
      .all<SQLiteQueryPlanRow>();

    // TODO test `response.meta.rows_read` on an example database

    expect(response.results).toMatchObject([
      {
        notused: 0,
        detail:
          "SEARCH ZLSReleases USING INDEX idx_zls_releases_is_release_major_minor_patch (IsRelease=? AND ZLSVersionMajor=? AND ZLSVersionMinor=?)",
      },
    ]);
  });

  test("explain query plan when searching on development built", async () => {
    const response = await env.ZIGTOOLS_DB.prepare(
      "EXPLAIN QUERY PLAN SELECT JsonData FROM ZLSReleases WHERE IsRelease = 0 AND ZLSVersionMajor = ?1 AND ZLSVersionMinor = ?2 ORDER BY ZLSVersionBuildID ASC",
    )
      .bind(0, 12)
      .all<SQLiteQueryPlanRow>();

    // TODO test `response.meta.rows_read` on an example database

    expect(response.results).toMatchObject([
      {
        notused: 0,
        detail:
          "SEARCH ZLSReleases USING INDEX idx_zls_releases_major_minor_id_where_not_release (ZLSVersionMajor=? AND ZLSVersionMinor=?)",
      },
    ]);
  });
});
