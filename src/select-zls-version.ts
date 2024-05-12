import assert from "node:assert";
import { Env } from "./env";
import { SemanticVersion } from "./semantic-version";
import { D2JsonData, ReleaseArtifact } from "./shared";

/**
 * Similar to https://ziglang.org/download/index.json
 */
export interface SelectZLSVersionWithVersionResponse {
  version: string;
  date: string;
  [artifact: string]: ArtifactEntry | string | undefined;
}

/**
 * Similar to https://ziglang.org/download/index.json
 */
export type SelectZLSVersionWithoutVersionResponse = Record<
  string,
  {
    date: string;
    [artifact: string]: ArtifactEntry | string | undefined;
  }
>;

export interface ArtifactEntry {
  tarball: string;
  shasum: string;
  size: string;
}

function artifactsToRecord(
  env: Env,
  artifacts: ReleaseArtifact[],
): Record<string, ArtifactEntry> {
  const targets: Record<string, ArtifactEntry> = {};
  for (const artifact of artifacts) {
    targets[`${artifact.arch}-${artifact.os}`] = {
      tarball: `${env.R2_PUBLIC_URL}/zls-${artifact.os}-${artifact.arch}-${artifact.version}.${artifact.extension}`,
      shasum: artifact.file_shasum,
      size: artifact.file_size.toString(),
    };
  }
  return targets;
}

/**
 * - `${ENDPOINT}/select-zls-version`
 * - `${ENDPOINT}/select-zls-version?zig_version=0.12.0`
 */
export async function handleSelectZLSVersion(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("method must be 'GET'", {
      status: 405, // Method Not Allowed
    });
  }

  if (typeof env.R2_PUBLIC_URL !== "string" || !env.R2_PUBLIC_URL) {
    return new Response(null, {
      status: 500, // Internal Server Error
    });
  }

  const url = new URL(request.url);
  const zigVersionString = url.searchParams.get("zig_version");

  if (zigVersionString === null) {
    // update the "explain query plan when searching all tagged releases" test when modifying the query
    const result = await env.ZIGTOOLS_DB.prepare(
      "SELECT JsonData FROM ZLSReleases WHERE IsRelease = 1 ORDER BY ZLSVersionMajor DESC, ZLSVersionMinor DESC, ZLSVersionPatch DESC",
    ).all<{ JsonData: string }>();

    const response: SelectZLSVersionWithoutVersionResponse = {};

    for (const entry of result.results) {
      const jsonData = JSON.parse(entry.JsonData) as D2JsonData;
      assert(jsonData.date !== null); // a tagged release is never failed
      response[jsonData.zlsVersion] = {
        date: new Date(jsonData.date).toISOString().slice(0, 10),
        ...artifactsToRecord(env, jsonData.artifacts),
      };
    }

    return Response.json(response, {
      headers: {
        "cache-control": "max-age=43200", // 12 hours
      },
    });
  }

  const zigVersion = SemanticVersion.parse(zigVersionString);

  if (!zigVersion) {
    return new Response(
      `Query component 'zig_version' with value '${zigVersionString}' is not a valid semantic version!`,
      {
        status: 400, // Bad Request
      },
    );
  }

  let selectedVersion: D2JsonData | null = null;
  if (zigVersion.isRelease) {
    selectedVersion = await selectOnTaggedRelease(env, zigVersion);
  } else {
    selectedVersion = await selectOnDevelopmentBuild(env, zigVersion);
  }

  let response: SelectZLSVersionWithVersionResponse | null = null;
  if (selectedVersion?.date != null && selectedVersion.artifacts.length !== 0) {
    response = {
      version: selectedVersion.zlsVersion,
      date: new Date(selectedVersion.date).toISOString().slice(0, 10),
      ...artifactsToRecord(env, selectedVersion.artifacts),
    };
  }

  return Response.json(response, {
    headers: {
      "cache-control": zigVersion.isRelease
        ? "max-age=43200" // 12 hours
        : "max-age=600", // 10 minutes
    },
  });
}

