# Visual design

PNL DUELS uses a light palette with cobalt actions and coral matchup artwork. The two illustrated traders make the competition visible even before the first live duel exists. Rankings and activity appear on the homepage when there is data to show.

| Role | Color |
|---|---|
| Page background | `#f5f7fc` |
| Panels | `#ffffff` |
| Primary text | `#252847` |
| Secondary text | `#626b83` |
| Actions and first chart series | `#3558f5` |
| Rival illustration | `#ee7857` |
| Second chart series | `#d45f40` |
| Positive / negative returns | `#217755` / `#bd3e56` |

Bricolage Grotesque supplies the display headings and monograms; Geist Sans handles body text and tabular numbers. Fonts are served locally through Fontsource packages. Their OFL licenses remain in the corresponding packages. The player illustrations and logo are original SVG components.

Shared tokens and page layouts live in `apps/web/src/styles.css`. The visual treatments and responsive refinements live in `apps/web/src/design.css`. The homepage illustration is `apps/web/src/components/rival-art.tsx`; share cards use the same palette in `apps/worker/src/share.ts`.

Keyboard focus is visible, reduced motion is respected, and forms retain their validation and loading states. Browser checks cover desktop and 375, 390, 430 and 768-pixel layouts, as well as Phantom Solana/EVM linking and the complete demo duel flow.
