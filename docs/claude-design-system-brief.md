# Vibe Detector - Claude Design System Brief

Use this brief to create a brand and design system for Vibe Detector across the app, marketing site, docs, launch graphics, and downloadable assets.

## Paste-Ready Prompt For Claude Design

Create a complete design system for Vibe Detector, a local-first desktop sample browser for music producers. The product scans sample folders and detects musical key, tempo/BPM, and sound type, then lets producers filter, preview, favorite, edit, match, and drag sounds directly into a DAW.

The brand should feel like a precise studio instrument: dark, focused, musical, fast, technical, and trusted. It should not feel like a generic SaaS landing page, a festival/DJ poster, a toy music app, or a neon nightclub cliche. The system should be practical enough for a dense product UI and expressive enough for a marketing website.

Use the existing visual anchors:

- Radar/detection motif.
- Circle of fifths as the signature brand graphic.
- Key equals color: every musical key maps to a hue around the circle of fifths.
- Waveform/audio preview language.
- Dark studio UI with luminous data accents.
- Product promise: "Detect the vibe of every sound."

Create guidelines for logo usage, color tokens, typography, iconography, spacing, components, website sections, app UI patterns, imagery, motion, and copy tone. Include a website template direction that uses the real product UI/screenshot as the first visual signal.

## Product Summary

Name: Vibe Detector

Tagline: Detect the vibe of every sound.

Category: Local-first desktop app for music producers, beatmakers, composers, sample-pack makers, and sound-library heavy workflows.

Core job: Find the right sample faster by detecting key, BPM, type/subtype, and useful musical matches.

Current app features:

- Add sample folders and scan recursively.
- Detect key, tempo, drum/melodic type, and subtypes.
- Filter by key, type, tempo, folders, favorites, and search.
- Preview instantly with waveform, looping, volume, and keyboard audition.
- Drag one or many files directly into a DAW.
- Manually correct key/BPM/type, tag, favorite, add notes.
- Vibe Match suggests nearby key/tempo companions for layering.
- Offline/local-first: nothing leaves the machine.

## Brand Personality

Vibe Detector should feel:

- Precise but creative.
- Dark, calm, and studio-native.
- Fast and signal-focused.
- Musical rather than corporate.
- Technical enough for producers, but not intimidating.
- Private and trustworthy.
- Exploratory: it helps producers discover relationships across their sound library.

Avoid:

- Generic purple SaaS gradients as the whole identity.
- Overly rounded, playful toy UI.
- EDM/festival visual cliches.
- Retro skeuomorphic audio gear unless used very sparingly.
- Stock photos of people in studios as primary brand assets.
- Abstract blobs/orbs that do not communicate sound, key, tempo, or detection.

## Visual Concept

Primary concept: "A radar for sound."

Supporting motifs:

- Radar sweep for detection/scanning.
- Twelve color points for pitch classes.
- Circle of fifths wheel for musical relationships.
- Waveform bars for sound preview.
- Sample rows and file metadata for productivity.
- Drag-to-DAW affordance for workflow speed.

The key-color wheel should be the signature visual across the brand. Use it as a real information system, not just decoration.

## Existing Assets To Share

Attach these files when asking Claude Design to create the system:

- App icon, 512px: `/Users/dakotapilkington/Documents/Build/VIBEDETECTOR/resources/icon.png`
- High-resolution app icon, 2048px: `/Users/dakotapilkington/Documents/Build/VIBEDETECTOR/build/icon-1024.png`
- macOS icon: `/Users/dakotapilkington/Documents/Build/VIBEDETECTOR/build/icon.icns`
- Windows icon: `/Users/dakotapilkington/Documents/Build/VIBEDETECTOR/build/icon.ico`
- Drag icon, 180px: `/Users/dakotapilkington/Documents/Build/VIBEDETECTOR/resources/dragIcon.png`
- Product screenshot: `/Users/dakotapilkington/Documents/Build/VIBEDETECTOR/docs/screenshot.png`
- App icon set: `/Users/dakotapilkington/Documents/Build/VIBEDETECTOR/build/icon.iconset/`

Current icon description:

- Dark rounded-square app icon.
- Radar target rings and crosshairs.
- Violet sweep wedge.
- White center dot.
- Twelve bright dots around the perimeter representing pitch classes.

Current wordmark in app:

- Uppercase "VIBE DETECTOR".
- "VIBE" in near-white.
- "DETECTOR" in violet/fuchsia gradient.
- Small radar mark in a violet rounded square.

## Typography

Current app fonts:

- Primary UI: Inter.
- Monospace/data: JetBrains Mono.

Recommended type system:

