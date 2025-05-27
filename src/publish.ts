import assert from "node:assert";
import { Buffer } from "node:buffer";
import {
  ArtifactEntry,
  D2JsonData,
  Extension,
  ReleaseArtifact,
  VersionCompatibility,
  ZLSIndex,
  artifactsToRecord,
} from "./shared";
import { SemanticVersion } from "./semantic-version";

export interface PublishRequest {
  zlsVersion: string;
  zigVersion: string;
  minimumBuildZigVersion: string;
  minimumRuntimeZigVersion: string;
  compatibility: VersionCompatibility;
  artifacts: Record<string, ArtifactMetadata>;
}

export interface ArtifactMetadata {
  shasum: string;
  size: number;
}

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

const isObject = (x: unknown): x is object => typeof x == "object" && x != null;

const hasField = <K extends string>(
  x: object,
  key: K,
): x is Record<K, unknown> => key in x;

const isValidArtifactsField = (
  x: object,
): x is Record<string, ArtifactMetadata> =>
  Object.values(x).every(
    (entry) =>
      isObject(entry) &&
      Object.keys(entry).length == 2 &&
      hasField(entry, "shasum") &&
      hasField(entry, "size") &&
      typeof entry.shasum == "string" &&
      typeof entry.size == "number",
  );

function expectSemverField(
  body: object,
  name: string,
): [string, SemanticVersion, null] | [null, null, Response] {
  if (!hasField(body, name)) {
    return [
      null,
      null,
      new Response(`missing request field '${name}'!`, {
        status: 400, // Bad Request
      }),
    ];
  }

  if (typeof body[name] != "string") {
    return [
      null,
      null,
      new Response(`request field '${name}' is not a string!`, {
        status: 400, // Bad Request
      }),
    ];
  }

  const semver = SemanticVersion.parse(body[name]);
  if (semver === null) {
    return [
      null,
      null,
      new Response(
        `request field '${name}' with value '${body[name]}' is not a valid version!`,
        {
          status: 400, // Bad Request
        },
      ),
    ];
  }
  return [body[name], semver, null];
}

