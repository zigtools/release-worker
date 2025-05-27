import assert from "node:assert";

export interface D2JsonData {
  date: number;
  zlsVersion: string;
  /** The Zig version with which the artifacts have been compiled. */
  zigVersion: string;
  minimumBuildZigVersion: string;
  minimumRuntimeZigVersion: string;
  /** guarantees `testedZigVersions[zigVersion] == Compatibility.Full` */
  testedZigVersions: Record<string, VersionCompatibility>;
  artifacts: ReleaseArtifact[];
}

export enum VersionCompatibility {
  /** The given Zig version is not compatible */
  None = "none",
  /** ZLS can't be compiled with the given Zig version but is compatible at runtime. */
  OnlyRuntime = "only-runtime",
  /** Has been successfully build and tested with the given Zig version. */
  Full = "full",
}

export interface ReleaseArtifact {
  os: string;
  arch: string;
  /** a semantic version */
  version: string;
  /** `(extension === "zip")` is equivalent to `(os === "windows")` */
  extension: Extension;
  /** sha256 in hex */
  fileShasum: string;
  fileSize: number;
}

export type Extension = "tar.xz" | "tar.gz" | "zip";

/**
 * Similar to https://ziglang.org/download/index.json
 */
export type ZLSIndex = Record<
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

export interface SQLiteQueryPlanRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}

export function artifactsToRecord(
  R2_PUBLIC_URL: string,
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
      tarball: `${R2_PUBLIC_URL}/zls-${artifact.os}-${artifact.arch}-${artifact.version}.${artifact.extension}`,
      shasum: artifact.fileShasum,
      size: artifact.fileSize.toString(),
    };
  }
  return targets;
}
