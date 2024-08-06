import { env, SELF } from "cloudflare:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  D2JsonData,
  Extension,
  getMagicNumberOfExtension,
  gzipMagicNumber,
  SQLiteQueryPlanRow,
  VersionCompatibility,
  xzMagicNumber,
  zipMagicNumber,
} from "../src/shared";
import { handlePublish } from "../src/publish";

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

async function sendPublishForm(form: FormData): Promise<Response> {
  assert(typeof env.API_TOKEN === "string" && env.API_TOKEN);
  return await SELF.fetch(
    new Request("https://example.com/v1/zls/publish", {
      body: form,
      method: "POST",
      headers: {
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
  withMinisign,
}: {
  zlsVersion: string;
  zigVersion: string;
  minimumBuildZigVersion?: string;
  minimumRuntimeZigVersion?: string;
  compatibility?: VersionCompatibility;
  artifacts: [fileName: string, file: Blob][];
  withMinisign?: boolean;
}): Promise<Response> {
  const form = initPublishForm({
    zlsVersion,
    zigVersion,
    minimumBuildZigVersion,
    minimumRuntimeZigVersion,
    compatibility,
    artifacts,
    withMinisign,
  });
  return await sendPublishForm(form);
}

function initPublishForm({
  zlsVersion,
  zigVersion,
  minimumBuildZigVersion,
  minimumRuntimeZigVersion,
  compatibility,
  artifacts,
  withMinisign,
}: {
  zlsVersion: string;
  zigVersion: string;
  minimumBuildZigVersion?: string;
  minimumRuntimeZigVersion?: string;
  compatibility?: VersionCompatibility;
  artifacts: [fileName: string, file: Blob][];
  withMinisign?: boolean;
}): FormData {
  const form = new FormData();
  form.set("zls-version", zlsVersion);
  form.set("zig-version", zigVersion);
  form.set("minimum-build-zig-version", minimumBuildZigVersion ?? zigVersion);
  form.set(
    "minimum-runtime-zig-version",
    minimumRuntimeZigVersion ?? zigVersion,
  );
  form.set(
    "compatibility",
    compatibility ??
      (artifacts.length === 0
        ? VersionCompatibility.None
        : VersionCompatibility.Full),
  );
  for (const [fileName, file] of artifacts) {
    assert(!form.has(fileName));
    form.set(fileName, file, fileName);
    if (withMinisign ?? false) {
      const minisignFileName = `${fileName}.minisig`;
      assert(!form.has(minisignFileName));
      form.set(
        minisignFileName,
        new Blob([
          "something... signature, something... hash, something... crypto",
        ]),
        minisignFileName,
      );
    }
  }
  return form;
}

function getSampleArtifacts(
  zlsVersion: string,
): [fileName: string, file: Blob][] {
  return [
    [
      `zls-linux-x86_64-${zlsVersion}.tar.xz`,
      new Blob([xzMagicNumber, "binary1"]),
    ],
    [
      `zls-linux-x86_64-${zlsVersion}.tar.gz`,
      new Blob([gzipMagicNumber, "binary2"]),
    ],
  ];
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
    test.each<string>([
      "zig-version",
      "zls-version",
      "minimum-build-zig-version",
      "minimum-runtime-zig-version",
      "compatibility",
    ])("missing '%s' field", async (fieldName) => {
      const form = new FormData();
      form.set("zls-version", "0.1.0");
      form.set("zig-version", "0.1.0");
      form.set("minimum-build-zig-version", "0.1.0");
      form.set("minimum-runtime-zig-version", "0.1.0");
      form.set("compatibility", VersionCompatibility.Full);
      form.delete(fieldName);
      const response = await sendPublishForm(form);
      expect(await response.text()).toBe(`Missing form item '${fieldName}'!`);
      expect(response.status).toBe(400);
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
          `form item 'zls-version' with value '${zlsVersion}' is not a valid version!`,
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
          `form item 'zig-version' with value '${zigVersion}' is not a valid version!`,
        );
        expect(response.status).toBe(400);
      }
    });

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
              : [],
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

    test.each<[Extension, Uint8Array, "ok" | "bad"]>([
      ["tar.xz", new Uint8Array(xzMagicNumber), "ok"],
      ["tar.xz", new Uint8Array(gzipMagicNumber), "bad"],
      ["tar.xz", new Uint8Array(zipMagicNumber), "bad"],
      ["tar.xz", new Uint8Array([1, 2, 3, 4]), "bad"],

      ["tar.gz", new Uint8Array(gzipMagicNumber), "ok"],
      ["tar.gz", new Uint8Array(xzMagicNumber), "bad"],
      ["tar.gz", new Uint8Array(zipMagicNumber), "bad"],
      ["tar.gz", new Uint8Array([1, 2, 3, 4]), "bad"],

      ["zip", new Uint8Array(zipMagicNumber), "ok"],
      ["zip", new Uint8Array(xzMagicNumber), "bad"],
      ["zip", new Uint8Array(gzipMagicNumber), "bad"],
      ["zip", new Uint8Array([1, 2, 3, 4]), "bad"],
    ])(
      "file magic number: '%s' %s -> %s",
      async (extension, body, expected) => {
        let artifacts: [fileName: string, file: Blob][];
        switch (extension) {
          case "tar.xz":
            artifacts = [
              ["zls-linux-x86_64-0.1.0.tar.xz", new Blob([body])],
              [
                "zls-linux-x86_64-0.1.0.tar.gz",
                new Blob([gzipMagicNumber, "binary1"]),
              ],
            ];
            break;
          case "tar.gz":
            artifacts = [
              [
                "zls-linux-x86_64-0.1.0.tar.xz",
                new Blob([xzMagicNumber, "binary1"]),
              ],
              ["zls-linux-x86_64-0.1.0.tar.gz", new Blob([body])],
            ];
            break;
          case "zip":
            artifacts = [["zls-windows-x86_64-0.1.0.zip", new Blob([body])]];
            break;
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
          expect(await response.text()).contains(
            `should have the magic number`,
          );
          expect(response.status).toBe(400);
        }
      },
    );

    test("artifact should be a file", async () => {
      const form = new FormData();
      form.set("zls-version", "0.1.0");
      form.set("zig-version", "0.1.0");
      form.set("minimum-build-zig-version", "0.1.0");
      form.set("minimum-runtime-zig-version", "0.1.0");
      form.set("compatibility", VersionCompatibility.Full);
      form.set("zls-linux-x86_64-0.1.0.tar.xz", "foo");
      const response = await sendPublishForm(form);
      expect(await response.text()).toBe(
        `artifact 'zls-linux-x86_64-0.1.0.tar.xz' must be encoded as a file!`,
      );
      expect(response.status).toBe(400);
    });

    test("artifact file name should match form key", async () => {
      const form = new FormData();
      form.set("zls-version", "0.1.0");
      form.set("zig-version", "0.1.0");
      form.set("minimum-build-zig-version", "0.1.0");
      form.set("minimum-runtime-zig-version", "0.1.0");
      form.set("compatibility", VersionCompatibility.Full);
      form.set(
        "zls-linux-x86_64-0.1.0.tar.xz",
        new Blob([xzMagicNumber, "foo"]),
        "zls-windows-aarch64-0.1.0.zip",
      );
      const response = await sendPublishForm(form);
      expect(await response.text()).toBe(
        `artifact key 'zls-linux-x86_64-0.1.0.tar.xz' must match the file name but got 'zls-windows-aarch64-0.1.0.zip'!`,
      );
      expect(response.status).toBe(400);
    });

    test("artifact should not be empty", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: [["zls-linux-x86_64-0.1.0.tar.xz", new Blob()]],
      });
      expect(await response.text()).toBe(
        "artifact 'zls-linux-x86_64-0.1.0.tar.xz' can't be empty!",
      );
      expect(response.status).toBe(400);
    });

    test("validate file magic number response body", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: [["zls-linux-x86_64-0.1.0.tar.xz", new Blob(["binary1"])]],
      });
      expect(await response.text()).toBe(
        "artifact 'zls-linux-x86_64-0.1.0.tar.xz' should have the magic number fd 37 7a 58 5a 0 but got 62 69 6e 61 72 79!",
      );
      expect(response.status).toBe(400);
    });

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
      let artifacts: [fileName: string, file: Blob][];
      if (filename.endsWith("zip")) {
        artifacts = [[filename, new Blob([zipMagicNumber, "binary1"])]];
      } else {
        artifacts = [
          [
            filename.endsWith("xz")
              ? filename
              : "zls-linux-x86_64-0.1.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
          [
            filename.endsWith("xz")
              ? "zls-linux-x86_64-0.1.0.tar.gz"
              : filename,
            new Blob([gzipMagicNumber, "binary1"]),
          ],
        ];
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
        artifacts: [
          [
            "zls-linux-x86_64-0.1.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
          [
            "zls-linux-x86_64-0.1.0.tar.gz",
            new Blob([gzipMagicNumber, "binary2"]),
          ],
          [
            "zls-windows-x86_64-0.2.0.zip",
            new Blob([zipMagicNumber, "binary3"]),
          ],
        ],
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
        artifacts: [
          ["zls-linux-x86_64-0.1.0.zip", new Blob([zipMagicNumber, "binary1"])],
        ],
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
        artifacts: [
          [
            "zls-windows-x86_64-0.1.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
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
      const artifacts: [fileName: string, file: Blob][] = [];
      for (const extension of extensions) {
        artifacts.push([
          `zls-linux-x86_64-0.1.0.${extension}`,
          new Blob([getMagicNumberOfExtension(extension), "binary1"]),
        ]);
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
        artifacts: [
          ["zls-linux-x86_64-0.1.0.zip", new Blob([zipMagicNumber, "binary1"])],
        ],
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
      artifacts: [
        ["zls-linux-x86_64-0.1.0.tar.xz", new Blob([xzMagicNumber, "binary1"])],
        [
          "zls-linux-x86_64-0.1.0.tar.gz",
          new Blob([gzipMagicNumber, "binary2"]),
        ],
        [
          "zls-windows-aarch64-0.1.0.zip",
          new Blob([zipMagicNumber, "binary3"]),
        ],
      ],
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
      minisign: false,
      testedZigVersions: {
        "0.1.1": VersionCompatibility.Full,
      },
      artifacts: [
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0",
          extension: "tar.xz",
          fileShasum: createHash("sha256")
            .update(xzMagicNumber)
            .update("binary1")
            .digest("hex"),
          fileSize: xzMagicNumber.length + 7,
        },
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0",
          extension: "tar.gz",
          fileShasum: createHash("sha256")
            .update(gzipMagicNumber)
            .update("binary2")
            .digest("hex"),
          fileSize: gzipMagicNumber.length + 7,
        },
        {
          arch: "aarch64",
          os: "windows",
          version: "0.1.0",
          extension: "zip",
          fileShasum: createHash("sha256")
            .update(zipMagicNumber)
            .update("binary3")
            .digest("hex"),
          fileSize: zipMagicNumber.length + 7,
        },
      ],
    });

    const objects = await env.ZIGTOOLS_BUILDS.list({});

    expect(objects.objects).toMatchObject([
      {
        key: "zls-linux-x86_64-0.1.0.tar.gz",
        size: gzipMagicNumber.length + 7,
      },
      {
        key: "zls-linux-x86_64-0.1.0.tar.xz",
        size: xzMagicNumber.length + 7,
      },
      {
        key: "zls-windows-aarch64-0.1.0.zip",
        size: zipMagicNumber.length + 7,
      },
    ]);

    assert(objects.objects[0].checksums.sha256 !== undefined);
    assert(objects.objects[1].checksums.sha256 !== undefined);
    assert(objects.objects[2].checksums.sha256 !== undefined);

    expect(
      Buffer.from(objects.objects[0].checksums.sha256).toString("hex"),
    ).toBe(
      createHash("sha256")
        .update(gzipMagicNumber)
        .update("binary2")
        .digest("hex"),
    );
    expect(
      Buffer.from(objects.objects[1].checksums.sha256).toString("hex"),
    ).toBe(
      createHash("sha256")
        .update(xzMagicNumber)
        .update("binary1")
        .digest("hex"),
    );
    expect(
      Buffer.from(objects.objects[2].checksums.sha256).toString("hex"),
    ).toBe(
      createHash("sha256")
        .update(zipMagicNumber)
        .update("binary3")
        .digest("hex"),
    );
  });

  test("publish new successfull build with minisign", async () => {
    const date = Date.now();
    vi.setSystemTime(date);

    const response = await sendPublish({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.1",
      artifacts: getSampleArtifacts("0.1.0"),
      withMinisign: true,
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
      minisign: true,
      testedZigVersions: {
        "0.1.1": VersionCompatibility.Full,
      },
      artifacts: [
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0",
          extension: "tar.xz",
          fileShasum: createHash("sha256")
            .update(xzMagicNumber)
            .update("binary1")
            .digest("hex"),
          fileSize: xzMagicNumber.length + 7,
        },
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0",
          extension: "tar.gz",
          fileShasum: createHash("sha256")
            .update(gzipMagicNumber)
            .update("binary2")
            .digest("hex"),
          fileSize: gzipMagicNumber.length + 7,
        },
      ],
    });

    const objects = await env.ZIGTOOLS_BUILDS.list({});

    expect(objects.objects).toMatchObject([
      {
        key: "zls-linux-x86_64-0.1.0.tar.gz",
        size: gzipMagicNumber.length + 7,
      },
      {
        key: "zls-linux-x86_64-0.1.0.tar.gz.minisig",
      },
      {
        key: "zls-linux-x86_64-0.1.0.tar.xz",
        size: xzMagicNumber.length + 7,
      },
      {
        key: "zls-linux-x86_64-0.1.0.tar.xz.minisig",
      },
    ]);
  });

  test("disallow publishing a failed tagged release", async () => {
    const response = await sendPublish({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.0",
      artifacts: [],
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
      artifacts: [],
    });

    expect(await response.text()).toBe(
      "ZLS version '0.1.0-dev.1+aaaaaaa' is new and has not artifacts. A new ZLS build can't be failed!",
    );
    expect(response.status).toBe(400);
  });

  test("FORCE_MINISIGN with missing minisign file", async () => {
    const form = initPublishForm({
      zlsVersion: "0.1.0-dev.1+aaaaaaa",
      zigVersion: "0.1.0",
      artifacts: [
        [
          "zls-windows-aarch64-0.1.0.zip",
          new Blob([zipMagicNumber, "binary2"]),
        ],
      ],
    });

    const response = await handlePublish(
      new Request("https://example.com/v1/zls/publish", {
        body: form,
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`admin:${env.API_TOKEN}`).toString("base64")}`,
        },
      }),
      {
        ...env,
        FORCE_MINISIGN: "1",
      },
    );

    expect(await response.text()).toBe(
      "Every artifact must have a minisign file!",
    );
    expect(response.status).toBe(400);
  });

  test("FORCE_MINISIGN with all minisign file", async () => {
    const form = initPublishForm({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.0",
      artifacts: [
        ["zls-windows-x86_64-0.1.0.zip", new Blob([zipMagicNumber, "binary2"])],
        ["zls-windows-x86_64-0.1.0.zip.minisig", new Blob(["something"])],
      ],
    });

    const response = await handlePublish(
      new Request("https://example.com/v1/zls/publish", {
        body: form,
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`admin:${env.API_TOKEN}`).toString("base64")}`,
        },
      }),
      {
        ...env,
        FORCE_MINISIGN: "1",
      },
    );

    expect(await response.text()).toBe("");
    expect(response.status).toBe(200);
  });

  test("disallow publishing partial minisigns", async () => {
    const response = await sendPublish({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.0",
      artifacts: [
        ["zls-linux-x86_64-0.1.0.tar.xz", new Blob([xzMagicNumber, "binary1"])],
        ["zls-linux-x86_64-0.1.0.tar.xz.minisig", new Blob(["something"])],
        [
          "zls-linux-x86_64-0.1.0.tar.gz",
          new Blob([gzipMagicNumber, "binary1"]),
        ],
        ["zls-linux-x86_64-0.1.0.tar.gz.minisig", new Blob(["something"])],
        [
          "zls-windows-aarch64-0.1.0.zip",
          new Blob([zipMagicNumber, "binary2"]),
        ],
      ],
    });

    expect(await response.text()).toBe(
      "Either, every artifact has a minisign file, or none!",
    );
    expect(response.status).toBe(400);
  });

  test("publish unknown minisign", async () => {
    const response = await sendPublish({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.0",
      artifacts: [
        ["zls-linux-x86_64-0.1.0.tar.xz.minisig", new Blob(["something"])],
      ],
    });

    expect(await response.text()).toBe(
      "minisign file 'zls-linux-x86_64-0.1.0.tar.xz.minisig' has not matching artifact!",
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
        notused: 0,
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
        artifacts: [
          [
            "zls-linux-x86_64-0.1.0-dev.1+aaaaaaa.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
          [
            "zls-linux-x86_64-0.1.0-dev.1+aaaaaaa.tar.gz",
            new Blob([gzipMagicNumber, "binary2"]),
          ],
          [
            "zls-windows-aarch64-0.1.0-dev.1+aaaaaaa.zip",
            new Blob([zipMagicNumber, "binary3"]),
          ],
        ],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // failed build with 0.1.2
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev.1+aaaaaaa",
        zigVersion: "0.1.2",
        artifacts: [],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // successfull build with 0.1.2
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev.1+aaaaaaa",
        zigVersion: "0.1.2",
        artifacts: [
          [
            "zls-linux-x86_64-0.1.0-dev.1+aaaaaaa.tar.xz",
            new Blob([xzMagicNumber, "binary4"]),
          ],
          [
            "zls-linux-x86_64-0.1.0-dev.1+aaaaaaa.tar.gz",
            new Blob([gzipMagicNumber, "binary5"]),
          ],
          [
            "zls-windows-aarch64-0.1.0-dev.1+aaaaaaa.zip",
            new Blob([zipMagicNumber, "binary6"]),
          ],
        ],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // failed build with 0.1.3
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev.1+aaaaaaa",
        zigVersion: "0.1.3",
        artifacts: [],
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
      minisign: false,
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
          fileShasum: createHash("sha256")
            .update(xzMagicNumber)
            .update("binary1")
            .digest("hex"),
          fileSize: xzMagicNumber.byteLength + 7,
        },
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0-dev.1+aaaaaaa",
          extension: "tar.gz",
          fileShasum: createHash("sha256")
            .update(gzipMagicNumber)
            .update("binary2")
            .digest("hex"),
          fileSize: gzipMagicNumber.byteLength + 7,
        },
        {
          arch: "aarch64",
          os: "windows",
          version: "0.1.0-dev.1+aaaaaaa",
          extension: "zip",
          fileShasum: createHash("sha256")
            .update(zipMagicNumber)
            .update("binary3")
            .digest("hex"),
          fileSize: zipMagicNumber.byteLength + 7,
        },
      ],
    });
  });

  test("publish new successfull build with different Zig versions", async () => {
    const date = Date.now();
    vi.setSystemTime(date);

    {
      const response = await sendPublish({
        zlsVersion: "0.11.0",
        zigVersion: "0.11.0",
        artifacts: [
          [
            "zls-linux-x86_64-0.11.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
          [
            "zls-linux-x86_64-0.11.0.tar.gz",
            new Blob([gzipMagicNumber, "binary2"]),
          ],
        ],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      const response = await sendPublish({
        zlsVersion: "0.11.0",
        zigVersion: "0.11.1",
        artifacts: [
          [
            "zls-linux-x86_64-0.11.0.tar.xz",
            new Blob([xzMagicNumber, "binary3"]),
          ],
          [
            "zls-linux-x86_64-0.11.0.tar.gz",
            new Blob([gzipMagicNumber, "binary4"]),
          ],
          [
            "zls-windows-aarch64-0.11.0.zip",
            new Blob([zipMagicNumber, "binary5"]),
          ],
        ],
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
      minisign: false,
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
          fileShasum: createHash("sha256")
            .update(xzMagicNumber)
            .update("binary1")
            .digest("hex"),
          fileSize: xzMagicNumber.byteLength + 7,
        },
        {
          arch: "x86_64",
          os: "linux",
          version: "0.11.0",
          extension: "tar.gz",
          fileShasum: createHash("sha256")
            .update(gzipMagicNumber)
            .update("binary2")
            .digest("hex"),
          fileSize: gzipMagicNumber.byteLength + 7,
        },
      ],
    });

    const objects = await env.ZIGTOOLS_BUILDS.list({});

    expect(objects.objects).toMatchObject([
      {
        key: "zls-linux-x86_64-0.11.0.tar.gz",
        size: gzipMagicNumber.length + 7,
      },
      {
        key: "zls-linux-x86_64-0.11.0.tar.xz",
        size: xzMagicNumber.length + 7,
      },
    ]);

    assert(objects.objects[0].checksums.sha256 !== undefined);
    assert(objects.objects[1].checksums.sha256 !== undefined);

    expect(
      Buffer.from(objects.objects[0].checksums.sha256).toString("hex"),
    ).toBe(
      createHash("sha256")
        .update(gzipMagicNumber)
        .update("binary2")
        .digest("hex"),
    );
    expect(
      Buffer.from(objects.objects[1].checksums.sha256).toString("hex"),
    ).toBe(
      createHash("sha256")
        .update(xzMagicNumber)
        .update("binary1")
        .digest("hex"),
    );
  });
});