export async function handlePublish(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
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

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response((e as Error).message, {
      status: 400, // Bad Request
    });
  }

  if (typeof body !== "object" || body == null) {
    return new Response("request body is not a JSON object!", {
      status: 400, // Bad Request
    });
  }

  const [zlsVersionString, zlsVersion, zlsVersionResponse] = expectSemverField(
    body,
    "zlsVersion",
  );
  if (zlsVersionResponse !== null) return zlsVersionResponse;

  const [zigVersionString, zigVersion, zigVersionResponse] = expectSemverField(
    body,
    "zigVersion",
  );
  if (zigVersionResponse !== null) return zigVersionResponse;

  if (
    !hasField(body, "artifacts") ||
    !isObject(body.artifacts) ||
    !isValidArtifactsField(body.artifacts)
  ) {
    return new Response(`invalid request field 'artifacts'!`, {
      status: 400, // Bad Request
    });
  }
  const artifacts = body.artifacts;

  const [minBuildZigVersionString, , minBuildZigVersionResponse] =
    expectSemverField(body, "minimumBuildZigVersion");
  if (minBuildZigVersionResponse !== null) return minBuildZigVersionResponse;

  const [minRuntimeZigVersionString, , minRuntimeZigVersionResponse] =
    expectSemverField(body, "minimumRuntimeZigVersion");
  if (minRuntimeZigVersionResponse !== null)
    return minRuntimeZigVersionResponse;

  if (!hasField(body, "compatibility")) {
    return new Response(`missing request field 'compatibility'!`, {
      status: 400, // Bad Request
    });
  }
  if (typeof body.compatibility !== "string") {
    return new Response(`request field 'compatibility' is not a string!`, {
      status: 400, // Bad Request
    });
  }

  const validCompatibilityValues = Object.values(
    VersionCompatibility,
  ) as string[];
  if (!validCompatibilityValues.includes(body.compatibility)) {
    return new Response(
      `request field 'compatibility' with value '${body.compatibility}' must be one of ${JSON.stringify(validCompatibilityValues)}!`,
      {
        status: 400, // Bad Request
      },
    );
  }
  const compatibility = body.compatibility as VersionCompatibility;

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

  const artifactRegex = /^zls-(.*?)-(.*?)-(.*)\.(tar\.xz|tar\.gz|zip)$/;
  const releaseArtifacts: ReleaseArtifact[] = [];

  for (const [key, { shasum, size }] of Object.entries(artifacts)) {
    const match = artifactRegex.exec(key);

    if (match === null) {
      return new Response(`failed to parse artifact '${key}'!`, {
        status: 400, // Bad Request
      });
    }

    const os = match[1];
    const arch = match[2];
    const version = match[3];
    const extension = match[4] as Extension;

    assert.strictEqual(key, `zls-${os}-${arch}-${version}.${extension}`);

    if (SemanticVersion.parse(version) === null) {
      return new Response(
        `artifact '${key}' has an invalid version '${version}'!`,
        {
          status: 400, // Bad Request
        },
      );
    }

    if (size == 0) {
      return new Response(`artifact '${key}' can't be empty!`, {
        status: 400, // Bad Request
      });
    }

    if (shasum.length != 64 || Buffer.from(shasum, "hex").length != 32) {
      return new Response(
        `artifact '${key}' has an invalid shasum '${shasum}'`,
        {
          status: 400, // Bad Request
        },
      );
    }

    // console.log(
    //   `os=${os}, arch=${arch}, version=${version}, extension=${extension}, shasum=${shasum}, size=${size.toString()}`,
    // );

    releaseArtifacts.push({
      os: os,
      arch: arch,
      version: version,
      extension: extension,
      fileShasum: shasum,
      fileSize: size,
    });
  }

  /** key is is the artifact file name without the extension */
  const groupedArtifacts: Record<string, ReleaseArtifact[]> = {};

  for (const artifact of releaseArtifacts) {
    const key = `zls-${artifact.os}-${artifact.arch}-${artifact.version}`;
    if (key in groupedArtifacts) {
      groupedArtifacts[key].push(artifact);
    } else {
      groupedArtifacts[key] = [artifact];
    }
  }

  // validate artifact file extensions
  for (const [basename, items] of Object.entries(groupedArtifacts)) {
    assert(items.length > 0);
    const extensions = items.map((artifact) => artifact.extension);

    const expectedExtensions: Extension[] =
      items[0].os === "windows" ? ["zip"] : ["tar.xz", "tar.gz"];

    if (
      extensions.length === expectedExtensions.length &&
      extensions.every((ex) => expectedExtensions.includes(ex)) &&
      expectedExtensions.every((ex) => extensions.includes(ex))
    )
      continue;

    return new Response(
      `artifact extensions of '${basename}.*' must be ${JSON.stringify(expectedExtensions)} but found ${JSON.stringify(extensions)}!`,
      {
        status: 400, // Bad Request
      },
    );
  }

  if (zlsVersion.isRelease && releaseArtifacts.length === 0) {
    return new Response(`A new tagged release of ZLS must have artifacts!`, {
      status: 400, // Bad Request
    });
  }

  if (zlsVersion.major !== 0) {
    return new Response(`WHAT?!?!?!?!`, {
      status: 418, // I'm a teapot
    });
  }

  if (zlsVersion.isRelease && compatibility !== VersionCompatibility.Full) {
    return new Response(
      `A new tagged release of ZLS must have full compatibility but was '${compatibility}'!`,
      {
        status: 400, // Bad Request
      },
    );
  }

  if (
    (releaseArtifacts.length === 0) !=
    (compatibility === VersionCompatibility.None)
  ) {
    return new Response(
      `A ${releaseArtifacts.length === 0 ? "failed" : "successfull"} ZLS build can't have '${compatibility}' as its version compatibility!`,
      {
        status: 400, // Bad Request
      },
    );
  }

  if (
    releaseArtifacts.length !== 0 &&
    !releaseArtifacts.every(
      (artifact) => artifact.version === releaseArtifacts[0].version,
    )
  ) {
    return new Response(`all artifacts must have the same version!`, {
      status: 400, // Bad Request
    });
  }

  if (
    releaseArtifacts.length !== 0 &&
    releaseArtifacts[0].version != zlsVersionString
  ) {
    return new Response(
      `ZLS version is '${zlsVersionString}' but all artifacts have the version '${releaseArtifacts[0].version}'`,
      {
        status: 400, // Bad Request
      },
    );
  }

  const newEntryValue: D2JsonData = {
    date: Date.now(),
    artifacts: releaseArtifacts,
    zlsVersion: zlsVersionString,
    zigVersion: zigVersionString,
    minimumBuildZigVersion: minBuildZigVersionString,
    minimumRuntimeZigVersion: minRuntimeZigVersionString,
    testedZigVersions: {},
  };

  if (releaseArtifacts.length === 0) {
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

  const taggedReleases = await env.ZIGTOOLS_DB.prepare(
    // update the "explain query plan when searching all tagged releases" test when modifying the query
    "SELECT ZLSVersion, JsonData FROM ZLSReleases WHERE IsRelease = 1 ORDER BY ZLSVersionMajor DESC, ZLSVersionMinor DESC, ZLSVersionPatch DESC",
  ).all<{ ZLSVersion: string; JsonData: string }>();

  let artifactsAlreadyExist: boolean;
  if (zlsVersion.isRelease) {
    artifactsAlreadyExist = taggedReleases.results
      .map(({ ZLSVersion }) => ZLSVersion)
      .includes(zlsVersionString);
    if (!artifactsAlreadyExist) {
      taggedReleases.results.push({
        ZLSVersion: zlsVersionString,
        JsonData: JSON.stringify(newEntryValue),
      });
    }
  } else {
    assert(zlsVersion.commitHeight !== undefined);
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

    artifactsAlreadyExist = result !== null;

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
        testedZigVersions: {
          [zigVersionString]: compatibility,
        },
      }),
    ),
  ]);

  if (artifactsAlreadyExist) return new Response();

  const promises: Promise<unknown>[] = [];

  {
    const index: ZLSIndex = {};

    for (const entry of taggedReleases.results) {
      const jsonData = JSON.parse(entry.JsonData) as D2JsonData;
      index[jsonData.zlsVersion] = {
        date: new Date(jsonData.date).toISOString().slice(0, 10),
        ...artifactsToRecord(env.R2_PUBLIC_URL, jsonData.artifacts),
      };
    }

    promises.push(
      env.ZIGTOOLS_BUILDS.put(
        "index.json",
        JSON.stringify(index, undefined, 2),
        {
          httpMetadata: {
            contentType: "application/json",
          },
        },
      ),
    );
  }

  ctx.waitUntil(Promise.all(promises));

  return new Response();
}
