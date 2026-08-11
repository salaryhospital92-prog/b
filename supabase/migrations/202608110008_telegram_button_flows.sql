-- Button-driven conversation state for the Telegram bot.
-- One row per chat: which guided flow is running, which step, and what was collected.

create table if not exists public.telegram_sessions (
  chat_id bigint primary key,
  telegram_user_id bigint not null,
  employee_id bigint references public.employees(id) on delete cascade,
  flow text not null,
  step integer not null default 0 check (step >= 0),
  data jsonb not null default '{}'::jsonb,
  options jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists telegram_sessions_updated_at_idx on public.telegram_sessions (updated_at);

drop trigger if exists set_telegram_sessions_updated_at on public.telegram_sessions;
create trigger set_telegram_sessions_updated_at
  before update on public.telegram_sessions
  for each row execute function public.set_updated_at();

alter table public.telegram_sessions enable row level security;
revoke all on table public.telegram_sessions from public, anon, authenticated;
grant all on table public.telegram_sessions to service_role;

insert into public.app_schema_migrations (version)
values ('202608110008_telegram_button_flows')
on conflict (version) do nothing;
