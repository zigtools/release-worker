import { env, SELF } from "cloudflare:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  D2JsonData,
  SQLiteQueryPlanRow,
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
  return await handlePublish(
    new Request("https://example.com/v1/publish", {
      body: form,
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`admin:${env.API_TOKEN}`).toString("base64")}`,
      },
    }),
    env,
  );
}

async function sendPublish({
  zlsVersion,
  zigVersion,
  minimumBuildZigVersion,
  minimumRuntimeZigVersion,
  artifacts,
  withMinisign,
}: {
  zlsVersion: string;
  zigVersion: string;
  minimumBuildZigVersion?: string;
  minimumRuntimeZigVersion?: string;
  artifacts: [fileName: string, file: Blob][];
  withMinisign?: boolean;
}): Promise<Response> {
  const form = new FormData();
  form.set("zls-version", zlsVersion);
  form.set("zig-version", zigVersion);
  form.set("minimum-build-zig-version", minimumBuildZigVersion ?? zigVersion);
  form.set(
    "minimum-runtime-zig-version",
    minimumRuntimeZigVersion ?? zigVersion,
  );
  for (const [fileName, file] of artifacts) {
    form.set(fileName, file, fileName);
    if (withMinisign ?? false) {
      const minisignFileName = `${fileName}.minisign`;
      form.set(
        minisignFileName,
        new Blob([
          "something... signature, something... hash, something... crypto",
        ]),
        minisignFileName,
      );
    }
  }
  return await sendPublishForm(form);
}

describe("/v1/publish", () => {
  test("expect POST method", async () => {
    const response = await SELF.fetch("https://example.com/v1/publish");
    expect(await response.text()).toBe("method must be 'POST'");
    expect(response.status).toBe(405);
  });

  test.each<unknown>([null, "", {}, []])(
    "check for invalid API_TOKEN: %j",
    async (value) => {
      const response = await handlePublish(
        new Request("https://example.com/v1/publish", {
          method: "POST",
        }),
        {
          API_TOKEN: value as string,
          R2_PUBLIC_URL: env.R2_PUBLIC_URL,
          ZIGTOOLS_BUILDS: env.ZIGTOOLS_BUILDS,
          ZIGTOOLS_DB: env.ZIGTOOLS_DB,
        },
      );
      expect(response.status).toBe(500);
    },
  );

  describe("check authorization", () => {
    test("missing Authorization header", async () => {
      const response = await SELF.fetch("https://example.com/v1/publish", {
        method: "POST",
      });

      expect(await response.text()).toBe("Authorization failed");
      expect(response.status).toBe(401);
    });

    test("invalid Authorization header", async () => {
      const response = await SELF.fetch("https://example.com/v1/publish", {
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
      const response = await SELF.fetch("https://example.com/v1/publish", {
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
      const response = await SELF.fetch("https://example.com/v1/publish", {
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
      const response = await SELF.fetch("https://example.com/v1/publish", {
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
      const response = await SELF.fetch("https://example.com/v1/publish", {
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
    ])("test missing %s field", async (fieldName) => {
      const form = new FormData();
      form.set("zls-version", "0.1.0");
      form.set("zig-version", "0.1.0");
      form.set("minimum-build-zig-version", "0.1.0");
      form.set("minimum-runtime-zig-version", "0.1.0");
      form.delete(fieldName);
      const response = await sendPublishForm(form);
      expect(await response.text()).toBe(`Missing form item '${fieldName}'!`);
      expect(response.status).toBe(400);
    });

    test("validate response is empty body", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: [
          [
            `zls-linux-x86_64-0.1.0.tar.xz`,
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
      });

      expect(response.body).toBe(null);
      expect(response.status).toBe(200);
    });

    test.each<[string, "ok" | "bad"]>([
      ["", "bad"],
      ["some string", "bad"],
      ["0.1.0", "ok"],
      ["0.1.0-dev.1+aaaaaaa", "ok"],
    ])("validate ZLS version: %j -> %s", async (zlsVersion, kind) => {
      const response = await sendPublish({
        zlsVersion: zlsVersion,
        zigVersion: "0.1.0",
        artifacts: [
          [
            `zls-linux-x86_64-${zlsVersion}.tar.xz`,
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
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
    ])("validate Zig version: %s -> %s", async (zigVersion, expected) => {
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev.1+aaaaaaaaa",
        zigVersion: zigVersion,
        artifacts: [
          [
            `zls-linux-x86_64-0.1.0-dev.1+aaaaaaaaa.tar.xz`,
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
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

    test.each<["xz" | "zip", Uint8Array, "ok" | "bad"]>([
      ["xz", new Uint8Array(xzMagicNumber), "ok"],
      ["xz", new Uint8Array(zipMagicNumber), "bad"],
      ["xz", new Uint8Array([1, 2, 3, 4]), "bad"],
      ["zip", new Uint8Array(zipMagicNumber), "ok"],
      ["zip", new Uint8Array(xzMagicNumber), "bad"],
      ["zip", new Uint8Array([1, 2, 3, 4]), "bad"],
    ])(
      "validate file magic number: %s %s %s",
      async (extension, body, expected) => {
        const fileName =
          extension == "xz"
            ? "zls-linux-x86_64-0.1.0.tar.xz"
            : "zls-windows-x86_64-0.1.0.zip";
        const response = await sendPublish({
          zlsVersion: "0.1.0",
          zigVersion: "0.1.0",
          artifacts: [[fileName, new Blob([body])]],
        });

        if (expected === "ok") {
          expect(await response.text()).toBe("");
          expect(response.status).toBe(200);
        } else {
          expect(await response.text()).contains(
            `artifact '${fileName}' should have the magic number`,
          );
          expect(response.status).toBe(400);
        }
      },
    );

    test("validate that artifact is a file", async () => {
      const form = new FormData();
      form.set("zls-version", "0.1.0");
      form.set("zig-version", "0.1.0");
      form.set("minimum-build-zig-version", "0.1.0");
      form.set("minimum-runtime-zig-version", "0.1.0");
      form.set("zls-linux-x86_64-0.1.0.tar.xz", "foo");
      const response = await sendPublishForm(form);
      expect(await response.text()).toBe(
        `artifact 'zls-linux-x86_64-0.1.0.tar.xz' must be encoded as a file!`,
      );
      expect(response.status).toBe(400);
    });

    test("validate that artifact file name matches form key", async () => {
      const form = new FormData();
      form.set("zls-version", "0.1.0");
      form.set("zig-version", "0.1.0");
      form.set("minimum-build-zig-version", "0.1.0");
      form.set("minimum-runtime-zig-version", "0.1.0");
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

    test("validate that artifact is not empty", async () => {
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
      ["zls-linux-x86_64-0.1.0.tar.gz", "bad"], // .tar.gz extension not allowed
      ["zls-linux-x86_64-0.2.0.tar.xz", "bad"], // mismatching ZLS version
      ["zls-linux-x86_64-0.1.0-dev.tar.xz", "bad"], // invalid ZLS version
      ["zls-linux-x86_64-0.1.0.tar.xz", "ok"],
      ["zls-windows-aarch64-0.1.0.zip", "ok"],
    ])("validate artifact string: %j -> %s", async (body, expected) => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: [
          [
            body,
            new Blob([
              body.endsWith(".zip") ? zipMagicNumber : xzMagicNumber,
              "binary1",
            ]),
          ],
        ],
      });

      if (expected === "ok") {
        expect(await response.text()).toBe("");
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(400);
      }
    });

    test("validate that all artifacts have the same version", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: [
          [
            "zls-linux-x86_64-0.1.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
          [
            "zls-linux-x86_64-0.2.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
      });
      expect(await response.text()).toBe(
        "all artifacts must have the same version!",
      );
      expect(response.status).toBe(400);
    });

    test("validate that artifact version in file name matches ZLS version", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: [
          [
            "zls-linux-x86_64-0.2.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
      });
      expect(await response.text()).toBe(
        "ZLS version is '0.1.0' but all artifacts have the version '0.2.0'",
      );
      expect(response.status).toBe(400);
    });

    test("validate that zip artifact is on windows", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: [
          ["zls-linux-x86_64-0.2.0.zip", new Blob([zipMagicNumber, "binary1"])],
        ],
      });
      expect(await response.text()).toBe(
        "artifact 'zls-linux-x86_64-0.2.0.zip' is a .zip file but the operating system is 'linux' instead of 'windows'!",
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
      "validate compatibility: ZLS %s Zig %s -> %s",
      async (zlsVersion, zigVersion, expected) => {
        const response = await sendPublish({
          zlsVersion: zlsVersion,
          zigVersion: zigVersion,
          artifacts: [
            [
              `zls-linux-x86_64-${zlsVersion}.tar.xz`,
              new Blob([xzMagicNumber, "binary1"]),
            ],
          ],
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
      artifacts: [
        ["zls-linux-x86_64-0.1.0.tar.xz", new Blob([xzMagicNumber, "binary1"])],
      ],
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
          "zls-windows-aarch64-0.1.0.zip",
          new Blob([zipMagicNumber, "binary2"]),
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
      testedZigVersion: {
        "0.1.1": true,
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
          arch: "aarch64",
          os: "windows",
          version: "0.1.0",
          extension: "zip",
          fileShasum: createHash("sha256")
            .update(zipMagicNumber)
            .update("binary2")
            .digest("hex"),
          fileSize: zipMagicNumber.length + 7,
        },
      ],
    });

    const objects = await env.ZIGTOOLS_BUILDS.list({});

    expect(objects.objects).toMatchObject([
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

    expect(
      Buffer.from(objects.objects[0].checksums.sha256).toString("hex"),
    ).toBe(
      createHash("sha256")
        .update(xzMagicNumber)
        .update("binary1")
        .digest("hex"),
    );
    expect(
      Buffer.from(objects.objects[1].checksums.sha256).toString("hex"),
    ).toBe(
      createHash("sha256")
        .update(zipMagicNumber)
        .update("binary2")
        .digest("hex"),
    );
  });

  test("publish new successfull build with minisign", async () => {
    const date = Date.now();
    vi.setSystemTime(date);

    const response = await sendPublish({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.1",
      artifacts: [
        ["zls-linux-x86_64-0.1.0.tar.xz", new Blob([xzMagicNumber, "binary1"])],
      ],
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
      testedZigVersion: {
        "0.1.1": true,
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
      ],
    });

    const objects = await env.ZIGTOOLS_BUILDS.list({});

    expect(objects.objects).toMatchObject([
      {
        key: "zls-linux-x86_64-0.1.0.tar.xz",
        size: xzMagicNumber.length + 7,
      },
      {
        key: "zls-linux-x86_64-0.1.0.tar.xz.minisign",
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

  test("disallow publishing partial minisigns", async () => {
    const response = await sendPublish({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.0",
      artifacts: [
        [
          "zls-linux-x86_64-0.11.0.tar.xz",
          new Blob([xzMagicNumber, "binary1"]),
        ],
        ["zls-linux-x86_64-0.11.0.tar.xz.minisign", new Blob(["something"])],
        [
          "zls-windows-aarch64-0.11.0.zip",
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
        ["zls-linux-x86_64-0.11.0.tar.xz.minisign", new Blob(["something"])],
      ],
    });

    expect(await response.text()).toBe(
      "minisign file 'zls-linux-x86_64-0.11.0.tar.xz.minisign' has not matching artifact!",
    );
    expect(response.status).toBe(400);
  });

  test("publish builds with mismatching commit hashes", async () => {
    {
      const response = await sendPublish({
        zlsVersion: "0.13.0-dev.1+aaaaaaa",
        zigVersion: "0.12.0",
        artifacts: [
          [
            "zls-linux-x86_64-0.13.0-dev.1+aaaaaaa.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      const response = await sendPublish({
        zlsVersion: "0.13.0-dev.1+bbbbbbb",
        zigVersion: "0.12.0",
        artifacts: [
          [
            "zls-linux-x86_64-0.13.0-dev.1+bbbbbbb.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
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
            "zls-windows-aarch64-0.1.0-dev.1+aaaaaaa.zip",
            new Blob([zipMagicNumber, "binary2"]),
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
            new Blob([xzMagicNumber, "binary3"]),
          ],
          [
            "zls-windows-aarch64-0.1.0-dev.1+aaaaaaa.zip",
            new Blob([zipMagicNumber, "binary4"]),
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
      testedZigVersion: {
        "0.1.1": true,
        "0.1.2": true,
        "0.1.3": false,
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
          arch: "aarch64",
          os: "windows",
          version: "0.1.0-dev.1+aaaaaaa",
          extension: "zip",
          fileShasum: createHash("sha256")
            .update(zipMagicNumber)
            .update("binary2")
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
            new Blob([xzMagicNumber, "binary2"]),
          ],
          [
            "zls-windows-aarch64-0.11.0.zip",
            new Blob([zipMagicNumber, "binary2"]),
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
      testedZigVersion: {
        "0.11.0": true,
        "0.11.1": true,
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
      ],
    });
  });
});