- Use Inter for all product UI, marketing body copy, navigation, buttons, labels, and headings.
- Use JetBrains Mono for BPM, time, duration, sample rate, file metadata, version numbers, and technical labels.
- Keep typography clean, compact, and scannable.
- Use uppercase micro-labels for sections like KEY, TYPE, TEMPO, SOURCES.
- Avoid script fonts, novelty display fonts, and faux music poster typography.

Suggested scale:

- Display/Hero: 56-72px desktop, 36-44px mobile, 700 weight.
- Page H1: 40-52px, 700.
- Section H2: 28-36px, 650/700.
- Product panel titles: 14-18px, 600/700.
- Body: 15-17px, 400/500.
- UI labels: 11-13px, 600, uppercase, increased letter spacing.
- Metadata: 11-13px JetBrains Mono, tabular numbers.

## Color System

The app is dark-first. The palette should not become only purple. Purple is the brand accent; the full key spectrum is the differentiator.

Core background tokens from the app:

| Token | Value | Use |
| --- | --- | --- |
| `ink-950` | `#070709` | Deepest page/app background |
| `ink-900` | `#0b0b11` | Main dark surface |
| `ink-850` | `#0f0f16` | Elevated dark surface |
| `ink-800` | `#12121b` | Panels and controls |
| `ink-700` | `#191924` | Raised rows/cards |
| `ink-600` | `#22222f` | Hover/secondary surface |
| `ink-500` | `#2d2d3c` | Borders and inactive fills |
| `ink-400` | `#3a3a4d` | Stronger borders/dividers |

Primary text and UI:

| Token | Value | Use |
| --- | --- | --- |
| `text-primary` | `#e7e7ef` | Main text |
| `text-secondary` | `rgba(255,255,255,0.70)` | Secondary labels |
| `text-muted` | `rgba(255,255,255,0.45)` | Metadata and inactive copy |
| `text-faint` | `rgba(255,255,255,0.30)` | Placeholders |
| `border-soft` | `rgba(255,255,255,0.08)` | Default UI border |
| `border-faint` | `rgba(255,255,255,0.05)` | Panel dividers |

Brand accents:

| Token | Value | Use |
| --- | --- | --- |
| `vibe` | `#8b5cff` | Primary action, focus, scan accent |
| `vibe-glow` | `#a884ff` | Glow and active accents |
| `vibe-soft` | `rgba(139,92,255,0.18)` | Selected states |
| `fuchsia` | `#d946ef` or `#e879f9` | Secondary gradient partner |
| `favorite` | `#ffd24a` | Star/favorite state |

Current page background:

```css
radial-gradient(1200px 800px at 80% -10%, #181826 0%, #0b0b11 55%, #08080d 100%)
```

## Key Color System

The product maps each musical key to hue around the circle of fifths. This is a core brand rule.

Major keys:

| Key | Hue |
| --- | --- |
| C | `hsl(0 82% 60%)` |
| G | `hsl(30 82% 60%)` |
| D | `hsl(60 82% 60%)` |
| A | `hsl(90 82% 60%)` |
| E | `hsl(120 82% 60%)` |
| B | `hsl(150 82% 60%)` |
| F# | `hsl(180 82% 60%)` |
| C# | `hsl(210 82% 60%)` |
| G# | `hsl(240 82% 60%)` |
| D# | `hsl(270 82% 60%)` |
| A# | `hsl(300 82% 60%)` |
| F | `hsl(330 82% 60%)` |

Minor keys use the same hue but softer saturation and lower lightness:

```css
hsl(KEY_HUE 58% 50%)
```

Unknown key:

```css
hsl(240 4% 46%)
```

Use key colors for:

- Key badges.
- Circle of fifths.
- Waveform accents.
- Selected preview/play states.
- Musical match chips.
- Marketing infographics about key relationships.

Do not use key colors randomly for non-musical decoration.

## Shape, Layout, And Surface Style

General direction:

- Dark surfaces with very restrained glass/blur.
- 1px soft white borders.
- Dense but breathable spacing.
- 8px radius for most controls and rows.
- 6px radius for compact inputs/chips.
- 12px radius only for larger CTAs or app icon-like marks.
- Full circles for play buttons, radar rings, and key wheel geometry.

Surface examples from the app:

- Panels: black/20 to ink surfaces with white/5 borders.
- Controls: white/5 fill, white/8 border.
- Selected states: vibe-soft fill and vibe border.
- Glass bottom player: black/30 with blur.

## Component Language

Core product components:

- App shell: top search bar, left filter rail, central sound list, right detail panel, bottom player.
- Key wheel: outer major ring, inner minor ring, center clear state.
- Key badge: compact colored pill with key text.
- Sound row: play button, key badge, filename, folder, mini waveform, type chip, BPM, duration, favorite.
- Type segmented control: All, Melodic, Drums.
- Tempo filters: preset pills plus min/max inputs.
- Source list: folder icon, count, checkbox, remove action.
- Detail panel: selected filename, drag-to-DAW target, editable key/BPM/type/tags/notes, vibe matches, file metadata.
- Player bar: large play, current sound, waveform, timecode, loop, volume.
- Empty state: radar animation and concise add-folder CTA.

Marketing/site components:

- Product hero using real screenshot or realistic UI composition.
- Key wheel feature panel.
- Workflow strip: Scan -> Detect -> Preview -> Drag.
- Feature blocks for key, BPM, type, Vibe Match, offline privacy.
- Screenshot callouts that point to actual UI regions.
- Download/install section.
- Trust/privacy panel for local-first/offline processing.

## Logo Guidance

Primary logo:

- Radar icon plus uppercase wordmark.
- "VIBE" in near-white.
- "DETECTOR" in violet/fuchsia or vibe accent.
- Keep the mark simple and legible at small sizes.

Icon usage:

- Use the current app icon as the canonical mark until a full logo suite exists.
- Preserve radar rings, sweep wedge, center dot, and twelve pitch-class dots.
- Use the icon on dark backgrounds by default.
- For light-background marketing usage, create a simplified dark mark variant.

Clearspace:

- Minimum clearspace should equal the center radar dot diameter or one quarter of the app-icon size, whichever is easier for the layout.

Do not:

- Replace the radar with generic headphones, vinyl, or waveform-only marks.
- Use rainbow colors without the circle-of-fifths logic.
- Put the logo in heavy capsules unless required by navigation.

## Iconography

Current app uses line icons with:

- 24px viewBox.
- 2px stroke.
- Round caps and joins.
- Minimal fills only for play/pause/favorite states.

Icon themes:

- Radar/detection.
- Play/pause/audio transport.
- Search/filter.
- Folder/library.
- Star/favorite.
- Music note/drum.
- Loop/volume.
- Reveal file.
- Sliders/settings.

## Motion

Motion should feel like scanning and auditioning, not spectacle.

Use:

- Radar sweep during scanning.
- Subtle breath/pulse for empty states and active detection.
- Waveform progress during preview.
- Small rise-in transitions for panels/rows.
- Hover/active transitions under 200ms.

Avoid:

- Bouncy playful animation.
- Excessive glow pulses.
- Full-page animated backgrounds that distract from the product.

Existing app animation names:

- `sweep`: 2.4s linear rotating scan.
- `breathe`: 1.8s opacity pulse.
- `risein`: 0.25s subtle enter.

## Copy Tone

Voice:

- Clear, compact, producer-native.
- Confident without hype.
- Practical and workflow-focused.
- Use musical terms accurately.

Good phrases:

- Detect the vibe of every sound.
- Scan sample folders.
- Find key, tempo, and type.
- Preview instantly.
- Drag straight into your DAW.
- Local-first. Offline. Your sounds stay on your machine.
- Match sounds by key and tempo.

Avoid:

- "AI-powered magic" unless the technical approach changes.
- Vague words like "revolutionary" or "game-changing".
- Over-explaining features inside the product UI.
- Fake social proof.

## Website Template Direction

First viewport:

- Dark studio-like background.
- Logo and navigation.
- H1 should be "Vibe Detector" or "Detect the vibe of every sound."
- Supporting line: "A local-first sample browser that detects key, BPM, and type so producers can find, preview, and drag the right sound into a DAW."
- Primary CTA: Download or Try Vibe Detector.
- Secondary CTA: View workflow or See features.
- Use the real product screenshot as the main visual signal.
- Include a visible hint of the next section below the fold.

Recommended sections:

1. Hero with product screenshot.
2. Workflow: Add folders, scan, filter, preview, drag.
3. Signature feature: Circle-of-fifths key wheel.
4. Detection grid: Key, BPM, drums/melodic type, Vibe Match.
5. Local-first privacy/offline section.
6. UI detail section with screenshot callouts.
7. Download/share/build notes.

## Design Deliverables To Ask Claude For

Ask Claude Design to produce:

- Logo suite: icon, horizontal lockup, monochrome mark, light/dark variants.
- Color tokens: dark UI, text, borders, vibe accent, key colors, semantic states.
- Typography scale using Inter and JetBrains Mono.
- Component library for app UI and marketing site.
- Website homepage template.
- Screenshot treatment and callout system.
- Social preview/Open Graph image direction.
- App store/download tile direction.
- Motion rules for radar sweep, waveform, scanning, and hover states.
- Do/don't examples for brand misuse.

