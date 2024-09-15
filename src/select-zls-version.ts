import assert from "node:assert";
import { Env } from "./env";
import { Order, SemanticVersion } from "./semantic-version";
import { D2JsonData, ReleaseArtifact, VersionCompatibility } from "./shared";

/**
 * Similar to https://ziglang.org/download/index.json
 */
export interface SelectVersionResponse {
  /** The ZLS version */
  version: string;
  /** `YYYY-MM-DD` */
  date: string;
  [artifact: string]: ArtifactEntry | string | undefined;
}

export interface SelectVersionFailureResponse {
  /**
   * The `code` **may** be one of `SelectVersionFailureCode`. Be aware that new
   * codes can be added over time.
   */
  code: number;
  /** A simplified explanation of why no ZLS build could be selected */
  message: string;
}

/**
 * See `selectZLSVersionFailureCodeToString` for how these codes are converted to messages.
 *
 * KEEP IN SYNC WITH README.md
 */
export enum SelectVersionFailureCode {
  /**
   * This error *should* only occur when specifying a very old Zig version like
   * `0.8.0`. Please open an issue when encounting this error on recent Zig
   * versions.
   */
  Unsupported = 0,
  /**
   * The most common scenario for this error is after Zig has tagged a new
   * release but ZLS hasn't updated yet.
   *
   * Let's say that Zig `0.12.0` has been released but ZLS not yet released ZLS
   * `0.12.0`. ZLS's latest build is therefore a `0.12.0-dev` build.
   * A request with `?zig_version=0.13.0-dev` will error because there is no ZLS
   * `0.12.*` or ZLS `0.13.0-dev` builds.
   *
   * Version Order Guide: `0.12.0-dev` < `0.12.0` < `0.13.0-dev` < `0.13.0`
   *
   * This error only occurs on development/nightly builds of Zig.
   */
  DevelopmentBuildUnsupported = 1,
  /**
   * The version selection algorithm has identified the given Zig version as
   * incompatible with any available ZLS build. When encountering this error on
   * the latest Zig master version, it usually means that a breaking change
   * occured that needs ZLS to be updated.
   *
   * This error only occurs on development/nightly builds of Zig.
   */
  DevelopmentBuildIncompatible = 2,
  /**
   * This error only occurs on tagged releases of Zig.
   */
  TaggedReleaseIncompatible = 3,
}

function selectZLSVersionFailureCodeToString(
  code: SelectVersionFailureCode,
  zigVersion: SemanticVersion,
): string {
  switch (code) {
    case SelectVersionFailureCode.Unsupported:
      return `Zig ${zigVersion.toString()} is not supported by ZLS`;
    case SelectVersionFailureCode.DevelopmentBuildUnsupported:
      return `No builds for the ${zigVersion.major.toString()}.${zigVersion.minor.toString()} release cycle are currently available`;
    case SelectVersionFailureCode.DevelopmentBuildIncompatible:
      return `Zig ${zigVersion.toString()} has no compatible ZLS build (yet)`;
    case SelectVersionFailureCode.TaggedReleaseIncompatible:
      return `ZLS ${zigVersion.major.toString()}.${zigVersion.minor.toString()} has not been released yet`;
  }
}

/**
 * Similar to https://ziglang.org/download/index.json
 */
export type ZLSIndexResponse = Record<
  string,
  {
    /** `YYYY-MM-DD` */
    date: string;
    [artifact: string]: ArtifactEntry | string | undefined;
  }
>;

export interface ArtifactEntry {
  /** A download URL */
  tarball: string;
  /** A SHA256 hash of the tarball */
  shasum: string;
  /** Size of the tarball in bytes */
  size: string;
}

function artifactsToRecord(
  env: Env,
  artifacts: ReleaseArtifact[],
): Record<string, ArtifactEntry> {
  assert(artifacts.length !== 0);
  const targets: Record<string, ArtifactEntry> = {};
  for (const artifact of artifacts) {
    switch (artifact.extension) {
      case "tar.gz":
        continue;
      case "tar.xz":
      case "zip":
        break;
    }
    assert(!(`${artifact.arch}-${artifact.os}` in targets));
    assert.strictEqual(artifact.fileShasum.length, 64);
    targets[`${artifact.arch}-${artifact.os}`] = {
      tarball: `${env.R2_PUBLIC_URL}/zls-${artifact.os}-${artifact.arch}-${artifact.version}.${artifact.extension}`,
      shasum: artifact.fileShasum,
      size: artifact.fileSize.toString(),
    };
  }
  return targets;
}

