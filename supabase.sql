-- Examly: server-side credits + Stripe fulfillment
-- Run this in Supabase SQL editor.

-- 1) Profiles table
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  credits integer not null default 0,
  free_window_start timestamptz,
  free_expires_at timestamptz,
  free_used integer not null default 0,
  stripe_customer_id text,
  stripe_payment_method_id text,
  auto_recharge boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Stripe processed sessions (idempotency)
create table if not exists public.stripe_events (
  id bigserial primary key,
  event_id text not null unique,
  type text not null,
  created_at timestamptz not null default now()
);

-- 3) Row Level Security: users can READ their own profile. No direct writes.
alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='read_own_profile'
  ) then
    create policy read_own_profile on public.profiles
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

-- 4) Atomic credit consumption (recommended)
create or replace function public.consume_generation(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
begin
  insert into public.profiles(user_id, credits, free_used)
    values (p_user_id, 0, 0)
  on conflict (user_id) do nothing;

  -- lock row
  select * into p from public.profiles where user_id = p_user_id for update;

  if p.credits > 0 then
    update public.profiles
      set credits = p.credits - 1,
          updated_at = now()
      where user_id = p_user_id;

    select * into p from public.profiles where user_id = p_user_id;
    return jsonb_build_object('mode','pro','profile', to_jsonb(p));
  end if;

  if p.free_expires_at is not null and p.free_expires_at > now() and p.free_used < 10 then
    update public.profiles
      set free_used = p.free_used + 1,
          updated_at = now()
      where user_id = p_user_id;

    select * into p from public.profiles where user_id = p_user_id;
    return jsonb_build_object('mode','free','profile', to_jsonb(p));
  end if;

  raise exception 'NO_CREDITS';
end;
$$;

-- Note:
-- The app updates credits/free fields only from server routes using SUPABASE_SERVICE_ROLE_KEY.
