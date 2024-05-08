import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { Env } from "./env";
import { D2JsonData, ReleaseArtifact } from "./shared";
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
  if (!authorization) {
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
        `form item '${name}' with value '${versionString}' is not a valid semantic version!`,
        {
          status: 400, // Bad Request
        },
      ),
    ];
  }

  return [versionString, semver, null];
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
    if (e instanceof Error) {
      return new Response(e.message, {
        status: 400, // Bad Request
      });
    } else {
      return new Response(null, {
        status: 400, // Bad Request
      });
    }
  }

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

  const artifactRegex = /^zls-(.*?)-(.*?)-(.*)\.(tar\.xz|zip)$/;
  const artifacts: ReleaseArtifact[] = [];
  const artifact_blobs: Blob[] = [];

  for (const [key, value] of form.entries() as IterableIterator<
    [key: string, value: string | File]
  >) {
    if (key === "zig-version") continue;
    if (key === "zls-version") continue;
    if (key === "minimum-build-zig-version") continue;
    if (key === "minimum-runtime-zig-version") continue;

    if (key.endsWith(".minisign")) {
      return new Response(
        `publishing .minisign files is currently unsupported!`,
        {
          status: 400, // Bad Request
        },
      );
    }

    const match = key.match(artifactRegex);

    if (!match) {
      return new Response(`failed to parse artifact '${key}'!`, {
        status: 400, // Bad Request
      });
    }

    const arch = match[1];
    const os = match[2];
    const version = match[3];
    const extension = match[4] as "tar.xz" | "zip";

    const valueString: string =
      typeof value === "string" ? value : await value.text();
    const shasum = createHash("sha256").update(valueString).digest("hex");
    const size = valueString.length;

    if (!SemanticVersion.parse(version)) {
      return new Response(
        `artifact '${key}' has an invalid semantic version '${version}'!`,
        {
          status: 400, // Bad Request
        },
      );
    }

    // console.log(
    //   `os=${os}, arch=${arch}, version=${version}, extension=${extension}, shasum=${shasum}, size=${size.toString()}`,
    // );

    artifact_blobs.push(typeof value === "string" ? new Blob([value]) : value);

    artifacts.push({
      os: os,
      arch: arch,
      version: version,
      extension: extension,
      file_shasum: shasum,
      file_size: size,
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
    testedZigVersion: {},
  };

  await env.ZIGTOOLS_DB.batch([
    env.ZIGTOOLS_DB.prepare(
      "INSERT OR IGNORE INTO ZLSReleases (ZLSVersion, ZLSVersionMajor, ZLSVersionMinor, ZLSVersionPatch, IsRelease, ZLSVersionBuildID, JsonData) VALUES (?1, ?2, ?3, ?4, ?5, ?6, json(?7))",
    ).bind(
      zlsVersionString,
      zlsVersion.major,
      zlsVersion.minor,
      zlsVersion.patch,
      zlsVersion.isRelease,
      zlsVersion.commitHeight ?? null,
      JSON.stringify(newEntryValue),
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

  await Promise.all(
    artifacts.map((artifact, index) => {
      const key = `zls-${artifact.os}-${artifact.arch}-${artifact.version}.${artifact.extension}`;
      return env.ZIGTOOLS_BUILDS.put(key, artifact_blobs[index]);
    }),
  );

  return new Response(null, {
    status: 200, // Ok
  });
}