function failure(status: number, message: string): Response {
  return Response.json(
    {
      error: message,
    },
    {
      status: status,
    },
  );
}

/** `${ENDPOINT}/zls/index.json` */
export async function handleZLSIndex(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return failure(405, "method must be 'GET'"); // Method Not Allowed
  }

  if (typeof env.R2_PUBLIC_URL !== "string" || !env.R2_PUBLIC_URL) {
    return failure(500, "Internal Server Error"); // Internal Server Error
  }

  const releases = await env.ZIGTOOLS_DB.prepare(
    // update the "explain query plan when searching all tagged releases" test when modifying the query
    "SELECT JsonData FROM ZLSReleases WHERE IsRelease = 1 ORDER BY ZLSVersionMajor DESC, ZLSVersionMinor DESC, ZLSVersionPatch DESC",
  ).all<{ JsonData: string }>();

  const response: ZLSIndexResponse = {};

  for (const entry of releases.results) {
    const jsonData = JSON.parse(entry.JsonData) as D2JsonData;
    response[jsonData.zlsVersion] = {
      date: new Date(jsonData.date).toISOString().slice(0, 10),
      ...artifactsToRecord(env, jsonData.artifacts),
    };
  }

  return Response.json(response, {
    headers: {
      "cache-control": "public, max-age=3600", // 1 hour
    },
  });
}

/** `${ENDPOINT}/zls/select-version?zig_version=0.12.0&compatibility=full` */
export async function handleSelectVersion(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return failure(405, "method must be 'GET'"); // Method Not Allowed
  }

  if (typeof env.R2_PUBLIC_URL !== "string" || !env.R2_PUBLIC_URL) {
    return failure(500, "Internal Server Error"); // Internal Server Error
  }

  const url = new URL(request.url);

  const zigVersionString = url.searchParams.get("zig_version");

  if (zigVersionString === null) {
    return failure(400, `Expected query component 'zig_version'!`); // Bad Request
  }

  const zigVersion = SemanticVersion.parse(zigVersionString);

  if (zigVersion === null) {
    return failure(
      400, // Bad Request
      `Query component 'zig_version' with value '${zigVersionString}' is not a valid version!`,
    );
  }

  const compatibility = url.searchParams.get(
    "compatibility",
  ) as VersionCompatibility | null;

  if (compatibility === null) {
    return failure(400, `Expected query component 'compatibility'!`); // Bad Request
  }

  assert(Object.values(VersionCompatibility)[0] === VersionCompatibility.None);
  const validCompatibilityValues = Object.values(VersionCompatibility).slice(1);
  if (!validCompatibilityValues.includes(compatibility)) {
    return failure(
      400, // Bad Request
      `form item 'compatibility' with value '${compatibility}' must be one of ${JSON.stringify(validCompatibilityValues)}!`,
    );
  }
  assert(compatibility !== VersionCompatibility.None);

  const result = zigVersion.isRelease
    ? await selectOnTaggedRelease(env, zigVersion)
    : await selectOnDevelopmentBuild(env, zigVersion, compatibility);

  let response: SelectVersionResponse | SelectVersionFailureResponse;

  if (typeof result === "number") {
    const code: SelectVersionFailureCode = result;
    response = {
      code: code,
      message: selectZLSVersionFailureCodeToString(code, zigVersion),
    };
  } else {
    const selectedVersion: D2JsonData = result;
    response = {
      version: selectedVersion.zlsVersion,
      date: new Date(selectedVersion.date).toISOString().slice(0, 10),
      ...artifactsToRecord(env, selectedVersion.artifacts),
    };
  }

  return Response.json(response, {
    headers: {
      "cache-control": zigVersion.isRelease
        ? "public, max-age=3600" // 1 hour
        : "public, max-age=300", // 5 minutes
    },
  });
}

