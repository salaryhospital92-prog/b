-- Employees own their contact details and a photo.
alter table public.employees add column if not exists email text;
alter table public.employees add column if not exists avatar_path text;
insert into public.app_schema_migrations (version) values ('202608110013_employee_profile') on conflict (version) do nothing;
