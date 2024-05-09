import { Buffer } from "node:buffer";
import { assert } from "vitest";
import { Env } from "./env";
import { SemanticVersion } from "./semantic-version";

export const xzMagicNumber = Buffer.from("FD377A585A00", "hex");
export const zipMagicNumber = Buffer.from("504B0304", "hex");

export interface D2JsonData {
  /** unix timestamp; only set when `targets.length !== 0` */
  date: number | null;
  zlsVersion: string;
  /**
   * The Zig version with which the artifacts have been compiled.
   * Only set when `targets.length !== 0`
   */
  zigVersion: string | null;
  minimumBuildZigVersion: string;
  minimumRuntimeZigVersion: string;
  /** Always contains the `zigVersion` if it is available. */
  testedZigVersion: Record<string, boolean>;
  /** no artifacts indicates a failure. Never empty when `zlsVersion.isRelease`. */
  artifacts: ReleaseArtifact[];
}

export interface ReleaseArtifact {
  os: string;
  arch: string;
  /** a semantic version */
  version: string;
  extension: "tar.xz" | "zip";
  /** sha256 in hex */
  file_shasum: string;
  file_size: number;
}

export async function searchZLSRelease(
  env: Env,
  zlsVersion: string,
): Promise<D2JsonData | null> {
  const jsonString = await env.ZIGTOOLS_DB.prepare(
    "SELECT * FROM ZLSReleases WHERE ZLSVersion = ?1",
  )
    .bind(zlsVersion)
    .first<string>("JsonData");
  if (!jsonString) return null;
  return JSON.parse(jsonString) as D2JsonData;
}

/** TODO get rid of this function */
export async function insertZLSRelease(
  env: Env,
  jsonData: D2JsonData,
): Promise<void> {
  const zlsVersion = SemanticVersion.parse(jsonData.zlsVersion);
  assert(zlsVersion !== null);

  await env.ZIGTOOLS_DB.prepare(
    "INSERT INTO ZLSReleases (ZLSVersion, ZLSVersionMajor, ZLSVersionMinor, ZLSVersionPatch, IsRelease, ZLSVersionBuildID, JsonData) VALUES (?1, ?2, ?3, ?4, ?5, ?6, json(?7))",
  )
    .bind(
      jsonData.zlsVersion,
      zlsVersion.major,
      zlsVersion.minor,
      zlsVersion.patch,
      zlsVersion.isRelease,
      zlsVersion.commitHeight ?? null,
      JSON.stringify(jsonData),
    )
    .run();
}
