# Diagram Studio — design QA

final result: passed

## Visual truth and evidence

- Selected visual: second **displayed** Product Design result, `exec-1ec570fc-9373-45eb-8b66-5080c7cbfb2c.png`.
- Source visual truth path: `/Users/suzukiyuto/.codex/generated_images/01a0c9f5-cdd1-7f33-b39c-a1ac0038a121/exec-1ec570fc-9373-45eb-8b66-5080c7cbfb2c.png`.
- Implementation: `http://127.0.0.1:4317/`, built-in fictional sample, recommended Athena architecture, operations requirement selected, panels at their initial scroll positions.
- Implementation screenshot path: `.local/design-qa/desktop-final.png`.
- Desktop CSS viewport: 1487 × 1058. Source: 1487 × 1058 pixels. Browser capture: 1472 × 1047 pixels (browser capture scaling/scrollbar crop). For comparison the implementation was normalized to 1487 × 1058; no app content was removed.
- Full-view **combined** comparison: `.local/design-qa/comparison-final.jpg` (reference left, implementation right).
- Focused combined comparisons: `.local/design-qa/diagram-final.jpg` and `.local/design-qa/inspector-final.jpg`. They were used to inspect icons, connector labels, typography, judgement cards and disclosure controls.
- Mobile evidence: `.local/design-qa/mobile.png`, CSS viewport 390 × 844. The implementation has responsive tabs and a vertical graph; the selected desktop reference does not specify mobile UI.
- Screenshots are local QA artifacts and deliberately excluded from Git. No user question or generation log is included in committed evidence.

## Comparison history

1. Initial browser inspection found P1 overlapping graph controls and supplementary content: grid children retained their intrinsic minimum height. Explicit minimum-height/track rules now keep the graph and inspector within their desktop row. Finished job details formerly displaced the entire explanation; they are now collapsed and remain accessible outside the fictional sample.
2. First combined comparison (`comparison-initial.jpg`) found P2 undersized icons and excessive comparison-panel height. Icons increased to 82 px; selected judgement reasons show a readable excerpt with complete reasons inside a disclosure. Correct-answer conditions moved into the same detail surface. Header, rail, white canvas, orange requirement states, ink text and fixed step controls follow the selected design.
3. Refined comparison (`comparison-refined.jpg`, `inspector-comparison.jpg`) found P2 connector captions touching another node's description. The library's BaseEdge renderer now places angled horizontal captions near the source segment. `diagram-final.jpg` verifies the caption is clear of the preceding node.
4. Mobile inspection found P2 clipped requirement buttons under the navigation rail and a tiny horizontal diagram. Footer offset now follows the rail, and canvas widths below 520 px use a vertical ELK layout with appropriate top/bottom handles. The final mobile capture shows all requirement buttons and readable service icons.
5. Final full-view and focused combined comparisons found no remaining actionable P0/P1/P2 issues in the app workspace.

## Required fidelity surfaces

- **Typography:** system Japanese sans-serif with Hiragino Sans / Noto Sans JP fallbacks, distinct bold question and panel headings, 14–15 px reasoning, readable contrast. The real sample is substantially longer than the mock's abbreviated question; its text is preserved and uses a smaller question size. Full node descriptions remain available on selection and to keyboard users.
- **Spacing/layout:** 72 px navy header, 94 px navigation rail, approximately two-thirds diagram workspace and one-third judgement inspector. Long reasoning scrolls within the inspector. Supplementary learning points and source quotations remain below the workspace. The extra architecture selector and disclosure controls are necessary working-product controls.
- **Colors/tokens:** navy `#192f49`/`#1b2e49`, orange `#df680d`, white canvas, warm requirement highlights, green meets, neutral comparison disadvantage, red hard violations, amber unknown. The state text remains present alongside color.
- **Assets:** existing official AWS SVGs retained and bundled into exports. Lucide icons match the reference's outlined UI icons. No generated mock icons or decorative substitutes were used. ELK derives positions from actual graph topology; the mock's fixed coordinates and extra illustrative arrows are intentionally not hardcoded.
- **Copy/content:** original question, reference-linked judgements, sample disclosure, evidence status, known vs estimated answers, source excerpts and dates remain available. No invented metrics, accounts, dashboards or settings were added. The connection drawer exposes existing local CLI information.

## Interaction validation

Verified in the in-app browser:

- Requirement step → manual requirement selection resets cumulative evaluation and correctly shows “比較上不利”.
- Option B opens its Redshift architecture; architecture selection restores A.
- Diagram steps, play and stop work; stepping clears an old selected service description.
- Keyboard Enter selects requirements. Mobile question / diagram / evaluation tabs work.
- History drawer opens; Escape closes it and restores usable navigation.
- No horizontal page overflow at 390 px. Browser console error log empty in the final inspected app state.
- Unit suite: 67 tests passed. TypeScript and production/export bundle build passed.

The direct `file://` HTML browser check was blocked by the browser URL policy and was not bypassed. Export structure, embedded assets and network-denying CSP are covered by unit tests; this local visual QA does not claim to have performed a disconnected file-browser run. Existing CI includes separate synthetic export coverage.

## Follow-up polish

- P3: exceptionally long architecture titles/reasons can require opening details or scrolling. This is an intentional readable-density tradeoff; further compression should preserve the original wording.
- The current change addresses design and presentation. AI generation latency and any separate model-output reference failures require their own backend work; no improvement to those is claimed here.

## Implementation checklist

- [x] Selected option resolved and inspected before implementation.
- [x] Shell, diagram and inspector integrated with existing data and actions.
- [x] Required fidelity surfaces compared using combined images.
- [x] All identified P0/P1/P2 visual findings fixed and recaptured.
- [x] Desktop/mobile, keyboard and core graph controls checked.
- [x] Export uses the same viewer styles without stale inline layout overrides.
