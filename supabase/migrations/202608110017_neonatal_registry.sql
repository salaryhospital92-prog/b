-- The ward this system serves is neonatal care, so admission types become the
-- devices a baby is actually on, each with its own daily rate, and the file
-- records which room or incubator the baby occupies.

alter table public.patients add column if not exists ward text;
alter table public.patients add column if not exists room_kind text;
alter table public.patients add column if not exists room_number text;
alter table public.patients add column if not exists ward_note text;

-- The nightly charge is per patient-day, not one figure for the whole system:
-- a ventilator day and a side-room day are different money.
alter table public.inpatient_payments add column if not exists day_rate numeric(14, 2);

comment on column public.patients.ward is 'خدج · سايد روم · أخرى';
comment on column public.patients.room_kind is 'رقم الغرفة · رقم الحاضنة · أخرى';
comment on column public.inpatient_payments.day_rate is 'سعر هذا اليوم؛ يُثبَّت وقت التسجيل فلا يتغير بأثر رجعي';

/**
 * Registers a patient with the ward and room details the neonatal unit needs.
 * Kept separate from register_patient so the older signature — still used by the
 * bot — keeps working untouched.
 */
create or replace function public.register_neonatal_patient(
  p_full_name text,
  p_file_number text,
  p_birth_date date,
  p_gender text,
  p_phone text,
  p_admission_date date,
  p_department text,
  p_attending_doctor text,
  p_payment_category text,
  p_entry_type text,
  p_billing_mode text,
  p_notes text,
  p_initial_price numeric,
  p_newborn_names jsonb default '[]'::jsonb,
  p_ward text default null,
  p_room_kind text default null,
  p_room_number text default null,
  p_ward_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  patient_id bigint;
begin
  result := public.register_patient(
    p_full_name, p_file_number, p_birth_date, p_gender, p_phone, p_admission_date,
    p_department, p_attending_doctor, p_payment_category, p_entry_type,
    p_billing_mode, p_notes, p_initial_price, p_newborn_names
  );
  patient_id := (result -> 'record' ->> 'id')::bigint;

  update public.patients
  set ward = nullif(trim(coalesce(p_ward, '')), ''),
      room_kind = nullif(trim(coalesce(p_room_kind, '')), ''),
      room_number = nullif(trim(coalesce(p_room_number, '')), ''),
      ward_note = nullif(trim(coalesce(p_ward_note, '')), '')
  where id = patient_id;

  -- Newborns share the mother's room, so they inherit it rather than being
  -- placed nowhere.
  update public.patients
  set ward = nullif(trim(coalesce(p_ward, '')), ''),
      room_kind = nullif(trim(coalesce(p_room_kind, '')), ''),
      room_number = nullif(trim(coalesce(p_room_number, '')), '')
  where mother_id = patient_id;

  return result || jsonb_build_object(
    'ward', p_ward, 'room_kind', p_room_kind, 'room_number', p_room_number
  );
end;
$$;

-- Rate now comes from the day itself; the old constant only applies to rows
-- recorded before this change. The view gains a column mid-list, which replace
-- cannot do, so it and its dependant are rebuilt together.
drop view if exists public.doctor_inpatient_totals;
drop view if exists public.inpatient_day_ledger;
create view public.inpatient_day_ledger as
select
  payment.id,
  payment.record_date,
  payment.payment_status,
  payment.note,
  coalesce(payment.day_rate, 25000) as day_rate,
  patient.id as patient_id,
  patient.full_name as patient_name,
  patient.file_number,
  patient.department,
  patient.patient_status,
  patient.is_newborn,
  patient.is_premature,
  patient.admission_date,
  patient.entry_type,
  patient.ward,
  patient.room_kind,
  patient.room_number,
  mother.full_name as mother_name,
  mother.file_number as mother_file_number,
  coalesce(doctor.full_name, patient.attending_doctor) as doctor_name,
  payment.doctor_id,
  case payment.payment_status when 'مدفوع' then coalesce(payment.day_rate, 25000) else 0 end as paid_amount,
  case payment.payment_status when 'لم تدفع بعد' then coalesce(payment.day_rate, 25000) else 0 end as pending_amount
from public.inpatient_payments payment
join public.patients patient on patient.id = payment.patient_id
left join public.patients mother on mother.id = patient.mother_id
left join public.employees doctor on doctor.id = payment.doctor_id;

create view public.doctor_inpatient_totals as
select
  doctor_name,
  count(*) filter (where payment_status = 'مدفوع') as paid_days,
  count(*) filter (where payment_status = 'لم تدفع بعد') as pending_days,
  count(*) filter (where payment_status = 'مجاني') as free_days,
  coalesce(sum(paid_amount), 0) as paid_total,
  coalesce(sum(pending_amount), 0) as pending_total
from public.inpatient_day_ledger
where doctor_name is not null
group by doctor_name;

/** Sets a day's status, stamping the rate that applied on that day. */
create or replace function public.set_inpatient_day(
  p_patient_id bigint,
  p_record_date date,
  p_status text,
  p_doctor_name text,
  p_actor_name text,
  p_note text default null,
  p_day_rate numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id bigint;
  doctor_id bigint;
  saved public.inpatient_payments%rowtype;
  patient_record public.patients%rowtype;
  effective_rate numeric;
begin
  if p_status not in ('مدفوع', 'لم تدفع بعد', 'مجاني') then
    raise exception 'invalid payment status';
  end if;
  select * into patient_record from public.patients where id = p_patient_id;
  if not found then
    raise exception 'patient not found';
  end if;
  if p_record_date < patient_record.admission_date then
    raise exception 'day precedes admission';
  end if;

  select id into actor_id from public.employees where full_name = trim(p_actor_name) limit 1;
  select id into doctor_id from public.employees
  where full_name = trim(coalesce(p_doctor_name, patient_record.attending_doctor, '')) limit 1;

  -- An explicit rate wins; otherwise the day inherits whatever the admission
  -- type was priced at, and only falls back to the old flat fee.
  effective_rate := coalesce(
    p_day_rate,
    (select day_rate from public.inpatient_payments
     where patient_id = p_patient_id and record_date = p_record_date),
    (select amount from public.patient_events
     where patient_id = p_patient_id and is_invalidated = false
     order by created_at desc limit 1),
    25000
  );

  insert into public.inpatient_payments (patient_id, record_date, payment_status, doctor_id, updated_by, note, day_rate)
  values (p_patient_id, p_record_date, p_status, doctor_id, actor_id, nullif(trim(coalesce(p_note, '')), ''), effective_rate)
  on conflict (patient_id, record_date) do update
    set payment_status = excluded.payment_status,
        doctor_id = coalesce(excluded.doctor_id, public.inpatient_payments.doctor_id),
        updated_by = excluded.updated_by,
        note = coalesce(excluded.note, public.inpatient_payments.note),
        day_rate = coalesce(excluded.day_rate, public.inpatient_payments.day_rate)
  returning * into saved;

  insert into public.audit_logs (action, entity_type, entity_id, after_data)
  values ('set_inpatient_day', 'inpatient_payment', saved.id::text, to_jsonb(saved));

  return jsonb_build_object(
    'record', to_jsonb(saved),
    'patient_name', patient_record.full_name,
    'day_rate', effective_rate
  );
end;
$$;

revoke all on function public.register_neonatal_patient(text, text, date, text, text, date, text, text, text, text, text, text, numeric, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_neonatal_patient(text, text, date, text, text, date, text, text, text, text, text, text, numeric, jsonb, text, text, text, text) to service_role;
revoke all on function public.set_inpatient_day(bigint, date, text, text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.set_inpatient_day(bigint, date, text, text, text, text, numeric) to service_role;
revoke all on public.inpatient_day_ledger, public.doctor_inpatient_totals from public, anon, authenticated;
grant select on public.inpatient_day_ledger, public.doctor_inpatient_totals to service_role;

insert into public.app_schema_migrations (version)
values ('202608110017_neonatal_registry')
on conflict (version) do nothing;