async function selectOnTaggedRelease(
  env: Env,
  zigVersion: SemanticVersion,
): Promise<D2JsonData | SelectVersionFailureCode> {
  assert(zigVersion.isRelease);

  const selectedRelease = await env.ZIGTOOLS_DB.prepare(
    // update the "explain query plan when searching on tagged release (sorted)" test when modifying the query
    "SELECT JsonData FROM ZLSReleases WHERE IsRelease = 1 AND ZLSVersionMajor = ?1 AND ZLSVersionMinor = ?2 ORDER BY ZLSVersionPatch DESC",
  )
    .bind(zigVersion.major, zigVersion.minor)
    .first<{ JsonData: string }>();

  if (selectedRelease !== null) {
    return JSON.parse(selectedRelease.JsonData) as D2JsonData;
  }

  // If the version is older than the oldest available tagged release then the version is declared unsupported.
  const oldestRelease = await env.ZIGTOOLS_DB.prepare(
    // update the "explain query plan when searching all tagged releases" test when modifying the query
    "SELECT JsonData FROM ZLSReleases WHERE IsRelease = 1 ORDER BY ZLSVersionMajor ASC, ZLSVersionMinor ASC, ZLSVersionPatch ASC",
  ).first<{ JsonData: string }>();

  if (oldestRelease != null) {
    const oldest = JSON.parse(oldestRelease.JsonData) as D2JsonData;
    const oldestMinRuntimeZigVersion = SemanticVersion.parse(
      oldest.minimumRuntimeZigVersion,
    );
    assert(oldestMinRuntimeZigVersion !== null);

    if (
      SemanticVersion.order(zigVersion, oldestMinRuntimeZigVersion) == Order.lt
    ) {
      return SelectVersionFailureCode.Unsupported;
    }
  }

  return SelectVersionFailureCode.TaggedReleaseIncompatible;
}

function isVersionEnclosedInFailure(
  /** must be sorted in ascending order */
  testedVersions: { version: SemanticVersion; isSuccess: boolean }[],
  version: SemanticVersion,
): boolean {
  assert(testedVersions.length !== 0);

  // fast path: if the `version` is oldest or equal to the oldest tested version
  const oldestTestedVersion = testedVersions[0];
  switch (SemanticVersion.order(version, oldestTestedVersion.version)) {
    case Order.lt:
    case Order.eq:
      return !oldestTestedVersion.isSuccess;
    case Order.gt:
      break;
  }

  // fast path: if the `version` is newer or equal to the latest tested version
  const newestTestedVersion = testedVersions[testedVersions.length - 1];
  switch (SemanticVersion.order(version, newestTestedVersion.version)) {
    case Order.lt:
      break;
    case Order.eq:
    case Order.gt:
      return !newestTestedVersion.isSuccess;
  }

  let start = 0;
  let end = testedVersions.length - 1;

  while (start <= end) {
    const mid: number = Math.floor((start + end) / 2);

    switch (SemanticVersion.order(testedVersions[mid].version, version)) {
      case Order.lt:
        start = mid + 1;
        break;
      case Order.eq:
        return !testedVersions[mid].isSuccess;
      case Order.gt:
        end = mid - 1;
        break;
    }
  }

  [start, end] = [end, start];

  // Not necessary because of the fast-path.
  //
  // if (start < 0 || testedVersions.length <= start)
  //   return !testedVersions[end].isSuccess;
  // if (end < 0 || testedVersions.length <= end)
  //   return !testedVersions[start].isSuccess;

  assert(0 <= start && start < testedVersions.length);
  assert(0 <= end && end < testedVersions.length);
  const startIsSuccess = testedVersions[start].isSuccess;
  const endIsSuccess = testedVersions[end].isSuccess;

  return !startIsSuccess && !endIsSuccess;
}

/**
 * This code is based on `https://gist.github.com/Techatrix/02ce258460d4ca1c8424e600458575b0`.
 */
