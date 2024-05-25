import assert from "node:assert";
import { Buffer } from "node:buffer";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { Env } from "./env";
import {
  D2JsonData,
  ReleaseArtifact,
  xzMagicNumber,
  zipMagicNumber,
} from "./shared";
import { SemanticVersion } from "./semantic-version";

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function checkRequestAuthentication(
  request: Request,
  realm: string,
  expectedUsername: Buffer,
  expectedPassword: Buffer,
): Response | "ok" {
  const authorization = request.headers.get("Authorization");
  if (authorization === null) {
    return new Response("Authorization failed", {
      status: 401, // Unauthorized
      headers: {
        // Prompts the user for credentials.
        "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
      },
    });
  }

  const [scheme, encoded] = authorization.split(" ");

  if (!scheme || !encoded) {
    return new Response(
      "Unexpected Authorization header! Must have the format 'Authorization: <auth-scheme> <authorization-parameters>'",
      {
        status: 400, // Bad Request
      },
    );
  }

  if (scheme !== "Basic") {
    return new Response("Expected 'Basic' authentication scheme!", {
      status: 400, // Bad Request
    });
  }

  const credentials = Buffer.from(encoded, "base64").toString();
  const [actualUsername, actualPassword] = credentials.split(":");

  if (!actualUsername || !actualPassword) {
    return new Response(
      "Unexpected Authorization header! Must have the format 'Authorization: <auth-scheme> <authorization-parameters>'",
      {
        status: 401, // Unauthorized
        headers: {
          // Prompts the user for credentials.
          "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
        },
      },
    );
  }

  if (
    timingSafeEqual(expectedUsername, Buffer.from(actualUsername)) &&
    timingSafeEqual(expectedPassword, Buffer.from(actualPassword))
  ) {
    return "ok";
  }

  return new Response("Authorization failed", {
    status: 401, // Unauthorized
    headers: {
      // Prompts the user for credentials.
      "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
    },
  });
}

function expectSemverFormItem(
  form: FormData,
  name: string,
): [string, SemanticVersion, null] | [null, null, Response] {
  const versionString = form.get(name);

  if (versionString === null) {
    return [
      null,
      null,
      new Response(`Missing form item '${name}'!`, {
        status: 400, // Bad Request
      }),
    ];
  }

  const semver = SemanticVersion.parse(versionString);
  if (semver === null) {
    return [
      null,
      null,
      new Response(
        `form item '${name}' with value '${versionString}' is not a valid version!`,
        {
          status: 400, // Bad Request
        },
      ),
    ];
  }

  return [versionString, semver, null];
}

function stringifyMagicNumber(magicNumber: Uint8Array): string {
  return magicNumber.reduce<string>(
    (previous, current) =>
      previous + (previous.length === 0 ? "" : " ") + current.toString(16),
    "",
  );
}

