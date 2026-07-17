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

-- corrige os perfis de teste que já ficaram com role errado por causa do bug anterior
update public.profiles p
set role = 'owner'
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data->>'role' = 'owner'
  and p.role <> 'owner';

notify pgrst, 'reload schema';