async function selectOnTaggedRelease(
  env: Env,
  zigVersion: SemanticVersion,
): Promise<D2JsonData | null> {
  assert(zigVersion.isRelease);

  // update the "explain query plan when searching on tagged release" test when modifying the query
  const selectedRelease = await env.ZIGTOOLS_DB.prepare(
    "SELECT JsonData FROM ZLSReleases WHERE IsRelease = 1 AND ZLSVersionMajor = ?1 AND ZLSVersionMinor = ?2 ORDER BY ZLSVersionPatch DESC",
  )
    .bind(zigVersion.major, zigVersion.minor)
    .first<{ JsonData: string }>();

  if (!selectedRelease) return null;
  return JSON.parse(selectedRelease.JsonData) as D2JsonData;
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
    case -1:
    case 0:
      return !oldestTestedVersion.isSuccess;
    case 1:
      break;
  }

  // fast path: if the `version` is newer or equal to the latest tested version
  const newestTestedVersion = testedVersions[testedVersions.length - 1];
  switch (SemanticVersion.order(version, newestTestedVersion.version)) {
    case -1:
      break;
    case 0:
    case 1:
      return !newestTestedVersion.isSuccess;
  }

  let start = 0;
  let end = testedVersions.length - 1;

  while (start <= end) {
    const mid: number = Math.floor((start + end) / 2);

    switch (SemanticVersion.order(testedVersions[mid].version, version)) {
      case -1:
        start = mid + 1;
        break;
      case 0:
        return !testedVersions[mid].isSuccess;
      case 1:
        end = mid - 1;
        break;
    }
  }

  [start, end] = [end, start];

  if (start < 0 || testedVersions.length <= start)
    return !testedVersions[end].isSuccess;
  if (end < 0 || testedVersions.length <= end)
    return !testedVersions[start].isSuccess;

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
): Promise<D2JsonData | null> {
  assert(!zigVersion.isRelease);

  // update the "explain query plan when searching on development built" test when modifying the query
  const releases = await env.ZIGTOOLS_DB.prepare(
    "SELECT JsonData FROM ZLSReleases WHERE IsRelease = 0 AND ZLSVersionMajor = ?1 AND ZLSVersionMinor = ?2 ORDER BY ZLSVersionBuildID ASC",
  )
    .bind(zigVersion.major, zigVersion.minor)
    .all<{ JsonData: string }>();

  if (!releases.results.length) return null;

  const oldestRelease = releases.results[0];
  const oldestReleaseData = JSON.parse(oldestRelease.JsonData) as D2JsonData;
  const oldestReleaseMinimumRuntimeZigVersion = SemanticVersion.parse(
    oldestReleaseData.minimumRuntimeZigVersion,
  );
  assert(oldestReleaseMinimumRuntimeZigVersion);

  if (
    SemanticVersion.order(zigVersion, oldestReleaseMinimumRuntimeZigVersion) ==
    -1
  ) {
    return null;
  }

  // The following algorithm assumes that the Zig version and tested Zig versions are monotonically increasing when iterating over ordered ZLS versions.

  let selectedEntry: D2JsonData = oldestReleaseData;

  for (const entry of releases.results) {
    const data = JSON.parse(entry.JsonData) as D2JsonData;
    const minimumRuntimeZigVersion = SemanticVersion.parse(
      data.minimumRuntimeZigVersion,
    );
    assert(minimumRuntimeZigVersion);

    // TODO deal with failed builds:
    if (data.artifacts.length === 0) continue;

    switch (SemanticVersion.order(zigVersion, minimumRuntimeZigVersion)) {
      case -1:
        // the minimum build version may not be monotonically increasing (i.e a newer release has lower minimum build version) so keep searching
        continue;
      case 0:
      case 1:
        selectedEntry = data;
        break;
    }
  }

  assert(selectedEntry.artifacts.length !== 0);

  const testedZigVersions = Object.entries(selectedEntry.testedZigVersion)
    .map(([versionString, isSuccess]) => {
      const semver = SemanticVersion.parse(versionString);
      assert(semver !== null);
      return { version: semver, isSuccess: isSuccess };
    })
    .sort((lhs, rhs) => SemanticVersion.order(lhs.version, rhs.version));
  assert(testedZigVersions.length !== 0);

  if (isVersionEnclosedInFailure(testedZigVersions, zigVersion)) return null;

  return selectedEntry;
}