async function selectOnDevelopmentBuild(
  env: Env,
  zigVersion: SemanticVersion,
  compatibility: Exclude<VersionCompatibility, VersionCompatibility.None>,
): Promise<D2JsonData | SelectVersionFailureCode> {
  assert(!zigVersion.isRelease);

  const developmentReleases = await env.ZIGTOOLS_DB.prepare(
    // update the "explain query plan when searching on development built" test when modifying the query
    "SELECT JsonData FROM ZLSReleases WHERE IsRelease = 0 AND ZLSVersionMajor = ?1 AND ZLSVersionMinor = ?2 ORDER BY ZLSVersionBuildID ASC",
  ).bind(zigVersion.major, zigVersion.minor).all<{ JsonData: string; }>();

  let releases: { JsonData: string; }[] = [];
  if (developmentReleases.results.length !== 0) {
    releases = developmentReleases.results;
  } else {
    // This is to handle the following situtation:
    // 1. Zig has tagged a new release (e.g `0.13.0`)
    // 2. new Zig development builds have come out (e.g 0.13.0-dev.1+aaaaaaa)
    // 3. ZLS has tagged a new release (e.g `0.13.0`)
    // 4. but no ZLS development builds have come out!
    //
    // Querying with `0.13.0-dev.1+aaaaaaa` should return `0.13.0`. This 
    // should only happen for the latest tagged release while previous 
    // releases will report 'unsupported'.
    //
    // This is why only the latest tagged release is selected.
    const latestTaggedRelease = await env.ZIGTOOLS_DB.prepare(
      // update the "explain query plan when searching all tagged releases" test when modifying the query
      "SELECT JsonData FROM ZLSReleases WHERE IsRelease = 1 ORDER BY ZLSVersionMajor DESC, ZLSVersionMinor DESC, ZLSVersionPatch DESC",
    ).first<{ JsonData: string; }>();
    releases = (latestTaggedRelease != null) ? [latestTaggedRelease] : [];
  }

  if (releases.length == 0) {
    return SelectVersionFailureCode.DevelopmentBuildUnsupported;
  }

  const oldestRelease = JSON.parse(releases[0].JsonData) as D2JsonData;
  const oldestMinZigVersion = selectMinimumZigVersion(
    oldestRelease,
    compatibility,
  );

  if (SemanticVersion.order(zigVersion, oldestMinZigVersion) == Order.lt) {
    if (developmentReleases.results.length == 0) {
      return SelectVersionFailureCode.DevelopmentBuildUnsupported;
    } else {
      return SelectVersionFailureCode.Unsupported;
    }
  }

  // The following algorithm assumes that the Zig version and tested Zig
  // versions are monotonically increasing when iterating over ordered ZLS
  // versions.

  let selectedEntry: D2JsonData = oldestRelease;

  for (const entry of releases) {
    const data = JSON.parse(entry.JsonData) as D2JsonData;
    assert(data.artifacts.length !== 0);

    const minimumZigVersion = selectMinimumZigVersion(data, compatibility);

    switch (SemanticVersion.order(zigVersion, minimumZigVersion)) {
      case Order.lt:
        // the minimum build version may not be monotonically increasing (i.e a
        // newer release has lower minimum build version) so keep searching
        continue;
      case Order.eq:
      case Order.gt:
        selectedEntry = data;
        break;
    }
  }

  assert.equal(
    selectedEntry.testedZigVersions[selectedEntry.zigVersion],
    VersionCompatibility.Full,
  );
  const testedZigVersions = Object.entries(selectedEntry.testedZigVersions)
    .map(([versionString, testedCompatibility]) => {
      const semver = SemanticVersion.parse(versionString);
      assert(semver !== null);

      let isSuccess: boolean;
      switch (testedCompatibility) {
        case VersionCompatibility.None:
          isSuccess = false;
          break;
        case VersionCompatibility.OnlyRuntime:
          switch (compatibility) {
            case VersionCompatibility.OnlyRuntime:
              isSuccess = true;
              break;
            case VersionCompatibility.Full:
              isSuccess = false;
              break;
          }
          break;
        case VersionCompatibility.Full:
          isSuccess = true;
          break;
      }

      return {
        version: semver,
        isSuccess: isSuccess,
      };
    })
    .sort((lhs, rhs) => SemanticVersion.order(lhs.version, rhs.version));
  assert(testedZigVersions.length !== 0);

  if (isVersionEnclosedInFailure(testedZigVersions, zigVersion)) {
    return SelectVersionFailureCode.DevelopmentBuildIncompatible;
  }

  return selectedEntry;
}

function selectMinimumZigVersion(
  data: D2JsonData,
  compatibility: Exclude<VersionCompatibility, VersionCompatibility.None>,
): SemanticVersion {
  const minBuildZigVersion = SemanticVersion.parse(data.minimumBuildZigVersion);
  assert(minBuildZigVersion !== null);

  const minRuntimeZigVersion = SemanticVersion.parse(
    data.minimumRuntimeZigVersion,
  );
  assert(minRuntimeZigVersion !== null);

  switch (compatibility) {
    case VersionCompatibility.Full:
      return SemanticVersion.order(minBuildZigVersion, minRuntimeZigVersion) ==
        Order.lt
        ? minRuntimeZigVersion
        : minBuildZigVersion;
    case VersionCompatibility.OnlyRuntime:
      return minRuntimeZigVersion;
  }
}
