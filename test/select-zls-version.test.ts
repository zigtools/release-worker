import { env, SELF } from "cloudflare:test";
import assert from "node:assert";
import { describe, test, expect, beforeAll } from "vitest";
import {
  D2JsonData,
  ReleaseArtifact,
  SQLiteQueryPlanRow,
  VersionCompatibility,
} from "../src/shared";
import {
  handleSelectVersion,
  SelectVersionResponse,
  SelectVersionFailureResponse,
  SelectVersionFailureCode,
} from "../src/select-zls-version";
import { SemanticVersion } from "../src/semantic-version";

const samples: D2JsonData[] = [
  {
    date: 0,
    zlsVersion: "0.9.0-dev.3+aaaaaaaaa",
    zigVersion: "0.9.0-dev.20+aaaaaaaaa",
    minimumBuildZigVersion: "0.9.0-dev.25+aaaaaaaaa",
    minimumRuntimeZigVersion: "0.9.0-dev.15+aaaaaaaaa",
    artifacts: createExampleArtifacts("0.9.0-dev.3+aaaaaaaaa"),
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
    artifacts: createExampleArtifacts("0.11.0"),
    testedZigVersions: { "0.11.0": VersionCompatibility.Full },
  },
  {
    date: 0,
    zlsVersion: "0.12.0-dev.1+aaaaaaaaa",
    zigVersion: "0.11.0",
    minimumBuildZigVersion: "0.11.0",
    minimumRuntimeZigVersion: "0.11.0",
    artifacts: createExampleArtifacts("0.12.0-dev.1+aaaaaaaaa"),
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
    artifacts: createExampleArtifacts("0.12.0-dev.2+aaaaaaaaa"),
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
    artifacts: createExampleArtifacts("0.12.0-dev.3+aaaaaaaaa"),
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
    artifacts: createExampleArtifacts("0.12.0"),
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
    artifacts: createExampleArtifacts("0.12.1"),
    testedZigVersions: { "0.12.0": VersionCompatibility.Full },
  },
  {
    date: 0,
    zlsVersion: "0.13.0",
    zigVersion: "0.13.0",
    minimumBuildZigVersion: "0.13.0",
    minimumRuntimeZigVersion: "0.13.0",
    artifacts: createExampleArtifacts("0.13.0"),
    testedZigVersions: {
      "0.13.0": VersionCompatibility.Full,
      "0.14.0-dev.2+aaaaaaaaa": VersionCompatibility.Full,
      "0.14.0-dev.4+aaaaaaaaa": VersionCompatibility.None,
    },
  },
];

function createExampleArtifacts(version: string): ReleaseArtifact[] {
  return [
    {
      arch: "x86_64",
      os: "linux",
      version: version,
      extension: "tar.xz",
      fileShasum:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      fileSize: 12,
    },
    {
      arch: "x86_64",
      os: "linux",
      version: version,
      extension: "tar.gz",
      fileShasum:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      fileSize: 12,
    },
    {
      arch: "aarch64",
      os: "windows",
      version: version,
      extension: "zip",
      fileShasum:
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      fileSize: 12,
    },
  ];
}

