-- Setting a password after an emailed link proved ownership of the address.
-- Separate from change_password: there is no current password to check here,
-- so it must never be callable without that proof happening first.
create or replace function public.reset_password(
  p_employee_id bigint,
  p_new_password text,
  p_keep_token_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  account public.login_accounts%rowtype;
begin
  select * into account from public.login_accounts where employee_id = p_employee_id;
  if not found then
    return false;
  end if;
  if length(coalesce(p_new_password, '')) < 8 then
    raise exception 'password too short';
  end if;

  update public.login_accounts
  set password_hash = crypt(p_new_password, gen_salt('bf', 12)),
      must_change_password = false,
      failed_attempts = 0,
      locked_until = null
  where id = account.id;

  -- Anyone still holding an old session is signed out: a reset usually means
  -- the previous password is no longer trusted.
  delete from public.app_sessions
  where employee_id = p_employee_id and token_hash <> coalesce(p_keep_token_hash, '');
  return true;
end;
$$;

revoke all on function public.reset_password(bigint, text, text) from public, anon, authenticated;
grant execute on function public.reset_password(bigint, text, text) to service_role;

-- Sign-in by address needs to find the employee by address.
create index if not exists idx_employees_email on public.employees (lower(email));

insert into public.app_schema_migrations (version)
values ('202608110014_password_reset')
on conflict (version) do nothing;
