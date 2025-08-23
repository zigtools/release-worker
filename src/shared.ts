import assert from "node:assert";
import { Order, SemanticVersion } from "./semantic-version";

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

export function targetFormat(version: SemanticVersion): "arch-os" | "os-arch" {
  const osArchOrderSwapVersion = SemanticVersion.parse("0.15.0");
  assert(osArchOrderSwapVersion != null);
  switch (SemanticVersion.order(version, osArchOrderSwapVersion)) {
    case Order.lt:
      return "os-arch";
    case Order.eq:
    case Order.gt:
      return "arch-os";
  }
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

    const version = SemanticVersion.parse(artifact.version);
    assert(version != null);

    let targetString;
    switch (targetFormat(version)) {
      case "arch-os":
        targetString = `${artifact.arch}-${artifact.os}`;
        break;
      case "os-arch":
        targetString = `${artifact.os}-${artifact.arch}`;
        break;
    }

    assert(!(`${artifact.arch}-${artifact.os}` in targets));
    assert.strictEqual(artifact.fileShasum.length, 64);
    targets[`${artifact.arch}-${artifact.os}`] = {
      tarball: `${R2_PUBLIC_URL}/zls-${targetString}-${artifact.version}.${artifact.extension}`,
      shasum: artifact.fileShasum,
      size: artifact.fileSize.toString(),
    };
  }
  return targets;
}
