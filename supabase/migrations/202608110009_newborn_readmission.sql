-- A newborn who comes back after discharge reuses the record already linked to
-- the mother's file instead of being registered a second time.

create or replace function public.readmit_newborn(
  p_newborn_id bigint,
  p_department text,
  p_attending_doctor text,
  p_notes text,
  p_recorded_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  newborn public.patients%rowtype;
  mother public.patients%rowtype;
begin
  select * into newborn from public.patients where id = p_newborn_id;
  if not found then
    raise exception 'newborn not found';
  end if;
  if not newborn.is_newborn or newborn.mother_id is null then
    raise exception 'patient is not a newborn linked to a mother file';
  end if;
  if newborn.patient_status <> 'خرجت' then
    raise exception 'newborn is already admitted';
  end if;

  select * into mother from public.patients where id = newborn.mother_id;

  update public.patients
  set patient_status = 'نشط',
      discharge_date = null,
      admission_date = current_date,
      department = coalesce(nullif(trim(p_department), ''), department),
      attending_doctor = coalesce(nullif(trim(p_attending_doctor), ''), attending_doctor),
      notes = trim(both e'\n' from coalesce(notes, '') || e'\n' ||
        'إعادة دخول بتاريخ ' || current_date::text ||
        coalesce(' — ' || nullif(trim(p_notes), ''), '') ||
        coalesce(' (سجّلها ' || nullif(trim(p_recorded_by), '') || ')', ''))
  where id = p_newborn_id
  returning * into newborn;

  insert into public.patient_events (patient_id, event_type, amount)
  values (p_newborn_id, 'إعادة دخول مولود', 0);

  insert into public.audit_logs (action, entity_type, entity_id, after_data)
  values ('readmit_newborn', 'patient', p_newborn_id::text, to_jsonb(newborn));

  return jsonb_build_object(
    'record', to_jsonb(newborn),
    'mother', jsonb_build_object(
      'id', mother.id,
      'full_name', mother.full_name,
      'file_number', mother.file_number
    )
  );
end;
$$;

revoke all on function public.readmit_newborn(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.readmit_newborn(bigint, text, text, text, text) to service_role;

-- Mothers that currently have at least one discharged newborn, so both the web
-- dashboard and the bot can offer the same short, correct pick list.
create or replace view public.newborn_readmission_candidates as
select
  newborn.id as newborn_id,
  newborn.full_name as newborn_name,
  newborn.file_number as newborn_file_number,
  newborn.twin_order,
  newborn.discharge_date,
  mother.id as mother_id,
  mother.full_name as mother_name,
  mother.file_number as mother_file_number
from public.patients newborn
join public.patients mother on mother.id = newborn.mother_id
where newborn.is_newborn = true
  and newborn.patient_status = 'خرجت';

revoke all on public.newborn_readmission_candidates from public, anon, authenticated;
grant select on public.newborn_readmission_candidates to service_role;

insert into public.app_schema_migrations (version)
values ('202608110009_newborn_readmission')
on conflict (version) do nothing;