async function populateDatabase(entries: D2JsonData[]): Promise<void> {
  shuffleArray(entries);
  const statements = entries.map((sample) => {
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
}

async function selectZLSVersion(
  zigVersion: string,
  compatibility: VersionCompatibility,
): Promise<SelectVersionResponse | SelectVersionFailureResponse> {
  assert(compatibility != VersionCompatibility.None);
  const url = new URL("https://example.com/v1/zls/select-version");
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

describe("/v1/zls/index.json", () => {
  test("check for redirect", async () => {
    const response = await SELF.fetch("https://example.com/v1/zls/index.json", {
      redirect: "manual",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      `${env.R2_PUBLIC_URL}/index.json`,
    );
  });
});

describe("/v1/zls/select-version", () => {
  test("method should be 'GET'", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/zls/select-version",
      {
        method: "POST",
      },
    );
    expect(await response.json()).toStrictEqual({
      error: "method must be 'GET'",
    });
    expect(response.status).toBe(405);
  });

  test.each<unknown>([null, "", {}, []])(
    "check for invalid R2_PUBLIC_URL: %j",
    async (value) => {
      const response = await handleSelectVersion(
        new Request("https://example.com/v1/zls/select-version"),
        {
          ...env,
          R2_PUBLIC_URL: value as string,
        },
      );
      expect(response.status).toBe(500);
    },
  );

  test("missing zig version query", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/zls/select-version",
    );
    expect(await response.json()).toStrictEqual({
      error: "Expected query component 'zig_version'!",
    });
    expect(response.status).toBe(400);
  });

  test("invalid zig version", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/zls/select-version?zig_version=foo",
    );
    expect(await response.json()).toStrictEqual({
      error:
        "Query component 'zig_version' with value 'foo' is not a valid version!",
    });
    expect(response.status).toBe(400);
  });

  test("missing compatibility query", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/zls/select-version?zig_version=0.11.0",
    );
    expect(await response.json()).toStrictEqual({
      error: "Expected query component 'compatibility'!",
    });
    expect(response.status).toBe(400);
  });

  test.each<string>(["", "foo", "none", "None", "OnlyRuntime", "Full"])(
    "invalid compatibility string: '%s'",
    async (compatibility) => {
      const response = await SELF.fetch(
        `https://example.com/v1/zls/select-version?zig_version=0.11.0&compatibility=${compatibility}`,
      );
      expect(await response.json()).toStrictEqual({
        error: `form item 'compatibility' with value '${compatibility}' must be one of ["only-runtime","full"]!`,
      });
      expect(response.status).toBe(400);
    },
  );

  test("search on empty database with tagged Zig version", async () => {
    const response = await SELF.fetch(
      "https://example.com/v1/zls/select-version?zig_version=0.11.0&compatibility=full",
    );
    expect(await response.json()).toStrictEqual<SelectVersionFailureResponse>({
      code: SelectVersionFailureCode.TaggedReleaseIncompatible,
      message: "ZLS 0.11 has not been released yet",
    });
    expect(response.status).toBe(200);
  });

  test("search on empty database with development Zig version", async () => {
    const response = await SELF.fetch(
      `https://example.com/v1/zls/select-version?zig_version=${encodeURIComponent("0.11.0-dev.1+aaaaaaaaa")}&compatibility=full`,
    );
    expect(await response.json()).toStrictEqual<SelectVersionFailureResponse>({
      code: SelectVersionFailureCode.DevelopmentBuildUnsupported,
      message: "No builds for the 0.11 release cycle are currently available",
    });
    expect(response.status).toBe(200);
  });

  describe("test on sample database", () => {
    beforeAll(async () => {
      await populateDatabase(samples);
    });

    test("search for with Version 0.11.0", async () => {
      const response = await selectZLSVersion(
        "0.11.0",
        VersionCompatibility.Full,
      );
      expect(response).toStrictEqual<SelectVersionResponse>({
        date: "1970-01-01",
        version: "0.11.0",
        "x86_64-linux": {
          tarball: `${env.R2_PUBLIC_URL}/zls-linux-x86_64-0.11.0.tar.xz`,
          shasum:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          size: "12",
        },
        "aarch64-windows": {
          tarball: `${env.R2_PUBLIC_URL}/zls-windows-aarch64-0.11.0.zip`,
          shasum:
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          size: "12",
        },
      });
    });

    test.each<[string, "Both" | "Full" | "OnlyRuntime", string | null]>([
      ["0.0.0", "Full", null],
      ["0.0.0-dev.1+aaaaaaaaa", "Full", null],
      ["0.7.0-dev.5+aaaaaaaaa", "Full", null],
      ["0.9.0-dev.10+aaaaaaaaa", "Full", null],
      ["0.9.0-dev.15+aaaaaaaaa", "OnlyRuntime", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.15+aaaaaaaaa", "Full", null],
      ["0.9.0-dev.20+aaaaaaaaa", "OnlyRuntime", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.20+aaaaaaaaa", "Full", null],
      ["0.9.0-dev.25+aaaaaaaaa", "Both", "0.9.0-dev.3+aaaaaaaaa"],
      ["0.9.0-dev.27+aaaaaaaaa", "Both", "0.9.0-dev.3+aaaaaaaaa"],
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
      ["0.13.0-dev.1+aaaaaaaaa", "OnlyRuntime", null],
      ["0.13.0", "Full", "0.13.0"],
      ["0.14.0-dev.3+aaaaaaaaa", "Full", "0.13.0"],
      ["0.14.0-dev.4+aaaaaaaaa", "Full", null],
      ["0.14.0", "Full", null],
      ["0.15.0", "Full", null],
    ])(
      "Zig %s, %s -> ZLS %s",
      async (zigVersion, compatibility, expectedZLSVersion) => {
        const cases: VersionCompatibility[] = [];
        switch (compatibility) {
          case "Full":
            cases.push(VersionCompatibility.Full);
            break;
          case "OnlyRuntime":
            cases.push(VersionCompatibility.OnlyRuntime);
            break;
          case "Both":
            cases.push(
              VersionCompatibility.OnlyRuntime,
              VersionCompatibility.Full,
            );
            break;
        }
        for (const compat of cases) {
          const response = await selectZLSVersion(zigVersion, compat);
          if (expectedZLSVersion === null) {
            expect(response).not.toHaveProperty("version");
            expect(response).toHaveProperty("code");
            expect(response).toHaveProperty("message");
          } else {
            expect(response).toHaveProperty("version", expectedZLSVersion);
            expect(response).not.toHaveProperty("code");
            expect(response).not.toHaveProperty("message");
          }
        }
      },
    );

    test.each<[string, SelectVersionFailureCode, string]>([
      [
        "0.10.0",
        SelectVersionFailureCode.Unsupported,
        "Zig 0.10.0 is not supported by ZLS",
      ],
      [
        "0.10.1",
        SelectVersionFailureCode.Unsupported,
        "Zig 0.10.1 is not supported by ZLS",
      ],
      [
        "0.15.0",
        SelectVersionFailureCode.TaggedReleaseIncompatible,
        "ZLS 0.15 has not been released yet",
      ],
      [
        "0.10.0-dev.5+aaaaaaaaa",
        SelectVersionFailureCode.DevelopmentBuildUnsupported,
        "No builds for the 0.10 release cycle are currently available",
      ],
      [
        "0.9.0-dev.10+aaaaaaaaa",
        SelectVersionFailureCode.Unsupported,
        "Zig 0.9.0-dev.10+aaaaaaaaa is not supported by ZLS",
      ],
      [
        "0.12.0-dev.13+aaaaaaaaa",
        SelectVersionFailureCode.DevelopmentBuildIncompatible,
        "Zig 0.12.0-dev.13+aaaaaaaaa has no compatible ZLS build (yet)",
      ],
      [
        "0.14.0-dev.10+aaaaaaaaa",
        SelectVersionFailureCode.DevelopmentBuildIncompatible,
        "Zig 0.14.0-dev.10+aaaaaaaaa has no compatible ZLS build (yet)",
      ],
    ])(
      "Zig %s should error with '%s'",
      async (zigVersion, expectedCode, expectedError) => {
        const response = await selectZLSVersion(
          zigVersion,
          VersionCompatibility.Full,
        );
        expect(response).toStrictEqual<SelectVersionFailureResponse>({
          code: expectedCode,
          message: expectedError,
        });
      },
    );
  });

  test("select development build before tagged release is available", async () => {
    await populateDatabase([
      {
        date: 0,
        zlsVersion: "0.15.0",
        zigVersion: "0.15.1",
        minimumBuildZigVersion: "0.15.1",
        minimumRuntimeZigVersion: "0.15.1",
        artifacts: createExampleArtifacts("0.15.0"),
        testedZigVersions: {
          "0.15.1": VersionCompatibility.Full,
        },
      },
    ]);

    {
      const response = await selectZLSVersion(
        "0.15.1-dev.1+aaaaaaaaa",
        VersionCompatibility.Full,
      );
      expect(response.code).toBe(
        SelectVersionFailureCode.DevelopmentBuildUnsupported,
      );
    }

    {
      const response = await selectZLSVersion(
        "0.15.2-dev.1+aaaaaaaaa",
        VersionCompatibility.Full,
      );
      expect(response).toMatchObject({
        version: "0.15.0",
      });
    }

    {
      const response = await selectZLSVersion(
        "0.16.0-dev.1+aaaaaaaaa",
        VersionCompatibility.Full,
      );
      expect(response).not.toHaveProperty("code");
      assert(!("code" in response));
      expect(response.version).toBe("0.15.0");
    }

    {
      const response = await selectZLSVersion(
        "0.16.1-dev.1+aaaaaaaaa",
        VersionCompatibility.Full,
      );
      expect(response.code).toBe(
        SelectVersionFailureCode.DevelopmentBuildUnsupported,
      );
    }

    {
      const response = await selectZLSVersion(
        "0.17.0-dev.1+aaaaaaaaa",
        VersionCompatibility.Full,
      );
      expect(response.code).toBe(
        SelectVersionFailureCode.DevelopmentBuildUnsupported,
      );
    }
  });

  test("target string has changed with begining with 0.15.0", async () => {
    await populateDatabase([
      {
        date: 0,
        zlsVersion: "0.15.0",
        zigVersion: "0.15.0",
        minimumBuildZigVersion: "0.15.0",
        minimumRuntimeZigVersion: "0.15.0",
        artifacts: createExampleArtifacts("0.15.0"),
        testedZigVersions: {
          "0.15.0": VersionCompatibility.Full,
        },
      },
    ]);

    const response = await selectZLSVersion(
      "0.15.0",
      VersionCompatibility.Full,
    );

    expect(response).not.toHaveProperty("message");
    assert(!("message" in response));

    expect(response).toHaveProperty("x86_64-linux");
    expect(response).not.toHaveProperty("linux-x86_64");

    const artifactEntry = response["x86_64-linux"];
    expect(artifactEntry).toHaveProperty("tarball");
    assert(typeof artifactEntry == "object");

    expect(artifactEntry.tarball).toBe(
      `${env.R2_PUBLIC_URL}/zls-x86_64-linux-0.15.0.tar.xz`,
    );
  });

  test("explain query plan when searching all tagged releases", async () => {
    const response = await env.ZIGTOOLS_DB.prepare(
      "EXPLAIN QUERY PLAN SELECT ZLSVersion, JsonData FROM ZLSReleases WHERE IsRelease = 1 ORDER BY ZLSVersionMajor DESC, ZLSVersionMinor DESC, ZLSVersionPatch DESC",
    ).all<SQLiteQueryPlanRow>();

    // TODO test `response.meta.rows_read` on an example database

    expect(response.results).toMatchObject([
      {
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
        detail:
          "SEARCH ZLSReleases USING INDEX idx_zls_releases_major_minor_id_where_not_release (ZLSVersionMajor=? AND ZLSVersionMinor=?)",
      },
    ]);
  });
});
