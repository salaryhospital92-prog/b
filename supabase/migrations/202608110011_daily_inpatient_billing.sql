-- Long-stay premature babies, and the daily paid / unpaid / free ledger that
-- decides what a doctor has actually earned versus what is still expected.

-- 1) Premature infants keep their own admission date, because an incubator stay
--    routinely starts before — or long after — the mother's own admission.
alter table public.patients add column if not exists is_premature boolean not null default false;
alter table public.patients add column if not exists incubator_note text;
create index if not exists idx_patients_premature on public.patients (is_premature) where is_premature = true;

-- 2) The daily ledger. One row per patient per day, carrying who is owed for it.
alter table public.inpatient_payments add column if not exists doctor_id bigint references public.employees(id) on delete set null;
alter table public.inpatient_payments add column if not exists note text;

update public.inpatient_payments set payment_status = 'لم تدفع بعد'
where payment_status not in ('مدفوع', 'لم تدفع بعد', 'مجاني');

alter table public.inpatient_payments alter column payment_status set default 'لم تدفع بعد';
alter table public.inpatient_payments drop constraint if exists inpatient_payments_status_check;
alter table public.inpatient_payments add constraint inpatient_payments_status_check
  check (payment_status in ('مدفوع', 'لم تدفع بعد', 'مجاني'));

drop trigger if exists set_inpatient_payments_updated_at on public.inpatient_payments;
create trigger set_inpatient_payments_updated_at
  before update on public.inpatient_payments
  for each row execute function public.set_updated_at();

-- 3) Readable ledger rows: patient, day, status, and the doctor who earns it.
create or replace view public.inpatient_day_ledger as
select
  payment.id,
  payment.record_date,
  payment.payment_status,
  payment.note,
  patient.id as patient_id,
  patient.full_name as patient_name,
  patient.file_number,
  patient.department,
  patient.patient_status,
  patient.is_newborn,
  patient.is_premature,
  patient.admission_date,
  mother.full_name as mother_name,
  mother.file_number as mother_file_number,
  coalesce(doctor.full_name, patient.attending_doctor) as doctor_name,
  payment.doctor_id,
  case payment.payment_status when 'مدفوع' then 25000 else 0 end as paid_amount,
  case payment.payment_status when 'لم تدفع بعد' then 25000 else 0 end as pending_amount
from public.inpatient_payments payment
join public.patients patient on patient.id = payment.patient_id
left join public.patients mother on mother.id = patient.mother_id
left join public.employees doctor on doctor.id = payment.doctor_id;

-- 4) Derived, never stored: changing a day's status re-totals every report that
--    reads this, which is the retroactive recalculation the accountants need.
create or replace view public.doctor_inpatient_totals as
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

-- 5) Setting a day is one call, so the web app and the bot cannot diverge.
create or replace function public.set_inpatient_day(
  p_patient_id bigint,
  p_record_date date,
  p_status text,
  p_doctor_name text,
  p_actor_name text,
  p_note text default null
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

  insert into public.inpatient_payments (patient_id, record_date, payment_status, doctor_id, updated_by, note)
  values (p_patient_id, p_record_date, p_status, doctor_id, actor_id, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (patient_id, record_date) do update
    set payment_status = excluded.payment_status,
        doctor_id = coalesce(excluded.doctor_id, public.inpatient_payments.doctor_id),
        updated_by = excluded.updated_by,
        note = coalesce(excluded.note, public.inpatient_payments.note)
  returning * into saved;

  insert into public.audit_logs (action, entity_type, entity_id, after_data)
  values ('set_inpatient_day', 'inpatient_payment', saved.id::text, to_jsonb(saved));

  return jsonb_build_object(
    'record', to_jsonb(saved),
    'patient_name', patient_record.full_name,
    'totals', (
      select coalesce(jsonb_agg(to_jsonb(totals)), '[]'::jsonb)
      from public.doctor_inpatient_totals totals
      where totals.doctor_name = coalesce(
        (select full_name from public.employees where id = saved.doctor_id),
        patient_record.attending_doctor)
    )
  );
end;
$$;

revoke all on function public.set_inpatient_day(bigint, date, text, text, text, text) from public, anon, authenticated;
grant execute on function public.set_inpatient_day(bigint, date, text, text, text, text) to service_role;
revoke all on public.inpatient_day_ledger, public.doctor_inpatient_totals from public, anon, authenticated;
grant select on public.inpatient_day_ledger, public.doctor_inpatient_totals to service_role;

insert into public.app_schema_migrations (version)
values ('202608110011_daily_inpatient_billing')
on conflict (version) do nothing;
