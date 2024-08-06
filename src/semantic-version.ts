import assert from "node:assert";

export enum Order {
  lt = -1,
  eq = 0,
  gt = 1,
}

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
    const match = regex.exec(string);
    if (match === null) return null;

    const semver = new SemanticVersion();
    semver.major = parseInt(match[1]);
    if (semver.major > Number.MAX_SAFE_INTEGER) return null;
    assert(!isNaN(semver.major));

    semver.minor = parseInt(match[2]);
    if (semver.minor > Number.MAX_SAFE_INTEGER) return null;
    assert(!isNaN(semver.minor));

    semver.patch = parseInt(match[3]);
    if (semver.patch > Number.MAX_SAFE_INTEGER) return null;
    assert(!isNaN(semver.patch));

    assert(!match[4] == !match[5]);
    semver.isRelease = !match[4];

    if (!match[4]) return semver;

    semver.commitHeight = parseInt(match[4]);
    if (semver.commitHeight > Number.MAX_SAFE_INTEGER) return null;
    assert(!isNaN(semver.commitHeight));

    semver.commitID = match[5];

    return semver;
  }

  public static order(lhs: SemanticVersion, rhs: SemanticVersion): Order {
    if (lhs.major < rhs.major) return Order.lt;
    if (lhs.major > rhs.major) return Order.gt;

    if (lhs.minor < rhs.minor) return Order.lt;
    if (lhs.minor > rhs.minor) return Order.gt;

    if (lhs.patch < rhs.patch) return Order.lt;
    if (lhs.patch > rhs.patch) return Order.gt;

    if (lhs.commitHeight === undefined && rhs.commitHeight === undefined)
      return Order.eq;
    if (lhs.commitHeight === undefined) return Order.gt;
    if (rhs.commitHeight === undefined) return Order.lt;

    if (lhs.commitHeight < rhs.commitHeight) return Order.lt;
    if (lhs.commitHeight > rhs.commitHeight) return Order.gt;

    return Order.eq;
  }

  public toString(): string {
    const a = `${this.major.toString()}.${this.minor.toString()}.${this.patch.toString()}`;
    if (this.isRelease) return a;
    assert(this.commitHeight !== undefined && this.commitID !== undefined);
    return `${a}-dev.${this.commitHeight.toString()}+${this.commitID}`;
  }

  get [Symbol.toStringTag]() {
    return this.toString();
  }
}
