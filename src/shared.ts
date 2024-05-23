import { Buffer } from "node:buffer";
import assert from "node:assert";
import { Env } from "./env";
import { SemanticVersion } from "./semantic-version";

export const xzMagicNumber = Buffer.from("FD377A585A00", "hex");
export const zipMagicNumber = Buffer.from("504B0304", "hex");

export interface D2JsonData {
  date: number;
  zlsVersion: string;
  /** The Zig version with which the artifacts have been compiled. */
  zigVersion: string;
  minimumBuildZigVersion: string;
  minimumRuntimeZigVersion: string;
  /** Always contains the `zigVersion` */
  testedZigVersion: Record<string, boolean>;
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

export interface SQLiteQueryPlanRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
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
    "INSERT INTO ZLSReleases VALUES (?1, ?2, ?3, ?4, ?5, ?6, json(?7))",
  )
    .bind(
      jsonData.zlsVersion,
      zlsVersion.major,
      zlsVersion.minor,
      zlsVersion.patch,
      zlsVersion.commitHeight ?? null,
      zlsVersion.isRelease,
      JSON.stringify(jsonData),
    )
    .run();
}
