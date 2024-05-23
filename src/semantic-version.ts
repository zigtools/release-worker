import assert from "node:assert";

export class SemanticVersion {
  major!: number;
  minor!: number;
  patch!: number;
  /** `isRelease` implies `!commitHeight && !commitID` */
  isRelease!: boolean;
  /** may be `undefined` even if `isRelease` */
  commitHeight?: number;
  commitID?: string;

  public static parse(string: string): SemanticVersion | null {
    /** https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string */
    const regex =
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
    const match = string.match(regex);
    if (!match) return null;

    const semver = new SemanticVersion();
    semver.major = parseInt(match[1]);
    assert(!isNaN(semver.major));

    semver.minor = parseInt(match[2]);
    assert(!isNaN(semver.minor));

    semver.patch = parseInt(match[3]);
    assert(!isNaN(semver.patch));

    semver.isRelease = !match[4] && !match[5];

    const pre = match[4];
    if (pre) {
      const [dev, commitHeightString] = pre.split(".");
      if (dev !== "dev") return null;
      if (commitHeightString) {
        semver.commitHeight = parseInt(commitHeightString);
        if (isNaN(semver.commitHeight)) return null;
      }
    }

    semver.commitID = match[5];

    return semver;
  }

  public static order(lhs: SemanticVersion, rhs: SemanticVersion): -1 | 0 | 1 {
    if (lhs.major < rhs.major) return -1;
    if (lhs.major > rhs.major) return 1;

    if (lhs.minor < rhs.minor) return -1;
    if (lhs.minor > rhs.minor) return 1;

    if (lhs.patch < rhs.patch) return -1;
    if (lhs.patch > rhs.patch) return 1;

    if (lhs.commitHeight === undefined) return 0;
    if (rhs.commitHeight === undefined) return 0;

    if (lhs.commitHeight < rhs.commitHeight) return -1;
    if (lhs.commitHeight > rhs.commitHeight) return 1;

    return 0;
  }

  public toString(): string {
    const a = `${this.major.toString()}.${this.minor.toString()}.${this.patch.toString()}`;
    if (this.isRelease) return a;
    if (!this.commitHeight || !this.commitID) return `${a}-dev`;
    return `${a}-dev.${this.commitHeight.toString()}+${this.commitID}`;
  }

  get [Symbol.toStringTag]() {
    return this.toString();
  }
}
