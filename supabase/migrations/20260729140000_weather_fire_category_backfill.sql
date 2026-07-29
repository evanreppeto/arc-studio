-- Preserve existing fire-weather coverage when fire splits out of property_damage
-- (BSR-551).
--
-- `Red Flag Warning` and `Fire Weather Watch` have always been surfaced: the
-- property-damage regex matches `red flag` and `fire` explicitly, so they fell
-- through to the `property_damage` category. The bug was the CLAIM, not the
-- coverage — a fire forecast was being described as damage that had already
-- happened, to "affected property owners" who did not exist yet.
--
-- Routing fire to its own category fixes the claim, but it would also silently
-- REMOVE those alerts from any workspace whose saved `eventCategories` names
-- property_damage explicitly. `parseWeatherCategories` returns a saved list
-- verbatim; the new default only applies to workspaces that never configured one.
-- Prod is exactly this case: ["property_damage","extreme_heat"].
--
-- So: anyone who opted into property_damage was, in practice, opted into fire
-- weather too. Carry that forward. They can opt out afterwards in Settings —
-- what they must not experience is coverage disappearing without being asked.
--
-- DEPLOY ORDER: this is safe to apply BEFORE the code. Old code's
-- `parseWeatherCategories` filters out values it doesn't recognise, so a config
-- carrying "fire_weather" behaves identically until the new code ships.

update public.workspace_connectors
set config = jsonb_set(
      config,
      '{eventCategories}',
      (config -> 'eventCategories') || '["fire_weather"]'::jsonb
    )
where connector_key = 'weather-signals'
  and jsonb_typeof(config -> 'eventCategories') = 'array'
  -- Only workspaces that had property damage on...
  and config -> 'eventCategories' @> '["property_damage"]'::jsonb
  -- ...and don't already carry the new category (keeps this re-runnable).
  and not (config -> 'eventCategories' @> '["fire_weather"]'::jsonb);
