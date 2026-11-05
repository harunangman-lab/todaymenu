-- Supabase Dashboard → SQL Editor → New query에 붙여 넣고 Run을 누르세요.
-- 레시피 본문은 menu.json에 있으며 recipe_id는 해당 파일의 recipes.id입니다.
begin;

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id bigint not null,
  created_at timestamptz not null default now(),
  constraint favorites_user_recipe_unique unique (user_id, recipe_id)
);

alter table public.favorites enable row level security;

revoke all on public.favorites from anon;
revoke all on public.favorites from authenticated;
grant select, insert, delete on public.favorites to authenticated;

drop policy if exists favorites_select_own on public.favorites;
create policy favorites_select_own on public.favorites
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists favorites_delete_own on public.favorites;
create policy favorites_delete_own on public.favorites
  for delete to authenticated using ((select auth.uid()) = user_id);

commit;
