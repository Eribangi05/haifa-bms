-- Optional database file store (STORAGE_DRIVER=db): uploads survive redeploys on hosts with no persistent disk (e.g. the free Render plan).
create table if not exists stored_files (
  key text primary key,
  data bytea not null,
  mime text not null,
  size int not null,
  created_at timestamptz not null default now()
);

-- Fake-GPS ("mock location") detection: last time the phone reported a mocked position (such fixes are rejected, so the driver drops out of dispatch).
alter table driver_profiles add column if not exists mock_location_at timestamptz;
