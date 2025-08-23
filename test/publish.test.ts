import { createExecutionContext, env, SELF } from "cloudflare:test";
import assert from "node:assert";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  D2JsonData,
  SQLiteQueryPlanRow,
  VersionCompatibility,
  ZLSIndex,
} from "../src/shared";
import {
  ArtifactMetadata,
  handlePublish,
  PublishRequest,
} from "../src/publish";

async function searchZLSRelease(
  zlsVersion: string,
): Promise<D2JsonData | null> {
  const jsonString = await env.ZIGTOOLS_DB.prepare(
    "SELECT JsonData FROM ZLSReleases WHERE ZLSVersion = ?1",
  )
    .bind(zlsVersion)
    .first<string>("JsonData");
  if (jsonString === null) return null;
  return JSON.parse(jsonString) as D2JsonData;
}

async function sendPublishForm(body: PublishRequest): Promise<Response> {
  assert(typeof env.API_TOKEN === "string" && env.API_TOKEN);
  return await SELF.fetch(
    new Request("https://example.com/v1/zls/publish", {
      body: JSON.stringify(body),
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        Authorization: `Basic ${Buffer.from(`admin:${env.API_TOKEN}`).toString("base64")}`,
      },
    }),
  );
}

async function sendPublish({
  zlsVersion,
  zigVersion,
  minimumBuildZigVersion,
  minimumRuntimeZigVersion,
  compatibility,
  artifacts,
}: {
  zlsVersion: string;
  zigVersion: string;
  minimumBuildZigVersion?: string;
  minimumRuntimeZigVersion?: string;
  compatibility?: VersionCompatibility;
  artifacts: Record<string, ArtifactMetadata>;
}): Promise<Response> {
  const body = initPublishForm({
    zlsVersion,
    zigVersion,
    minimumBuildZigVersion,
    minimumRuntimeZigVersion,
    compatibility,
    artifacts,
  });
  return await sendPublishForm(body);
}

function initPublishForm({
  zlsVersion,
  zigVersion,
  minimumBuildZigVersion,
  minimumRuntimeZigVersion,
  compatibility,
  artifacts,
}: {
  zlsVersion: string;
  zigVersion: string;
  minimumBuildZigVersion?: string;
  minimumRuntimeZigVersion?: string;
  compatibility?: VersionCompatibility;
  artifacts: Record<string, ArtifactMetadata>;
}): PublishRequest {
  return {
    zlsVersion: zlsVersion,
    zigVersion: zigVersion,
    minimumBuildZigVersion: minimumBuildZigVersion ?? zigVersion,
    minimumRuntimeZigVersion: minimumRuntimeZigVersion ?? zigVersion,
    compatibility:
      compatibility ??
      (Object.keys(artifacts).length === 0
        ? VersionCompatibility.None
        : VersionCompatibility.Full),
    artifacts,
  };
}

function getSampleArtifact(
  fileName: string,
  shasum?: string,
  size?: number,
): Record<string, ArtifactMetadata> {
  return {
    [fileName]: {
      shasum: shasum ?? "a".repeat(64),
      size: size ?? 1,
    },
  };
}

function getSampleArtifacts(version: string): Record<string, ArtifactMetadata> {
  return {
    [`zls-linux-x86_64-${version}.tar.xz`]: {
      shasum: "a".repeat(64),
      size: 1,
    },
    [`zls-linux-x86_64-${version}.tar.gz`]: {
      shasum: "b".repeat(64),
      size: 2,
    },
  };
}

