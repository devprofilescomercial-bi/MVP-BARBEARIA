-- ============================================================================
-- BARBEARIA ONLINE — schema completo (multi-tenant)
-- Rode este arquivo inteiro em: Supabase > SQL Editor > New query > Run
-- Este arquivo é seguro de rodar várias vezes (idempotente): nada quebra
-- se as tabelas/políticas já existirem.
-- ============================================================================

-- As tabelas antigas de bookings/blocked_slots (de antes desse projeto) têm
-- colunas diferentes das que o app espera — derruba e recria do zero.
drop table if exists public.blocked_slots cascade;
drop table if exists public.bookings cascade;

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. BARBEARIAS (cada barbearia = um tenant/cliente do SaaS)
-- ============================================================================
create table if not exists public.barbearias (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    slug text not null unique,
    logo_url text,
    phone text,
    address text,
    open_time time not null default '08:00',
    close_time time not null default '20:00',
    slot_duration_minutes int not null default 30,
    max_bookings_per_slot int not null default 3,
    created_at timestamptz not null default now()
);

comment on table public.barbearias is 'Cada linha é uma barbearia (tenant) cadastrada na plataforma Barbearia Online.';

-- ============================================================================
-- 2. PROFILES (dados extras de cada usuário autenticado: dono OU cliente)
-- ============================================================================
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    role text not null check (role in ('owner', 'client')),
    name text not null,
    phone text,
    email text,
    created_at timestamptz not null default now()
);

-- Cria (ou atualiza) o profile automaticamente quando alguém se cadastra.
-- Dispara em INSERT e também em UPDATE do metadata: o Supabase Auth às vezes
-- grava o metadata (nome/telefone/role) num passo logo depois da criação da
-- linha do usuário, então só ouvir o INSERT pode pegar esse dado ainda vazio.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
    v_role text;
begin
    v_role := new.raw_user_meta_data->>'role';
    if v_role not in ('owner', 'client') then
        v_role := null;
    end if;

    if tg_op = 'INSERT' then
        insert into public.profiles (id, role, name, phone, email)
        values (
            new.id,
            coalesce(v_role, 'client'),
            coalesce(new.raw_user_meta_data->>'name', ''),
            new.raw_user_meta_data->>'phone',
            new.email
        )
        on conflict (id) do nothing;
    else
        update public.profiles set
            role = coalesce(v_role, role),
            name = coalesce(nullif(new.raw_user_meta_data->>'name', ''), name),
            phone = coalesce(new.raw_user_meta_data->>'phone', phone)
        where id = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert or update of raw_user_meta_data on auth.users
    for each row execute function public.handle_new_user();

-- ============================================================================
-- 3. SERVICES (serviços + preços de cada barbearia — editável pelo dono)
-- ============================================================================
create table if not exists public.services (
    id uuid primary key default gen_random_uuid(),
    barbearia_id uuid not null references public.barbearias(id) on delete cascade,
    name text not null,
    price numeric(10,2) not null,
    duration_minutes int not null default 30,
    active boolean not null default true,
    sort_order int not null default 0,
    created_at timestamptz not null default now()
);

-- ============================================================================
-- 4. BOOKINGS (agendamentos)
-- ============================================================================
create table if not exists public.bookings (
    id uuid primary key default gen_random_uuid(),
    barbearia_id uuid not null references public.barbearias(id) on delete cascade,
    client_id uuid references public.profiles(id) on delete set null,
    service_id uuid references public.services(id) on delete set null,
    client_name text not null,
    client_phone text,
    service_name text not null,
    price numeric(10,2) not null,
    date date not null,
    time time not null,
    status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
    is_walkin boolean not null default false,
    notes text,
    created_at timestamptz not null default now()
);

create index if not exists idx_bookings_barbearia_date on public.bookings(barbearia_id, date);
create index if not exists idx_bookings_client on public.bookings(client_id);

-- ============================================================================
-- 5. BLOCKED_SLOTS (horários bloqueados pelo dono)
-- ============================================================================
create table if not exists public.blocked_slots (
    id uuid primary key default gen_random_uuid(),
    barbearia_id uuid not null references public.barbearias(id) on delete cascade,
    date date not null,
    time time, -- null = dia inteiro bloqueado
    created_at timestamptz not null default now()
);

create index if not exists idx_blocked_barbearia_date on public.blocked_slots(barbearia_id, date);

-- ============================================================================
-- RLS (Row Level Security) — cada barbearia só vê os próprios dados,
-- cada cliente só vê os próprios agendamentos.
-- ============================================================================
alter table public.barbearias enable row level security;
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.bookings enable row level security;
alter table public.blocked_slots enable row level security;

