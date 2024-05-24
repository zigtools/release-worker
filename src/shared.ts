import { Buffer } from "node:buffer";

export const xzMagicNumber = Buffer.from("FD377A585A00", "hex");
export const zipMagicNumber = Buffer.from("504B0304", "hex");

export interface D2JsonData {
  date: number;
  zlsVersion: string;
  /** The Zig version with which the artifacts have been compiled. */
  zigVersion: string;
  minimumBuildZigVersion: string;
  minimumRuntimeZigVersion: string;
  minisign: boolean;
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
  fileShasum: string;
  fileSize: number;
}

export interface SQLiteQueryPlanRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}
