# DiamondAgentIQ brand brief (for an image generator or design agent)

## The product in one paragraph
DiamondAgentIQ is a team of AI agents that helps parents, coaches, players and umpires understand what happened on a youth baseball or softball field: whether a call was the umpire's judgment or a written rule, what the rules say for that league and age, and how to turn the moment into a lesson. Tone: calm, encouraging, trustworthy, a little bit scorebook-nerdy. Never aggressive, never "angry fan". Audience: families of kids aged 6 to 18, volunteer coaches and youth umpires.

## Palette (use these exact colors)
| Name | Hex | Use |
|---|---|---|
| Scorer's ink (navy) | #1D2B45 | Primary: outlines, wordmark |
| Stitch red | #B3243A | Accent: ball seams, the question mark |
| Grass green | #2C6A42 | Secondary accent, sparingly |
| Infield clay | #C8A26B | Optional warm accent |
| Scorecard paper | #F5F6F1 | Light background |
| Night game | #111B27 | Dark background |

## Hard rules
- **Original artwork only.** No MLB, Little League, USA Baseball, NCAA, team or league logos, crests, silhouettes of real players, or anything resembling them. No crossed bats over a shield (too generic and too close to team crests).
- **Flat vector style.** Solid shapes, 2 to 3 colors, no gradients, no photorealism, no 3D bevels, no drop shadows.
- **Readable at 16 px.** The icon mark must still read as a ball with a question mark at favicon size.
- **No text inside the icon.** Generate marks without letters; the wordmark is set separately in type (image generators garble lettering).
- Works on both light (#F5F6F1) and dark (#111B27) backgrounds.

## The core mark: the "why" ball
A white baseball seen straight on, with a navy outline. Its red stitched seam curves into a **question mark**: the seam forms the hook of the "?", the small red stitch marks (short diagonal ticks) run along it like real baseball stitching, and the dot of the question mark sits below. It says "the agent that explains why".

## Deliverables
1. **Icon mark** (the "why" ball): square, centered, transparent background. 1024 px PNG plus SVG if possible. Variants: full color, navy-only one-color, white-only for dark backgrounds.
2. **Horizontal lockup:** icon on the left, wordmark "DiamondAgentIQ" on the right in a condensed sans-serif (e.g., Barlow Condensed Bold), tagline below in a regular sans: "Understand the call. Learn from the moment." Light and dark versions.
3. **Watermark:** the icon mark as a very light tint (5 to 8% opacity of navy or red on white), large and cropped so it bleeds off the bottom-right corner of a card. Must never reduce text contrast.
4. **Card icons** (same style, 48 px grid, 2 px navy line, one red accent each), for the answer cards:
   - **Why / the explanation:** the "why" ball (the main mark, simplified).
   - **Who to talk to:** two speech bubbles.
   - **Teachable moment:** a lightbulb whose filament is a baseball seam.
   - **Beyond the diamond:** a home plate with a small heart or sunrise above it.
   - **Improvement plan:** a clipboard with a checklist.
   - **From the dugout (story):** an open book or a dugout bench.
   - **Game situation:** a small infield diamond with base dots.
   - **Where this comes from (sources):** a rulebook with a bookmark.
   - **Team memory:** a ball with a small bookmark or brain-free "memory" ribbon (avoid brain imagery).
   - **Post-game review:** a scorebook page with a diamond grid.
5. **Favicon** 32 px and 16 px of the icon mark.

## Prompts (copy and paste)

**Icon mark**
> Flat vector logo icon, a white baseball viewed head-on with a thick navy (#1D2B45) outline, one red (#B3243A) stitched seam that curves into a clear question mark shape, short diagonal red stitch ticks along the seam like real baseball stitching, the question mark's dot in red below the seam, minimal, geometric, centered, transparent background, no text, no gradients, no shadows, readable at very small sizes.

**Watermark**
> The same baseball question-mark icon as a very faint watermark, 6% opacity navy on an off-white (#F5F6F1) card, oversized and cropped off the bottom-right corner, subtle, does not compete with text, flat vector.

**Horizontal lockup (generate the icon only; add the wordmark in a design tool)**
> Flat vector baseball question-mark icon on the left of a wide canvas, generous empty space on the right for a wordmark, navy and red on off-white, minimal, no text.

**Card icon set**
> A set of ten matching flat line icons on a 48 px grid, 2 px navy (#1D2B45) strokes with one small red (#B3243A) accent each, rounded line caps, friendly and simple, youth baseball theme: baseball with question-mark seam, two speech bubbles, lightbulb with baseball-seam filament, home plate with a small sunrise, clipboard checklist, open storybook, infield diamond with base dots, rulebook with bookmark, baseball with a ribbon bookmark, scorebook page with diamond grid. No text, transparent background, consistent stroke weight.

## Hand back
PNG and SVG files named `mark-full.svg`, `mark-navy.svg`, `mark-white.svg`, `lockup-light.svg`, `lockup-dark.svg`, `watermark.svg`, `favicon-32.png`, `favicon-16.png`, and `icons/<name>.svg`. Put them in `web/brand/`.
