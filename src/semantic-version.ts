export class SemanticVersion {
  major!: number;
  minor!: number;
  patch!: number;
  isRelease!: boolean;
  commitHeight?: number;
  commitID?: string;

  public static parse(string: string): SemanticVersion | null {
    const regex =
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
    const match = string.match(regex);
    if (!match) return null;

    const semver = new SemanticVersion();
    semver.major = parseInt(match[1]);
    if (isNaN(semver.major)) return null;

    semver.minor = parseInt(match[2]);
    if (isNaN(semver.minor)) return null;

    semver.patch = parseInt(match[3]);
    if (isNaN(semver.patch)) return null;

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

    if (!lhs.commitHeight || !rhs.commitHeight) return 0;

    if (lhs.commitHeight < rhs.commitHeight) return -1;
    if (lhs.commitHeight > rhs.commitHeight) return 1;

    return 0;
  }
}
