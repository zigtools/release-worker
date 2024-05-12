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
CREATE INDEX IF NOT EXISTS idx_zls_releases_is_release_major_minor_patch ON ZLSReleases(IsRelease,ZLSVersionMajor, ZLSVersionMinor, ZLSVersionPatch);
CREATE INDEX IF NOT EXISTS idx_zls_releases_major_minor_id_where_not_release ON ZLSReleases(ZLSVersionMajor, ZLSVersionMinor, ZLSVersionBuildID) WHERE IsRelease = 0;