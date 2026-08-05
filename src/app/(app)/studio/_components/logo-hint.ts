/** Words for a brand mark that image generation strips out by design. */
const BRAND_MARK = /\b(logo|logos|wordmark|watermark|branding|brand name|signage|lettering)\b/i;

/**
 * Asking for it to be painted ONTO something in the scene — a preposition of
 * placement followed, within a short span, by a physical surface.
 *
 * This second half is what makes the hint honest. Arc composites the real Brand
 * kit logo as a corner lockup on every creative it renders, so "add our logo"
 * is a request it FULFILS; only "on the side of the van" is the one it cannot.
 */
const ONTO_SURFACE =
  /\b(on|onto|in|into|to|across|along|over)\b[^.!?]{0,40}\b(van|truck|car|vehicle|trailer|door|panel|sign|board|billboard|wall|window|building|shirt|uniform|hat|jacket|banner|awning|side|hood|tailgate)\b/i;
// `to` is in that list because the workspace's own prompt was "Add our logo to
// the side of the truck". It is broad on its own and safe here: a match still
// needs a brand mark AND a physical surface within 40 characters, so "add the
// logo to the Library" does not qualify.

/**
 * Does this request ask for branding INSIDE a generated image?
 *
 * Both halves are required, and that is the whole point. The rule this replaces
 * was a single word list — `logo|…|sign|text|words|caption` — which fired on
 * "rewrite the text shorter" and "add a caption", requests about the CANVAS text
 * layers that Studio edits perfectly well and that have nothing to do with what
 * generation strips. It also fired on "add our real logo", which Arc does.
 *
 * Fails closed the cheap way round: a miss costs nothing, because Arc explains
 * itself in the reply. A false positive lectures the operator about a limit that
 * does not apply to what they asked, which is the behaviour that got reported.
 */
export function wantsBrandingInScene(request: string): boolean {
  return BRAND_MARK.test(request) && ONTO_SURFACE.test(request);
}
