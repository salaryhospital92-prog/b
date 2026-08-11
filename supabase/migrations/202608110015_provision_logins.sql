-- Accounts are issued by the administration against an employee number, never
-- self-registered. The password is generated, shown once, and must be changed
-- on first use.
create or replace function public.provision_login(
  p_employee_number text,
  p_login_name text,
  p_password text,
  p_actor_name text,
  p_reissue boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  employee public.employees%rowtype;
  existing public.login_accounts%rowtype;
  actor_id bigint;
begin
  select * into employee from public.employees
  where lower(employee_number) = lower(trim(p_employee_number));
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if employee.status <> 'نشط' or employee.approval_status <> 'معتمد' then
    return jsonb_build_object('error', 'not_active');
  end if;
  if length(coalesce(p_password, '')) < 10 then
    raise exception 'generated password too weak';
  end if;

  select * into existing from public.login_accounts where employee_id = employee.id;
  if found and not p_reissue then
    return jsonb_build_object('error', 'exists', 'login_name', existing.login_name);
  end if;
  -- A name already taken by someone else must not be silently reassigned.
  if exists (
    select 1 from public.login_accounts
    where lower(login_name) = lower(trim(p_login_name)) and employee_id <> employee.id
  ) then
    return jsonb_build_object('error', 'name_taken');
  end if;

  select id into actor_id from public.employees where full_name = trim(p_actor_name) limit 1;

  insert into public.login_accounts (employee_id, login_name, password_hash, is_demo, must_change_password)
  values (employee.id, trim(p_login_name), crypt(p_password, gen_salt('bf', 12)), false, true)
  on conflict (employee_id) do update
    set login_name = excluded.login_name,
        password_hash = excluded.password_hash,
        must_change_password = true,
        failed_attempts = 0,
        locked_until = null,
        is_demo = false;

  -- Re-issuing invalidates whatever the previous holder was using.
  delete from public.app_sessions where employee_id = employee.id;

  insert into public.audit_logs (action, entity_type, entity_id, after_data)
  values (
    case when p_reissue then 'reissue_login' else 'provision_login' end,
    'employee', employee.id::text,
    jsonb_build_object('login_name', trim(p_login_name), 'by', p_actor_name, 'actor_id', actor_id)
  );

  return jsonb_build_object(
    'employee', jsonb_build_object(
      'id', employee.id,
      'full_name', employee.full_name,
      'employee_number', employee.employee_number,
      'role', employee.role,
      'specialty', employee.specialty
    ),
    'login_name', trim(p_login_name),
    'reissued', p_reissue
  );
end;
$$;

revoke all on function public.provision_login(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.provision_login(text, text, text, text, boolean) to service_role;

insert into public.app_schema_migrations (version)
values ('202608110015_provision_logins')
on conflict (version) do nothing;
