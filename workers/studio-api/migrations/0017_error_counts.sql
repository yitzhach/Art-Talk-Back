-- Migration 0017 — error alerts (final pass, card H: D-178)
--
-- error_counts  how many times something failed, per studio and UTC day: a server error (a 500 from studio-api),
--               a Square webhook that failed, an assistant answer that didn't come through. studio_id is '' when
--               the failure can't be tied to a studio. A count only: the details stay in the Workers' logs.
-- error_alerts  the day's one alert per studio, so a studio hears at most once a day.
-- Additive only. Mirrored by packages/core/src/db/schema.ts.

CREATE TABLE error_counts (
  studio_id   TEXT NOT NULL DEFAULT '',
  day         TEXT NOT NULL,                        -- 'YYYY-MM-DD', UTC
  kind        TEXT NOT NULL CHECK (kind IN ('server','webhook','assistant')),
  n           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (studio_id, day, kind)
);

CREATE TABLE error_alerts (
  studio_id   TEXT NOT NULL DEFAULT '',
  day         TEXT NOT NULL,                        -- the day the alert was about
  sent_at     TEXT NOT NULL,
  PRIMARY KEY (studio_id, day)
);
