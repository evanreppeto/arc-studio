# App shell design QA

- Source visual truth: `/var/folders/2g/05frnm2118b30sj5k5_zmcqm0000gn/T/codex-clipboard-ff8cf5a7-e7b4-470e-8771-2cc1588d0ad6.png`
- Mobile implementation: `/Users/evanreppeto/.codex/visualizations/2026/07/27/019fa3d1-53a2-7c40-ac14-f2c065dc9111/app-shell-mobile-open.png`
- Desktop implementation: `/Users/evanreppeto/.codex/visualizations/2026/07/27/019fa3d1-53a2-7c40-ac14-f2c065dc9111/app-shell-desktop.png`
- Combined comparison: `/Users/evanreppeto/.codex/visualizations/2026/07/27/019fa3d1-53a2-7c40-ac14-f2c065dc9111/sidebar-comparison.png`
- Reference pixels: 446 × 992. The source is a cropped raster without viewport metadata; its type scale is consistent with a likely 2× capture, but that density cannot be confirmed from the file.
- Mobile implementation pixels and CSS viewport: 445 × 954 at device scale factor 1.
- Desktop implementation pixels and CSS viewport: 1440 × 900 at device scale factor 1.
- Comparison normalization: the reference and mobile capture were top-aligned and displayed at 445 × 954. The bottom 38 source pixels were cropped so the visible navigation region could be compared at the same rendered frame. Because the reference density is unknown, the comparison judges hierarchy, rhythm, icon consistency, color, copy, and interaction affordances rather than claiming pixel-perfect type-size parity.
- State: dark theme, Home selected, demo workspace, mobile drawer open; desktop shell captured with menus closed.

## Full-view comparison evidence

The combined comparison shows that the implementation preserves the reference's simple outline icon language, muted section labels, compact rows, dark neutral rail, right-aligned attention counts, and restrained selected state. It adds the product shell elements needed by the live app: Arc Chat, workspace identity, explicit mobile close control, help, account access, and a backdrop over the current page.

## Focused-region evidence

A separate crop was not necessary: at 445 pixels wide the combined comparison keeps every changed sidebar row, section label, badge, close control, and account control legible. The desktop capture separately verifies the docked rail's proportions and its relationship to the top bar and page content.

## Required fidelity surfaces

- Fonts and typography: existing product font tokens remain in use. Navigation weight, hierarchy, casing, and truncation are consistent; workspace text truncates safely instead of colliding with its chevron.
- Spacing and layout rhythm: row rhythm and section spacing remain close to the reference. Mobile controls meet a 44 × 44 CSS-pixel minimum without inflating desktop density.
- Colors and visual tokens: the implementation stays on the app's existing dark, muted, and gold-accent tokens. Selected, hover, and focus states have clear but restrained contrast.
- Image quality and asset fidelity: the merged outline icon assets remain sharp and stylistically consistent. No placeholder or improvised icon asset was introduced by this change.
- Copy and content: “Arc Chat” clarifies the destination. Campaign and opportunity badges now expose their meaning instead of announcing an unexplained count. Duplicate workspace subtitles and the generic derived workspace label are suppressed; an intentionally customized short label remains visible.

## Findings

No actionable P0, P1, or P2 visual differences remain for this enhancement scope.

The source is a desktop-rail crop rather than a mobile-drawer specification, so the explicit close control, wider touch targets, scrim, help link, and account footer are intentional product additions rather than fidelity defects.

## Interaction and accessibility verification

- Opened the mobile drawer from the hamburger.
- Confirmed focus moves to the close control.
- Dismissed the drawer with Escape and confirmed focus returns to the hamburger.
- Opened the account menu from the top-bar avatar and confirmed focus moves to the first menu item.
- Confirmed the hidden drawer and covered main content are removed from keyboard and accessibility interaction with `inert` and `aria-hidden`.
- Confirmed campaign and opportunity badges expose descriptive accessible names.
- Checked browser console warnings and errors after desktop and mobile interaction: none.

## Comparison history

- Pass 1: no P0/P1/P2 findings. No visual fix iteration was required after the combined comparison.

## Follow-up polish

- P3: a future product-wide pass could align all top-bar and rail icon optical weights at multiple device-pixel ratios, but the current assets are coherent and production-ready.

final result: passed
