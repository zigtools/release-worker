import assert from "node:assert";

export class SemanticVersion {
  major!: number;
  minor!: number;
  patch!: number;
  /** `isRelease` <=> `!commitHeight && !commitID` */
  isRelease!: boolean;
  /** `isRelease` <=> `!commitHeight` */
  commitHeight?: number;
  /** `isRelease` <=> `!commitID` */
  commitID?: string;

  public static parse(string: string): SemanticVersion | null {
    /** adapted from https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string */
    const regex =
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.(\d+)\+([0-9a-fA-F]{7,9}))?$/;
    const match = string.match(regex);
    if (!match) return null;

    const semver = new SemanticVersion();
    semver.major = parseInt(match[1]);
    assert(!isNaN(semver.major));

    semver.minor = parseInt(match[2]);
    assert(!isNaN(semver.minor));

    semver.patch = parseInt(match[3]);
    assert(!isNaN(semver.patch));

    assert(!match[4] == !match[5]);
    semver.isRelease = !match[4];

    if (!match[4]) return semver;

    semver.commitHeight = parseInt(match[4]);
    assert(!isNaN(semver.commitHeight));

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

    if (lhs.commitHeight === undefined && rhs.commitHeight === undefined)
      return 0;
    if (lhs.commitHeight === undefined) return 1;
    if (rhs.commitHeight === undefined) return -1;

    if (lhs.commitHeight < rhs.commitHeight) return -1;
    if (lhs.commitHeight > rhs.commitHeight) return 1;

    return 0;
  }

  public toString(): string {
    const a = `${this.major.toString()}.${this.minor.toString()}.${this.patch.toString()}`;
    if (this.isRelease) return a;
    assert(this.commitHeight && this.commitID);
    return `${a}-dev.${this.commitHeight.toString()}+${this.commitID}`;
  }

  get [Symbol.toStringTag]() {
    return this.toString();
  }
}
