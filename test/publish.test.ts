import { env, SELF } from "cloudflare:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  D2JsonData,
  searchZLSRelease,
  xzMagicNumber,
  zipMagicNumber,
} from "../src/shared";
import { handlePublish } from "../src/publish";

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
}: {
  zlsVersion: string;
  zigVersion: string;
  minimumBuildZigVersion?: string;
  minimumRuntimeZigVersion?: string;
  artifacts: [fileName: string, file: Blob][];
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
  }
  return await sendPublishForm(form);
}

describe("/v1/publish", () => {
  test("expect POST method", async () => {
    const response = await SELF.fetch("https://example.com/v1/publish");
    expect(await response.text()).toBe("method must be 'POST'");
    expect(response.status).toBe(405);
  });

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
    test("missing zls-version", async () => {
      const form = new FormData();
      // form.set("zls-version", "0.1.0");
      form.set("zig-version", "0.1.0");
      const response = await sendPublishForm(form);
      expect(await response.text()).toBe("Missing form item 'zls-version'!");
      expect(response.status).toBe(400);
    });

    test("missing zig-version", async () => {
      const form = new FormData();
      form.set("zls-version", "0.1.0");
      // form.set("zig-version", "0.1.0");
      const response = await sendPublishForm(form);
      expect(await response.text()).toBe("Missing form item 'zig-version'!");
      expect(response.status).toBe(400);
    });

    test.each<[string, "ok" | "bad"]>([
      ["", "bad"],
      ["some string", "bad"],
      ["0.1.0", "ok"],
      ["0.1.0-dev", "ok"],
    ])("validate ZLS version: %j -> %s", async (zlsVersion, kind) => {
      const response = await sendPublish({
        zlsVersion: zlsVersion,
        zigVersion: "0.1.0",
        artifacts: [
          [
            `zls-x86_64-linux-${zlsVersion}.tar.xz`,
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
      });
      if (kind === "ok") {
        expect(await response.text()).toBe("");
        expect(response.status).toBe(200);
      } else {
        expect(await response.text()).toBe(
          `form item 'zls-version' with value '${zlsVersion}' is not a valid semantic version!`,
        );
        expect(response.status).toBe(400);
      }
    });

    test.each<[string, "ok" | "bad"]>([
      ["", "bad"],
      ["some string", "bad"],
      ["0.1.0", "ok"],
      ["0.1.0-dev", "ok"],
    ])("validate Zig version: %s -> %s", async (zigVersion, expected) => {
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev",
        zigVersion: zigVersion,
        artifacts: [
          [
            `zls-x86_64-linux-0.1.0-dev.tar.xz`,
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
      });
      if (expected === "ok") {
        expect(await response.text()).toBe("");
        expect(response.status).toBe(200);
      } else {
        expect(await response.text()).toBe(
          `form item 'zig-version' with value '${zigVersion}' is not a valid semantic version!`,
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
            ? "zls-x86_64-linux-0.1.0.tar.xz"
            : "zls-x86_64-windows-0.1.0.zip";
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

    test("validate file magic number response body", async () => {
      const response = await sendPublish({
        zlsVersion: "0.1.0",
        zigVersion: "0.1.0",
        artifacts: [["zls-x86_64-linux-0.1.0.tar.xz", new Blob(["binary1"])]],
      });
      expect(await response.text()).toBe(
        "artifact 'zls-x86_64-linux-0.1.0.tar.xz' should have the magic number fd 37 7a 58 5a 0 but got 62 69 6e 61 72 79!",
      );
      expect(response.status).toBe(400);
    });

    test.each<[string, "ok" | "bad"]>([
      ["", "bad"],
      ["some string", "bad"],
      ["x86_64-linux-0.1.0.tar.xz", "bad"], // missing 'zls-' prefix
      ["zls-x86_64-linux-0.1.0.gz", "bad"], // .gz extension not allowed
      ["zls-x86_64-linux-0.1.0.tar.gz", "bad"], // .tar.gz extension not allowed
      ["zls-x86_64-linux-0.2.0.tar.xz", "bad"], // mismatching ZLS version
      ["zls-x86_64-linux-0.1.0.tar.xz", "ok"],
      ["zls-aarch64-windows-0.1.0.zip", "ok"],
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

    test.each<[string, string, "ok" | "bad"]>([
      ["0.1.0", "0.1.0", "ok"],
      ["0.1.0", "0.1.1", "ok"],
      ["0.1.1", "0.1.0", "ok"],
      ["0.1.0", "0.1.0-dev", "bad"],
      ["0.1.1-dev", "0.1.0", "bad"],
      ["0.1.0-dev", "0.1.0", "ok"],
      ["0.1.0-dev", "0.1.0-dev", "ok"],
    ])(
      "validate compatibility: ZLS %s Zig %s -> %s",
      async (zlsVersion, zigVersion, expected) => {
        const response = await sendPublish({
          zlsVersion: zlsVersion,
          zigVersion: zigVersion,
          artifacts: [
            [
              `zls-x86_64-linux-${zlsVersion}.tar.xz`,
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

  test("publish new successfull build", async () => {
    const date = Date.now();
    vi.setSystemTime(date);

    const response = await sendPublish({
      zlsVersion: "0.1.0",
      zigVersion: "0.1.1",
      artifacts: [
        ["zls-x86_64-linux-0.1.0.tar.xz", new Blob([xzMagicNumber, "binary1"])],
        [
          "zls-aarch64-windows-0.1.0.zip",
          new Blob([zipMagicNumber, "binary2"]),
        ],
      ],
    });

    expect(await response.text()).toBe("");
    expect(response.status).toBe(200);

    const jsonData = await searchZLSRelease(env, "0.1.0");
    expect(jsonData).toStrictEqual<D2JsonData>({
      date: date,
      zlsVersion: "0.1.0",
      zigVersion: "0.1.1",
      minimumBuildZigVersion: "0.1.1",
      minimumRuntimeZigVersion: "0.1.1",
      testedZigVersion: {
        "0.1.1": true,
      },
      artifacts: [
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0",
          extension: "tar.xz",
          file_shasum: createHash("sha256")
            .update(xzMagicNumber)
            .update("binary1")
            .digest("hex"),
          file_size: xzMagicNumber.length + 7,
        },
        {
          arch: "aarch64",
          os: "windows",
          version: "0.1.0",
          extension: "zip",
          file_shasum: createHash("sha256")
            .update(zipMagicNumber)
            .update("binary2")
            .digest("hex"),
          file_size: zipMagicNumber.length + 7,
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

  test("disallow publishing a failed tagged release", async () => {
    const date = Date.now();
    vi.setSystemTime(date);

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

  test.todo("publish builds with mismatching commit hashes", async () => {
    {
      const response = await sendPublish({
        zlsVersion: "0.11.0",
        zigVersion: "0.11.0",
        artifacts: [
          [
            "zls-x86_64-linux-0.11.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // different Zig version but same file
      const response = await sendPublish({
        zlsVersion: "0.11.0",
        zigVersion: "0.11.1",
        artifacts: [
          [
            "zls-x86_64-linux-0.11.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // same Zig version and same file
      const response = await sendPublish({
        zlsVersion: "0.11.0",
        zigVersion: "0.11.0",
        artifacts: [
          [
            "zls-x86_64-linux-0.11.0.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
        ],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // same Zig version but different file
      const response = await sendPublish({
        zlsVersion: "0.11.0",
        zigVersion: "0.11.0",
        artifacts: [
          [
            "zls-x86_64-linux-0.11.0.tar.xz",
            new Blob([xzMagicNumber, "binary2"]),
          ],
        ],
      });
      expect(await response.text()).toBe("TODO");
      expect(response.status).toBe(400);
    }
  });

  test("publish new successfull build then add failures", async () => {
    const date = Date.now();
    vi.setSystemTime(date);

    {
      // successfull build with Zig 0.1.1
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev",
        zigVersion: "0.1.1",
        artifacts: [
          [
            "zls-x86_64-linux-0.1.0-dev.tar.xz",
            new Blob([xzMagicNumber, "binary1"]),
          ],
          [
            "zls-aarch64-windows-0.1.0-dev.zip",
            new Blob([zipMagicNumber, "binary2"]),
          ],
        ],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    {
      // successfull build with 0.1.2
      const response = await sendPublish({
        zlsVersion: "0.1.0-dev",
        zigVersion: "0.1.2",
        artifacts: [
          [
            "zls-x86_64-linux-0.1.0-dev.tar.xz",
            new Blob([xzMagicNumber, "binary3"]),
          ],
          [
            "zls-aarch64-windows-0.1.0-dev.zip",
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
        zlsVersion: "0.1.0-dev",
        zigVersion: "0.1.3",
        artifacts: [],
      });
      expect(await response.text()).toBe("");
      expect(response.status).toBe(200);
    }

    const jsonData = await searchZLSRelease(env, "0.1.0-dev");
    expect(jsonData).toStrictEqual<D2JsonData>({
      date: date,
      zlsVersion: "0.1.0-dev",
      zigVersion: "0.1.1",
      minimumBuildZigVersion: "0.1.1",
      minimumRuntimeZigVersion: "0.1.1",
      testedZigVersion: {
        "0.1.1": true,
        "0.1.2": true,
        "0.1.3": false,
      },
      artifacts: [
        {
          arch: "x86_64",
          os: "linux",
          version: "0.1.0-dev",
          extension: "tar.xz",
          file_shasum: createHash("sha256")
            .update(xzMagicNumber)
            .update("binary1")
            .digest("hex"),
          file_size: xzMagicNumber.byteLength + 7,
        },
        {
          arch: "aarch64",
          os: "windows",
          version: "0.1.0-dev",
          extension: "zip",
          file_shasum: createHash("sha256")
            .update(zipMagicNumber)
            .update("binary2")
            .digest("hex"),
          file_size: zipMagicNumber.byteLength + 7,
        },
      ],
    });
  });
});
