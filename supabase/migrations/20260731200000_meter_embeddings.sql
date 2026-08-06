-- BSR-502 / Finding 1: the usage meter could not record embeddings AT ALL.
--
-- `ai_usage_service` was ('arc_claude', 'gemini_image', 'gemini_video'). There
-- was no value for embeddings, so this was never a call site that forgot to
-- meter — there was nowhere to put the row. Meanwhile every Brain write embeds
-- through gemini-embedding-2: all 491 knowledge_nodes carried an embedding on
-- the day of the audit, and the meter held zero events for any of them.
--
-- `alter type ... add value` is transactional on PG12+, but the new label cannot
-- be REFERENCED until this migration commits. Nothing here references it — the
-- writes come from the app (src/lib/embeddings/gemini-embeddings.ts).
alter type public.ai_usage_service add value if not exists 'gemini_embedding';

comment on type public.ai_usage_service is
  'Metered AI service classes. Adding a value here is only half the job — a value with no writer is a phantom, and a writer with no value is silent spend. See docs/USAGE-METERING-AUDIT.md.';

-- The embedding path is org-scoped, not workspace-scoped: knowledge_nodes has an
-- org_id and no workspace_id, so an embedding genuinely has no workspace to
-- attribute to. `workspace_id` is already nullable and stays that way — writing a
-- resolved-by-default workspace would be a fabricated attribution, which is the
-- failure shape this codebase keeps re-learning. A null here means "org-scoped",
-- not "we lost it".
comment on column public.ai_usage_events.workspace_id is
  'Nullable BY DESIGN. Null means the service is org-scoped (embeddings/Brain), not that attribution was lost. Never backfill this with a default workspace.';

comment on column public.ai_usage_events.units is
  'Service-defined quantity: generations for media, INPUT CHARACTERS for embeddings. Characters are measured exactly; the token count on embedding rows is estimated from them (metadata.token_source).';
