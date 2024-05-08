DROP TABLE IF EXISTS ZLSReleases;
CREATE TABLE ZLSReleases (
    ZLSVersion TEXT NOT NULL PRIMARY KEY,
    ZLSVersionMajor INTEGER NOT NULL,
    ZLSVersionMinor INTEGER NOT NULL,
    ZLSVersionPatch INTEGER NOT NULL,
    ZLSVersionBuildID INTEGER,
    IsRelease BOOLEAN NOT NULL,
    JsonData TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zls_releases_zls_version ON ZLSReleases(ZLSVersion);
CREATE INDEX IF NOT EXISTS idx_zls_releases_is_release_major_minor_patch ON ZLSReleases(IsRelease, ZLSVersionMajor, ZLSVersionMinor, ZLSVersionPatch);