drop policy if exists "barbearias_select_public" on public.barbearias;
create policy "barbearias_select_public" on public.barbearias
    for select using (true);

drop policy if exists "barbearias_insert_owner" on public.barbearias;
create policy "barbearias_insert_owner" on public.barbearias
    for insert with check (auth.uid() = owner_id);

drop policy if exists "barbearias_update_owner" on public.barbearias;
create policy "barbearias_update_owner" on public.barbearias
    for update using (auth.uid() = owner_id);

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
    for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
    for update using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
    for insert with check (auth.uid() = id);

drop policy if exists "services_select_public" on public.services;
create policy "services_select_public" on public.services
    for select using (true);

drop policy if exists "services_insert_owner" on public.services;
create policy "services_insert_owner" on public.services
    for insert with check (
        barbearia_id in (select id from public.barbearias where owner_id = auth.uid())
    );

drop policy if exists "services_update_owner" on public.services;
create policy "services_update_owner" on public.services
    for update using (
        barbearia_id in (select id from public.barbearias where owner_id = auth.uid())
    );

drop policy if exists "services_delete_owner" on public.services;
create policy "services_delete_owner" on public.services
    for delete using (
        barbearia_id in (select id from public.barbearias where owner_id = auth.uid())
    );

drop policy if exists "bookings_select" on public.bookings;
create policy "bookings_select" on public.bookings
    for select using (
        auth.uid() = client_id
        or barbearia_id in (select id from public.barbearias where owner_id = auth.uid())
    );

drop policy if exists "bookings_insert" on public.bookings;
create policy "bookings_insert" on public.bookings
    for insert with check (
        auth.uid() = client_id
        or barbearia_id in (select id from public.barbearias where owner_id = auth.uid())
    );

drop policy if exists "bookings_update" on public.bookings;
create policy "bookings_update" on public.bookings
    for update using (
        auth.uid() = client_id
        or barbearia_id in (select id from public.barbearias where owner_id = auth.uid())
    );

-- Um cliente só pode "cancelar" o próprio agendamento — nunca alterar preço,
-- data, horário ou de quem é o agendamento.
create or replace function public.protect_booking_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    if auth.uid() is distinct from (select owner_id from public.barbearias where id = old.barbearia_id) then
        new.barbearia_id := old.barbearia_id;
        new.client_id := old.client_id;
        new.service_id := old.service_id;
        new.client_name := old.client_name;
        new.client_phone := old.client_phone;
        new.service_name := old.service_name;
        new.price := old.price;
        new.date := old.date;
        new.time := old.time;
        new.is_walkin := old.is_walkin;
        new.notes := old.notes;
    end if;
    return new;
end;
$$;

drop trigger if exists protect_booking_fields_trigger on public.bookings;
create trigger protect_booking_fields_trigger
    before update on public.bookings
    for each row execute function public.protect_booking_fields();

drop policy if exists "blocked_select_public" on public.blocked_slots;
create policy "blocked_select_public" on public.blocked_slots
    for select using (true);

drop policy if exists "blocked_insert_owner" on public.blocked_slots;
create policy "blocked_insert_owner" on public.blocked_slots
    for insert with check (
        barbearia_id in (select id from public.barbearias where owner_id = auth.uid())
    );

drop policy if exists "blocked_delete_owner" on public.blocked_slots;
create policy "blocked_delete_owner" on public.blocked_slots
    for delete using (
        barbearia_id in (select id from public.barbearias where owner_id = auth.uid())
    );

-- ============================================================================
-- STORAGE (bucket público para logo das barbearias)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

drop policy if exists "logos_public_read" on storage.objects;
create policy "logos_public_read" on storage.objects
    for select using (bucket_id = 'logos');

drop policy if exists "logos_owner_write" on storage.objects;
create policy "logos_owner_write" on storage.objects
    for insert with check (
        bucket_id = 'logos'
        and (storage.foldername(name))[1] in (select id::text from public.barbearias where owner_id = auth.uid())
    );

drop policy if exists "logos_owner_update" on storage.objects;
create policy "logos_owner_update" on storage.objects
    for update using (
        bucket_id = 'logos'
        and (storage.foldername(name))[1] in (select id::text from public.barbearias where owner_id = auth.uid())
    );

-- ============================================================================
-- REALTIME — habilita atualização ao vivo (só adiciona se ainda não estiver)
-- ============================================================================
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
    ) then
        alter publication supabase_realtime add table public.bookings;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'blocked_slots'
    ) then
        alter publication supabase_realtime add table public.blocked_slots;
    end if;
end $$;

notify pgrst, 'reload schema';
