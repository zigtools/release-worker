import { Buffer } from "node:buffer";

export const xzMagicNumber = Buffer.from("FD377A585A00", "hex");
export const gzipMagicNumber = Buffer.from("1F8B", "hex");
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
  /** `(extension === "zip")` is equivalent to `(os === "windows")` */
  extension: Extension;
  /** sha256 in hex */
  fileShasum: string;
  fileSize: number;
}

export type Extension = "tar.xz" | "tar.gz" | "zip";

export interface SQLiteQueryPlanRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}

export function getMagicNumberOfExtension(extension: Extension): Buffer {
  switch (extension) {
    case "tar.xz":
      return xzMagicNumber;
    case "tar.gz":
      return gzipMagicNumber;
    case "zip":
      return zipMagicNumber;
  }
}