describe("/v1/zls/publish", () => {
  test("expect POST method", async () => {
    const response = await SELF.fetch("https://example.com/v1/zls/publish");
    expect(await response.text()).toBe("method must be 'POST'");
    expect(response.status).toBe(405);
  });

  test.each<unknown>([null, "", {}, []])(
    "check for invalid API_TOKEN: %j",
    async (value) => {
      const response = await handlePublish(
        new Request("https://example.com/v1/zls/publish", {
          method: "POST",
        }),
        {
          ...env,
          API_TOKEN: value as string,
        },
        createExecutionContext(),
      );
      expect(response.status).toBe(500);
    },
  );

  describe("check authorization", () => {
    test("missing Authorization header", async () => {
      const response = await SELF.fetch("https://example.com/v1/zls/publish", {
        method: "POST",
      });

      expect(await response.text()).toBe("Authorization failed");
      expect(response.status).toBe(401);
    });

    test("invalid Authorization header", async () => {
      const response = await SELF.fetch("https://example.com/v1/zls/publish", {
        body: null,
        method: "POST",
        headers: {
          Authorization: "invalid",
        },
      });
      expect(await response.text()).toContain(
        "Unexpected Authorization header",
      );
      expect(response.status).toBe(400);
    });

    test("non Basic Authorization header", async () => {
      const response = await SELF.fetch("https://example.com/v1/zls/publish", {
        body: null,
        method: "POST",
        headers: {
          Authorization: "Bearer foo",
        },
      });
      expect(await response.text()).toBe(
        "Expected 'Basic' authentication scheme!",
      );
      expect(response.status).toBe(400);
    });

    test("invalid Basic Authorization header", async () => {
      const response = await SELF.fetch("https://example.com/v1/zls/publish", {
        body: null,
        method: "POST",
        headers: {
          Authorization: "Basic :",
        },
      });
      expect(await response.text()).toContain(
        "Unexpected Authorization header",
      );
      expect(response.status).toBe(401);
    });

    test("wrong username", async () => {
      const response = await SELF.fetch("https://example.com/v1/zls/publish", {
        body: null,
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`wrong:${env.API_TOKEN}`).toString("base64")}`,
        },
      });
      expect(await response.text()).toBe("Authorization failed");
      expect(response.status).toBe(401);
    });

    test("wrong password", async () => {
      const response = await SELF.fetch("https://example.com/v1/zls/publish", {
        body: null,
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from("admin:wrong").toString("base64")}`,
        },
      });
      expect(await response.text()).toBe("Authorization failed");
      expect(response.status).toBe(401);
    });
  });

  describe("validate request body", () => {
    test("body is not a json", async () => {
      const response = await SELF.fetch("https://example.com/v1/zls/publish", {
        body: null,
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`admin:${env.API_TOKEN}`).toString("base64")}`,
        },
      });
      expect(await response.text()).toBe(`Unexpected end of JSON input`);
      expect(response.status).toBe(400);
    });

    test("body is not a JSON object", async () => {
      const response = await SELF.fetch("https://example.com/v1/zls/publish", {
        body: JSON.stringify(5),
        method: "POST",
        headers: {
          "content-type": "application/json;charset=UTF-8",
          Authorization: `Basic ${Buffer.from(`admin:${env.API_TOKEN}`).toString("base64")}`,
        },
      });
      expect(await response.text()).toBe(`request body is not a JSON object!`);
      expect(response.status).toBe(400);
    });

    test.each<string>([
      "zigVersion",
      "zlsVersion",
      "minimumBuildZigVersion",
      "minimumRuntimeZigVersion",
      "compatibility",
    ])("missing '%s' field", async (fieldName) => {
      const body: Record<string, unknown> = {
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        minimumBuildZigVersion: "0.1.0",
        minimumRuntimeZigVersion: "0.1.0",
        compatibility: VersionCompatibility.Full,
        artifacts: {},
      } satisfies PublishRequest;
      const { [fieldName]: _, ...newBody } = body;
      const response = await sendPublishForm(
        newBody as unknown as PublishRequest,
      );
      expect(await response.text()).toBe(
        `missing request field '${fieldName}'!`,
      );
      expect(response.status).toBe(400);
    });

    test.each<string>([
      "zigVersion",
      "zlsVersion",
      "minimumBuildZigVersion",
      "minimumRuntimeZigVersion",
      "compatibility",
    ])("field '%s' is not a string", async (fieldName) => {
      const body: Record<string, unknown> = {
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        minimumBuildZigVersion: "0.1.0",
        minimumRuntimeZigVersion: "0.1.0",
        compatibility: VersionCompatibility.Full,
        artifacts: {},
      } satisfies PublishRequest;
      body[fieldName] = 5;
      const response = await sendPublishForm(body as unknown as PublishRequest);
      expect(await response.text()).toBe(
        `request field '${fieldName}' is not a string!`,
      );
      expect(response.status).toBe(400);
    });

    test.each<[unknown, "ok" | "bad"]>([
      [{}, "ok"],
      [{ name: { shasum: "", size: 1 } }, "ok"],
      [{ name: { shasum: "", size: 1, unknown: "unknown" } }, "bad"],
      [{ name: { shasum: "", size: "" } }, "bad"],
      [{ name: { shasum: 5, size: 1 } }, "bad"],
      [{ name: { shasum: "" } }, "bad"],
      [{ name: { size: 1 } }, "bad"],
      [{ name: {} }, "bad"],
      [{ name: { unknown: "unknown" } }, "bad"],
      [5, "bad"],
      [undefined, "bad"],
    ])("validate artifacts field %j", async (value, status) => {
      const body: PublishRequest = {
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        minimumBuildZigVersion: "0.1.0",
        minimumRuntimeZigVersion: "0.1.0",
        compatibility: VersionCompatibility.Full,
        artifacts: value as Record<string, ArtifactMetadata>,
      };
      const response = await sendPublishForm(body);
      if (status == "ok") {
        expect(await response.text()).not.toBe(
          `invalid request field 'artifacts'!`,
        );
      } else {
        expect(await response.text()).toBe(
          `invalid request field 'artifacts'!`,
        );
        expect(response.status).toBe(400);
      }
    });

    test("response should be empty body", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: getSampleArtifacts("0.1.0"),
      });

      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    });

    test.each<[string, "ok" | "bad"]>([
      ["", "bad"],
      ["some string", "bad"],
      ["0.1.0", "ok"],
      ["0.1.0-dev.1+aaaaaaa", "ok"],
    ])("validate ZLS version: '%s' -> %s", async (zlsVersion, kind) => {
      const response = await sendPublish({
        zlsVersion: zlsVersion,
        zigVersion: "0.1.0",
        artifacts: getSampleArtifacts(zlsVersion),
      });
      if (kind === "ok") {
        expect(await response.text()).toBe("");
        expect(response.status).toBe(200);
      } else {
        expect(await response.text()).toBe(
          `request field 'zlsVersion' with value '${zlsVersion}' is not a valid version!`,
        );
        expect(response.status).toBe(400);
      }
    });

    test.each<[string, "ok" | "bad"]>([
      ["", "bad"],
      ["some string", "bad"],
      ["0.1.0", "ok"],
      ["0.1.0-dev.1+aaaaaaaaa", "ok"],
    ])("validate Zig version: '%s' -> %s", async (zigVersion, expected) => {
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev.1+aaaaaaaaa",
        zigVersion: zigVersion,
        artifacts: getSampleArtifacts("0.1.0-dev.1+aaaaaaaaa"),
      });
      if (expected === "ok") {
        expect(await response.text()).toBe("");
        expect(response.status).toBe(200);
      } else {
        expect(await response.text()).toBe(
          `request field 'zigVersion' with value '${zigVersion}' is not a valid version!`,
        );
        expect(response.status).toBe(400);
      }
    });

    test("validate artifact size", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: {
          "zls-linux-x86_64-0.1.0.tar.xz": {
            shasum: "a".repeat(64),
            size: 0,
          },
        },
        compatibility: VersionCompatibility.OnlyRuntime,
      });

      expect(await response.text()).toBe(
        "artifact 'zls-linux-x86_64-0.1.0.tar.xz' can't be empty!",
      );
      expect(response.status).toBe(400);
    });

    test.each<string>(["", "a", "z".repeat(64)])(
      "validate artifact shasum '%s'",
      async (shasum) => {
        const response = await sendPublish({
          zlsVersion: "0.1.0",
          zigVersion: "0.1.0",
          artifacts: {
            "zls-windows-x86_64-0.1.0.zip": {
              shasum: shasum,
              size: 1,
            },
          },
        });
        expect(await response.text()).toBe(
          `artifact 'zls-windows-x86_64-0.1.0.zip' has an invalid shasum '${shasum}'`,
        );
        expect(response.status).toBe(400);
      },
    );

    test("new tagged release should have full compatibility", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: getSampleArtifacts("0.1.0"),
        compatibility: VersionCompatibility.OnlyRuntime,
      });

      expect(await response.text()).toBe(
        "A new tagged release of ZLS must have full compatibility but was 'only-runtime'!",
      );
      expect(response.status).toBe(400);
    });

    test.each<["successfull" | "failed", string, "ok" | "bad"]>([
      ["successfull", "", "bad"],
      ["successfull", "some string", "bad"],
      ["successfull", "None", "bad"],
      ["successfull", "OnlyRuntime", "bad"],
      ["successfull", "Full", "bad"],
    ])(
      "invalid compatibility string: %s -> %s",
      async (compatibilityString, expected) => {
        const response = await sendPublish({
          zlsVersion: "0.1.0",
          zigVersion: "0.1.0",
          artifacts: getSampleArtifacts("0.1.0"),
          compatibility: compatibilityString as
            | VersionCompatibility
            | undefined,
        });

        switch (expected) {
          case "ok":
            expect(await response.text()).toBe("");
            expect(response.status).toBe(200);
            break;
          case "bad":
            expect(await response.text()).toBe(
              `form item 'compatibility' with value '${compatibilityString}' must be one of ["none","only-runtime","full"]!`,
            );
            expect(response.status).toBe(400);
            break;
        }
      },
    );

    test.each<["successfull" | "failed", string, "ok" | "bad"]>([
      ["successfull", "none", "bad"],
      ["successfull", "only-runtime", "ok"],
      ["successfull", "full", "ok"],
      ["failed", "none", "ok"],
      ["failed", "only-runtime", "bad"],
      ["failed", "full", "bad"],
    ])(
      "%s build with %s compatibility -> %s",
      async (kind, compatibilityString, expected) => {
        const successfullPublish = await sendPublish({
          zlsVersion: "0.1.0-dev.1+aaaaaaaaa",
          zigVersion: "0.1.0",
          artifacts: getSampleArtifacts("0.1.0-dev.1+aaaaaaaaa"),
        });
        expect(successfullPublish.status).toBe(200);

        const response = await sendPublish({
          zlsVersion: "0.1.0-dev.1+aaaaaaaaa",
          zigVersion: "0.2.0",
          artifacts:
            kind === "successfull"
              ? getSampleArtifacts("0.1.0-dev.1+aaaaaaaaa")
              : {},
          compatibility: compatibilityString as
            | VersionCompatibility
            | undefined,
        });

        switch (expected) {
          case "ok":
            expect(await response.text()).toBe("");
            expect(response.status).toBe(200);
            break;
          case "bad":
            expect(await response.text()).toBe(
              `A ${kind} ZLS build can't have '${compatibilityString}' as its version compatibility!`,
            );
            expect(response.status).toBe(400);
            break;
        }
      },
    );

    test.each<[string, "ok" | "bad"]>([
      ["", "bad"],
      ["some string", "bad"],
      ["x86_64-linux-0.1.0.tar.xz", "bad"], // missing 'zls-' prefix
      ["zls-linux-x86_64-0.1.0.gz", "bad"], // .gz extension not allowed
      ["zls-linux-x86_64-0.1.0.tar.zstd", "bad"], // .tar.zstd extension not allowed
      ["zls-linux-x86_64-0.2.0.tar.xz", "bad"], // mismatching ZLS version
      ["zls-linux-x86_64-0.1.0-dev.tar.xz", "bad"], // invalid ZLS version
      ["zls-linux-x86_64-0.1.0.tar.xz", "ok"],
      ["zls-linux-x86_64-0.1.0.tar.gz", "ok"],
      ["zls-windows-aarch64-0.1.0.zip", "ok"],
    ])("validate artifact string: %j -> %s", async (filename, expected) => {
      let artifacts: Record<string, ArtifactMetadata>;
      if (filename.endsWith("zip")) {
        artifacts = getSampleArtifact(filename);
      } else {
        artifacts = {
          ...getSampleArtifact(
            filename.endsWith("xz")
              ? filename
              : "zls-linux-x86_64-0.1.0.tar.xz",
          ),
          ...getSampleArtifact(
            filename.endsWith("xz")
              ? "zls-linux-x86_64-0.1.0.tar.gz"
              : filename,
          ),
        };
      }

      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: artifacts,
      });

      if (expected === "ok") {
        expect(await response.text()).toBe("");
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(400);
      }
    });

    test("all artifacts should have the same version", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: {
          "zls-linux-x86_64-0.1.0.tar.xz": {
            shasum: "a".repeat(64),
            size: 1,
          },
          "zls-linux-x86_64-0.1.0.tar.gz": {
            shasum: "b".repeat(64),
            size: 2,
          },
          "zls-windows-x86_64-0.2.0.zip": {
            shasum: "c".repeat(64),
            size: 3,
          },
        },
      });
      expect(await response.text()).toBe(
        "all artifacts must have the same version!",
      );
      expect(response.status).toBe(400);
    });

    test("artifact version in file name should match ZLS version", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: getSampleArtifacts("0.2.0"),
      });
      expect(await response.text()).toBe(
        "ZLS version is '0.1.0' but all artifacts have the version '0.2.0'",
      );
      expect(response.status).toBe(400);
    });

    test("zip artifacts should be on windows", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: getSampleArtifact("zls-linux-x86_64-0.1.0.zip"),
      });
      expect(await response.text()).toBe(
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["zip"]!`,
      );
      expect(response.status).toBe(400);
    });

    test("non zip artifacts should not be on windows", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: getSampleArtifact("zls-windows-x86_64-0.1.0.tar.xz"),
      });
      expect(await response.text()).toBe(
        `artifact extensions of 'zls-windows-x86_64-0.1.0.*' must be ["zip"] but found ["tar.xz"]!`,
      );
      expect(response.status).toBe(400);
    });

    test.each<[("tar.xz" | "tar.gz" | "zip")[], string]>([
      [
        ["tar.xz"],
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["tar.xz"]!`,
      ],
      [
        ["tar.gz"],
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["tar.gz"]!`,
      ],
      [
        ["tar.gz", "zip"],
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["tar.gz","zip"]!`,
      ],
      [
        ["zip", "tar.gz"],
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["zip","tar.gz"]!`,
      ],
      [
        ["tar.xz", "zip"],
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["tar.xz","zip"]!`,
      ],
      [
        ["zip", "tar.xz"],
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["zip","tar.xz"]!`,
      ],
      [
        ["tar.xz", "tar.gz", "zip"],
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["tar.xz","tar.gz","zip"]!`,
      ],
      [
        ["zip", "tar.xz", "tar.gz"],
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["zip","tar.xz","tar.gz"]!`,
      ],
    ])("invalid artifact extensions: %j", async (extensions, expectedError) => {
      const artifacts: Record<string, ArtifactMetadata> = {};
      for (const extension of extensions) {
        artifacts[`zls-linux-x86_64-0.1.0.${extension}`] = {
          shasum: "a".repeat(64),
          size: 1,
        };
      }

      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: artifacts,
      });

      expect(await response.text()).toBe(expectedError);
      expect(response.status).toBe(400);
    });

    test("'tar.xz' and 'tar.gz' should always be published together", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: getSampleArtifact("zls-linux-x86_64-0.1.0.zip"),
      });
      expect(await response.text()).toBe(
        `artifact extensions of 'zls-linux-x86_64-0.1.0.*' must be ["tar.xz","tar.gz"] but found ["zip"]!`,
      );
      expect(response.status).toBe(400);
    });

    test.each<[string, string, "ok" | "bad"]>([
      ["0.1.0", "0.1.0", "ok"],
      ["0.1.0", "0.1.1", "ok"],
      ["0.1.1", "0.1.0", "ok"],
      ["0.1.0", "0.1.0-dev.1+aaaaaaa", "bad"],
      ["0.1.1-dev.1+aaaaaaa", "0.1.0", "bad"],
      ["0.1.0-dev.1+aaaaaaa", "0.1.0", "ok"],
      ["0.1.0-dev.1+aaaaaaa", "0.1.0-dev.1+aaaaaaaaa", "ok"],
    ])(
      "publishing ZLS %s with Zig %s -> %s",
      async (zlsVersion, zigVersion, expected) => {
        const response = await sendPublish({
          zlsVersion: zlsVersion,
          zigVersion: zigVersion,
          artifacts: getSampleArtifacts(zlsVersion),
        });
        if (expected === "ok") {
          expect(await response.text()).toBe("");
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(400);
        }
      },
    );
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("search for builds", async () => {
    {
      const jsonData = await searchZLSRelease("");
      expect(jsonData).toBe(null);
    }
    {
      const jsonData = await searchZLSRelease("0.1.0");
      expect(jsonData).toBe(null);
    }
  });

  test("try to publish ZLS 1.0.0", async () => {
    const response = await sendPublish({
      zlsVersion: "1.0.0",
      zigVersion: "1.0.0",
      artifacts: getSampleArtifacts("1.0.0"),
    });
    expect(response.status).toBe(418);
  });

  test("publish new successfull build", async () => {
    const date = Date.now();
    vi.setSystemTime(date);

    const response = await sendPublish({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.1",
      artifacts: {
        "zls-linux-x86_64-0.1.0.tar.xz": {
          shasum: "a".repeat(64),
          size: 1,
        },
        "zls-linux-x86_64-0.1.0.tar.gz": {
          shasum: "b".repeat(64),
          size: 2,
        },
        "zls-windows-aarch64-0.1.0.zip": {
          shasum: "c".repeat(64),
          size: 3,
        },
      },
    });

    expect(await response.text()).toBe("");
    expect(response.status).toBe(200);

    const jsonData = await searchZLSRelease("0.1.0");
    expect(jsonData).toStrictEqual<D2JsonData>({
      date: date,
      zlsVersion: "0.1.0",
      zigVersion: "0.1.1",
      minimumBuildZigVersion: "0.1.1",
      minimumRuntimeZigVersion: "0.1.1",
      testedZigVersions: {
        "0.1.1": VersionCompatibility.Full,
      },
      artifacts: [
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0",
          extension: "tar.xz",
          fileShasum: "a".repeat(64),
          fileSize: 1,
        },
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0",
          extension: "tar.gz",
          fileShasum: "b".repeat(64),
          fileSize: 2,
        },
        {
          arch: "aarch64",
          os: "windows",
          version: "0.1.0",
          extension: "zip",
          fileShasum: "c".repeat(64),
          fileSize: 3,
        },
      ],
    });
  });

  test("publish build new target format (0.15.0 or later)", async () => {
    const response = await sendPublish({
      zlsVersion: "0.15.0",
      zigVersion: "0.15.0",
      artifacts: {
        "zls-x86_64-linux-0.15.0.tar.xz": {
          shasum: "a".repeat(64),
          size: 1,
        },
        "zls-x86_64-linux-0.15.0.tar.gz": {
          shasum: "b".repeat(64),
          size: 2,
        },
        "zls-aarch64-windows-0.15.0.zip": {
          shasum: "c".repeat(64),
          size: 3,
        },
      },
    });
    expect(await response.text()).toBe("");
    expect(response.status).toBe(200);
  });

  test("disallow publishing a failed tagged release", async () => {
    const response = await sendPublish({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.0",
      artifacts: {},
    });

    expect(await response.text()).toBe(
      "A new tagged release of ZLS must have artifacts!",
    );
    expect(response.status).toBe(400);
  });

  test("disallow publishing a new failed build", async () => {
    const response = await sendPublish({
      zlsVersion: "0.1.0-dev.1+aaaaaaa",
      zigVersion: "0.1.0",
      artifacts: {},
    });

    expect(await response.text()).toBe(
      "ZLS version '0.1.0-dev.1+aaaaaaa' is new and has not artifacts. A new ZLS build can't be failed!",
    );
    expect(response.status).toBe(400);
  });

  test("publish builds with mismatching commit hashes", async () => {
    {
      const response = await sendPublish({
        zlsVersion: "0.13.0-dev.1+aaaaaaa",
        zigVersion: "0.12.0",
        artifacts: getSampleArtifacts("0.13.0-dev.1+aaaaaaa"),
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      const response = await sendPublish({
        zlsVersion: "0.13.0-dev.1+bbbbbbb",
        zigVersion: "0.12.0",
        artifacts: getSampleArtifacts("0.13.0-dev.1+bbbbbbb"),
      });
      expect(await response.text()).toBe(
        "ZLS version is '0.13.0-dev.1+bbbbbbb' can't be published because ZLS '0.13.0-dev.1+aaaaaaa' has already been published!",
      );
      expect(response.status).toBe(400);
    }
  });

  test("explain query plan when searching for ZLS Version with different commit hash", async () => {
    const response = await env.ZIGTOOLS_DB.prepare(
      "EXPLAIN QUERY PLAN SELECT ZLSVersion FROM ZLSReleases WHERE IsRelease = 0 AND ZLSVersionMajor = 0 AND ZLSVersionMinor = 13 AND ZLSVersionPatch = 0 AND ZLSVersionBuildID = 1",
    ).all<SQLiteQueryPlanRow>();

    expect(response.results).toMatchObject([
      {
        detail:
          "SEARCH ZLSReleases USING INDEX idx_zls_releases_is_release_major_minor_patch (IsRelease=? AND ZLSVersionMajor=? AND ZLSVersionMinor=? AND ZLSVersionPatch=?)",
      },
    ]);
  });

  test("publish new successfull build then add failures", async () => {
    const date = Date.now();
    vi.setSystemTime(date);

    {
      // successfull build with Zig 0.1.1
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev.1+aaaaaaa",
        zigVersion: "0.1.1",
        artifacts: {
          "zls-linux-x86_64-0.1.0-dev.1+aaaaaaa.tar.xz": {
            shasum: "a".repeat(64),
            size: 1,
          },
          "zls-linux-x86_64-0.1.0-dev.1+aaaaaaa.tar.gz": {
            shasum: "b".repeat(64),
            size: 2,
          },
          "zls-windows-aarch64-0.1.0-dev.1+aaaaaaa.zip": {
            shasum: "c".repeat(64),
            size: 3,
          },
        },
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // failed build with 0.1.2
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev.1+aaaaaaa",
        zigVersion: "0.1.2",
        artifacts: {},
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // successfull build with 0.1.2
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev.1+aaaaaaa",
        zigVersion: "0.1.2",
        artifacts: {
          "zls-linux-x86_64-0.1.0-dev.1+aaaaaaa.tar.xz": {
            shasum: "d".repeat(64),
            size: 4,
          },
          "zls-linux-x86_64-0.1.0-dev.1+aaaaaaa.tar.gz": {
            shasum: "e".repeat(64),
            size: 5,
          },
          "zls-windows-aarch64-0.1.0-dev.1+aaaaaaa.zip": {
            shasum: "f".repeat(64),
            size: 6,
          },
        },
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // failed build with 0.1.3
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev.1+aaaaaaa",
        zigVersion: "0.1.3",
        artifacts: {},
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    const jsonData = await searchZLSRelease("0.1.0-dev.1+aaaaaaa");
    expect(jsonData).toStrictEqual<D2JsonData>({
      date: date,
      zlsVersion: "0.1.0-dev.1+aaaaaaa",
      zigVersion: "0.1.1",
      minimumBuildZigVersion: "0.1.1",
      minimumRuntimeZigVersion: "0.1.1",
      testedZigVersions: {
        "0.1.1": VersionCompatibility.Full,
        "0.1.2": VersionCompatibility.Full,
        "0.1.3": VersionCompatibility.None,
      },
      artifacts: [
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0-dev.1+aaaaaaa",
          extension: "tar.xz",
          fileShasum: "a".repeat(64),
          fileSize: 1,
        },
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0-dev.1+aaaaaaa",
          extension: "tar.gz",
          fileShasum: "b".repeat(64),
          fileSize: 2,
        },
        {
          arch: "aarch64",
          os: "windows",
          version: "0.1.0-dev.1+aaaaaaa",
          extension: "zip",
          fileShasum: "c".repeat(64),
          fileSize: 3,
        },
      ],
    });
  });

  test("publish new successfull build with different Zig versions", async () => {
    const date = 1729123200000;
    vi.setSystemTime(date);

    {
      const response = await sendPublish({
        zlsVersion: "0.11.0",
        zigVersion: "0.11.0",
        artifacts: {
          "zls-linux-x86_64-0.11.0.tar.xz": { shasum: "a".repeat(64), size: 1 },
          "zls-linux-x86_64-0.11.0.tar.gz": { shasum: "b".repeat(64), size: 2 },
        },
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      const response = await sendPublish({
        zlsVersion: "0.11.0",
        zigVersion: "0.11.1",
        artifacts: {
          "zls-linux-x86_64-0.11.0.tar.xz": { shasum: "c".repeat(64), size: 3 },
          "zls-linux-x86_64-0.11.0.tar.gz": { shasum: "d".repeat(64), size: 4 },
          "zls-windows-aarch64-0.11.0.zip": { shasum: "e".repeat(64), size: 5 },
        },
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    const jsonData = await searchZLSRelease("0.11.0");
    expect(jsonData).toStrictEqual<D2JsonData>({
      date: date,
      zlsVersion: "0.11.0",
      zigVersion: "0.11.0",
      minimumBuildZigVersion: "0.11.0",
      minimumRuntimeZigVersion: "0.11.0",
      testedZigVersions: {
        "0.11.0": VersionCompatibility.Full,
        "0.11.1": VersionCompatibility.Full,
      },
      artifacts: [
        {
          arch: "x86_64",
          os: "linux",
          version: "0.11.0",
          extension: "tar.xz",
          fileShasum: "a".repeat(64),
          fileSize: 1,
        },
        {
          arch: "x86_64",
          os: "linux",
          version: "0.11.0",
          extension: "tar.gz",
          fileShasum: "b".repeat(64),
          fileSize: 2,
        },
      ],
    });

    const response = await env.ZIGTOOLS_BUILDS.get("index.json");
    assert(response !== null);

    const zlsIndex = await response.json<ZLSIndex>();

    expect(zlsIndex).toStrictEqual({
      "0.11.0": {
        date: "2024-10-17",
        "x86_64-linux": {
          tarball: `${env.R2_PUBLIC_URL}/zls-linux-x86_64-0.11.0.tar.xz`,
          shasum: "a".repeat(64),
          size: "1",
        },
      },
    });
  });
});