export async function handlePublish(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method must be 'POST'", {
      status: 405, // Method Not Allowed
    });
  }

  if (typeof env.API_TOKEN !== "string" || !env.API_TOKEN) {
    return new Response(null, {
      status: 500, // Internal Server Error
    });
  }

  const authResponse = checkRequestAuthentication(
    request,
    "admin",
    Buffer.from("admin"),
    Buffer.from(env.API_TOKEN),
  );
  if (authResponse !== "ok") return authResponse;

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    return new Response((e as Error).message, {
      status: 400, // Bad Request
    });
  }

  /** the return type of the `entries` function is not correct because it doesn't include `File` */
  const formEntries = form.entries() as IterableIterator<
    [key: string, value: string | File]
  >;

  const [zlsVersionString, zlsVersion, zlsVersionResponse] =
    expectSemverFormItem(form, "zls-version");
  if (zlsVersionResponse !== null) return zlsVersionResponse;

  const [zigVersionString, zigVersion, zigVersionResponse] =
    expectSemverFormItem(form, "zig-version");
  if (zigVersionResponse !== null) return zigVersionResponse;

  const [
    minBuildZigVersionString,
    minBuildZigVersion,
    minBuildZigVersionResponse,
  ] = expectSemverFormItem(form, "minimum-build-zig-version");
  if (minBuildZigVersionResponse !== null) return minBuildZigVersionResponse;

  const [
    minRuntimeZigVersionString,
    minRuntimeZigVersion,
    minRuntimeZigVersionResponse,
  ] = expectSemverFormItem(form, "minimum-runtime-zig-version");
  if (minRuntimeZigVersionResponse !== null)
    return minRuntimeZigVersionResponse;

  minBuildZigVersion;
  minRuntimeZigVersion;

  if (zlsVersion.isRelease && !zigVersion.isRelease) {
    return new Response(
      `A tagged release of ZLS '${zlsVersionString}' must be build with a tagged release of Zig but got '${zigVersionString}'.`,
      {
        status: 400, // Bad Request
      },
    );
  }

  if (!zlsVersion.isRelease && zlsVersion.patch != 0) {
    // We order development build by their commt height.
    // A new patch resets the commit height and could cause the search algorithm to failed.
    return new Response(
      `Publishing a development build of ZLS ('${zlsVersionString}') where the patch is not 0 is unsupported.`,
      {
        status: 400, // Bad Request
      },
    );
  }

  const artifactRegex = /^zls-(.*?)-(.*?)-(.*)\.(tar\.xz|zip)$/;
  const artifacts: ReleaseArtifact[] = [];
  const artifactFiles: File[] = [];
  const artifactMinisigns: Record<string, File | undefined> = {};

  for (const [key, file] of formEntries) {
    if (key === "zig-version") continue;
    if (key === "zls-version") continue;
    if (key === "minimum-build-zig-version") continue;
    if (key === "minimum-runtime-zig-version") continue;

    if (typeof file === "string") {
      return new Response(`artifact '${key}' must be encoded as a file!`, {
        status: 400, // Bad Request
      });
    }

    if (key !== file.name) {
      return new Response(
        `artifact key '${key}' must match the file name but got '${file.name}'!`,
        {
          status: 400, // Bad Request
        },
      );
    }

    if (file.size === 0) {
      return new Response(`artifact '${key}' can't be empty!`, {
        status: 400, // Bad Request
      });
    }

    if (key.endsWith(".minisign")) {
      assert(artifactMinisigns[key] === undefined); // keys are unique
      artifactMinisigns[key] = file;
      continue;
    }

    const match = key.match(artifactRegex);

    if (match === null) {
      return new Response(`failed to parse artifact '${key}'!`, {
        status: 400, // Bad Request
      });
    }

    const os = match[1];
    const arch = match[2];
    const version = match[3];
    const extension = match[4] as "tar.xz" | "zip";

    assert(key === `zls-${os}-${arch}-${version}.${extension}`);

    // console.log(
    //   `os=${os}, arch=${arch}, version=${version}, extension=${extension}, shasum=${file_hash.digest("hex")}, size=${value.size.toString()}`,
    // );

    if (SemanticVersion.parse(version) === null) {
      return new Response(
        `artifact '${key}' has an invalid version '${version}'!`,
        {
          status: 400, // Bad Request
        },
      );
    }

    const fileHash = createHash("sha256");
    await pipeline(file.stream(), fileHash);

    let expectedMagicNumber: Buffer;
    switch (extension) {
      case "tar.xz":
        expectedMagicNumber = xzMagicNumber;
        break;
      case "zip":
        expectedMagicNumber = zipMagicNumber;
        break;
    }

    const actualMagicNumber: Uint8Array = new Uint8Array(
      await file.slice(0, expectedMagicNumber.byteLength).arrayBuffer(),
    );

    if (!expectedMagicNumber.equals(actualMagicNumber)) {
      return new Response(
        `artifact '${key}' should have the magic number ${stringifyMagicNumber(expectedMagicNumber)} but got ${stringifyMagicNumber(actualMagicNumber)}!`,
        {
          status: 400, // Bad Request
        },
      );
    }

    artifactFiles.push(file);

    artifacts.push({
      os: os,
      arch: arch,
      version: version,
      extension: extension,
      fileShasum: fileHash.digest("hex"),
      fileSize: file.size,
    });
  }
  assert(artifacts.length == artifactFiles.length);

  const artifactHasMinisign = Array<boolean>(artifacts.length).fill(false);

  for (const minisignFileName of Object.keys(artifactMinisigns)) {
    const artifactIndex = artifactFiles.findIndex(
      (file) => `${file.name}.minisign` == minisignFileName,
    );
    if (artifactIndex === -1) {
      return new Response(
        `minisign file '${minisignFileName}' has not matching artifact!`,
        {
          status: 400, // Bad Request
        },
      );
    }
    assert(!artifactHasMinisign[artifactIndex]); // keys are unique
    artifactHasMinisign[artifactIndex] = true;
  }

  if (
    artifactHasMinisign.length !== 0 &&
    !artifactHasMinisign.every((value) => value === artifactHasMinisign[0])
  ) {
    return new Response(
      `Either, every artifact has a minisign file, or none!`,
      {
        status: 400, // Bad Request
      },
    );
  }

  if (zlsVersion.isRelease && artifacts.length === 0) {
    return new Response(`A new tagged release of ZLS must have artifacts!`, {
      status: 400, // Bad Request
    });
  }

  if (zlsVersion.major !== 0) {
    return new Response(`WHAT?!?!?!?!`, {
      status: 418, // I'm a teapot
    });
  }

  if (
    artifacts.length !== 0 &&
    !artifacts.every((artifact) => artifact.version === artifacts[0].version)
  ) {
    return new Response(`all artifacts must have the same version!`, {
      status: 400, // Bad Request
    });
  }

  if (artifacts.length !== 0 && artifacts[0].version != zlsVersionString) {
    return new Response(
      `ZLS version is '${zlsVersionString}' but all artifacts have the version '${artifacts[0].version}'`,
      {
        status: 400, // Bad Request
      },
    );
  }

  const newEntryValue: D2JsonData = {
    date: Date.now(),
    artifacts: artifacts,
    zlsVersion: zlsVersionString,
    zigVersion: zigVersionString,
    minimumBuildZigVersion: minBuildZigVersionString,
    minimumRuntimeZigVersion: minRuntimeZigVersionString,
    minisign: Object.keys(artifactMinisigns).length !== 0,
    testedZigVersion: {},
  };

  if (artifacts.length === 0) {
    const result = await env.ZIGTOOLS_DB.prepare(
      "SELECT * FROM ZLSReleases WHERE ZLSVersion = ?1",
    )
      .bind(zlsVersionString)
      .first();

    if (result === null) {
      return new Response(
        `ZLS version '${zlsVersionString}' is new and has not artifacts. A new ZLS build can't be failed!`,
        {
          status: 400, // Bad Request
        },
      );
    }
  }

  if (!zlsVersion.isRelease && zlsVersion.commitHeight !== undefined) {
    const result = await env.ZIGTOOLS_DB.prepare(
      "SELECT ZLSVersion FROM ZLSReleases WHERE IsRelease = 0 AND ZLSVersionMajor = ?1 AND ZLSVersionMinor = ?2 AND ZLSVersionPatch = ?3 AND ZLSVersionBuildID = ?4",
    )
      .bind(
        zlsVersion.major,
        zlsVersion.minor,
        zlsVersion.patch,
        zlsVersion.commitHeight,
      )
      .first<{ ZLSVersion: string }>();

    if (result !== null && zlsVersionString !== result.ZLSVersion) {
      return new Response(
        `ZLS version is '${zlsVersionString}' can't be published because ZLS '${result.ZLSVersion}' has already been published!`,
        {
          status: 400, // Bad Request
        },
      );
    }
  }

  await env.ZIGTOOLS_DB.batch([
    env.ZIGTOOLS_DB.prepare(
      "INSERT OR IGNORE INTO ZLSReleases VALUES (?1, ?2, ?3, ?4, ?5, ?6, json(?7))",
    ).bind(
      zlsVersionString satisfies string,
      zlsVersion.major satisfies number,
      zlsVersion.minor satisfies number,
      zlsVersion.patch satisfies number,
      (zlsVersion.commitHeight ?? null) satisfies number | null,
      zlsVersion.isRelease satisfies boolean,
      JSON.stringify(newEntryValue satisfies D2JsonData),
    ),
    env.ZIGTOOLS_DB.prepare(
      "UPDATE ZLSReleases SET JsonData = json_patch(JsonData, json(?2)) WHERE ZLSVersion = ?1",
    ).bind(
      zlsVersionString,
      JSON.stringify({
        testedZigVersion: {
          [zigVersionString]: artifacts.length !== 0,
        },
      }),
    ),
  ]);

  const promises: Promise<R2Object>[] = [];

  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];
    const file = artifactFiles[i];
    const minisignFile = artifactMinisigns[`${file.name}.minisign`];

    promises.push(
      env.ZIGTOOLS_BUILDS.put(file.name, file, {
        httpMetadata: {
          cacheControl: "max-age=31536000",
        },
        sha256: artifact.fileShasum,
      }),
    );

    if (minisignFile !== undefined) {
      promises.push(
        env.ZIGTOOLS_BUILDS.put(minisignFile.name, minisignFile, {
          httpMetadata: {
            cacheControl: "max-age=31536000",
          },
        }),
      );
    }
  }

  await Promise.all(promises);

  return new Response(undefined, {
    status: 200, // Ok
  });
}
