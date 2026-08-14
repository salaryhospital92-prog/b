-- Phone photos routinely exceed 5MB, so proof images were being rejected at the
-- bucket as well as in the route. Both ceilings move to 10MB together.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    update storage.buckets
    set file_size_limit = 10485760,
        allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
    where id = 'consultation-evidence';
  end if;
end;
$$;

-- Two identities for the same person: one that approves and edits, one that only
-- reads. Keeping them separate means an audit trail can tell them apart.
insert into public.employees (
  full_name, employee_number, username, phone, role, specialty,
  join_date, max_consultations, daily_cap, status, approval_status
)
-- The address is left empty on purpose: employees.email is unique, and recovery
-- for this identity needs its own inbox rather than a shared one.
select 'مصطفى البياتي - رئيس المقيمين', 'CHIEF-001', 'mustafa.chief',
       (select phone from public.employees where employee_number = 'DEMO-ADMIN-001'),
       'رئيس المقيمين', 'قسم الأطفال وحديثي الولادة', current_date,
       null, null, 'نشط', 'معتمد'
where not exists (select 1 from public.employees where employee_number = 'CHIEF-001');

insert into public.app_schema_migrations (version)
values ('202608110016_evidence_limit_and_chief_account')
on conflict (version) do nothing;
