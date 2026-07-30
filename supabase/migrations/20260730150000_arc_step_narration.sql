-- Let a reported step carry the reasoning that led to it.
--
-- Arc already streams one extended-thinking transcript per turn and, separately,
-- a list of activity steps. Neither says which thought produced which action, so
-- the chat can show the reasoning OR the actions but cannot tell the story of
-- the run. Attaching the thinking accumulated since the previous step pairs each
-- action with the reasoning that actually preceded it — no summarizer call, and
-- no guessing at a correspondence that isn't in the data.
--
-- `arc_messages.metadata.steps[].detail` is already parsed by the app
-- (`parseSteps`) and rendered by the chat; the RPC simply never set it.
--
-- The 4-argument signature is dropped and replaced by a 5-argument one whose new
-- parameter defaults to null, so callers still on the old shape (the previous
-- runner revision, mid-deploy) keep working unchanged.

drop function if exists public.arc_append_message_step(uuid, text, text, text);

create or replace function public.arc_append_message_step(
  p_agent_task_id uuid,
  p_label text,
  p_status text,
  p_at text,
  p_detail text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_message_id uuid;
  v_metadata jsonb;
  v_steps jsonb;
  v_step jsonb;
  v_replace_index integer;
  v_detail text;
begin
  if nullif(btrim(p_label), '') is null then
    raise exception 'p_label must not be empty';
  end if;
  if p_status not in ('running', 'done') then
    raise exception 'p_status must be running or done';
  end if;

  select id, coalesce(metadata, '{}'::jsonb)
  into v_message_id, v_metadata
  from public.arc_messages
  where agent_task_id = p_agent_task_id
    and status = 'pending'
  order by created_at desc
  limit 1
  for update;

  if not found then
    return false;
  end if;

  v_steps := case
    when jsonb_typeof(v_metadata -> 'steps') = 'array' then v_metadata -> 'steps'
    else '[]'::jsonb
  end;

  v_detail := nullif(btrim(coalesce(p_detail, '')), '');
  v_step := jsonb_build_object(
    'label', btrim(p_label),
    'status', p_status,
    'at', coalesce(p_at, '')
  );
  if v_detail is not null then
    v_step := v_step || jsonb_build_object('detail', jsonb_build_array(v_detail));
  end if;

  if p_status = 'done' then
    select max((item.ordinality - 1)::integer)
    into v_replace_index
    from jsonb_array_elements(v_steps) with ordinality as item(value, ordinality)
    where item.value ->> 'label' = btrim(p_label)
      and item.value ->> 'status' = 'running';
  end if;

  if v_replace_index is null then
    v_steps := v_steps || jsonb_build_array(v_step);
  else
    -- Closing a step must not discard the narration recorded when it opened.
    if v_detail is null and (v_steps -> v_replace_index) ? 'detail' then
      v_step := v_step || jsonb_build_object('detail', v_steps -> v_replace_index -> 'detail');
    end if;
    v_steps := jsonb_set(v_steps, array[v_replace_index::text], v_step, false);
  end if;

  update public.arc_messages
  set metadata = jsonb_set(v_metadata, '{steps}', v_steps, true)
  where id = v_message_id
    and status = 'pending';

  return found;
end;
$$;

revoke execute on function public.arc_append_message_step(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.arc_append_message_step(uuid, text, text, text, text) to service_role;
