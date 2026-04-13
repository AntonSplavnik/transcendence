# Name Forge

A professional game name generator that creates invented words by combining rule-based morpheme blending with Markov chain smoothing. Built as an interactive CLI tool with a Rich TUI.

## What It Does

Name Forge generates unique, pronounceable game names that don't exist as real words. It works by:

1. **Morpheme Blending** — combines themed word fragments (prefixes, roots, suffixes) at natural phoneme boundaries
2. **Markov Chain Smoothing** — uses a trigram character model trained on 500+ fantasy/game names to make blends sound organic
3. **Scoring** — rates every generated name on 6 criteria so the best float to the top
4. **Learning** — tracks your favorites and biases future generations toward similar patterns

## Requirements

- Python 3.8+
- `rich` library

## Setup

```bash
pip install rich
```

## Usage

```bash
python tools/name_forge.py
```

### Step 1: Pick Themes

On launch you'll see five theme categories to blend:

| # | Theme | Description |
|---|-------|-------------|
| 1 | **Cute** | Diminutive, playful morphemes (pix-, -kin, -ling, -ette) |
| 2 | **Combat** | Action/impact morphemes (brawl-, clash-, smash-, -ix, -us) |
| 3 | **Fantasy** | Mythical/magical morphemes (val-, rune-, -heim, -gard, -ia) |
| 4 | **Arena** | Competitive/grand morphemes (titan-, apex-, -eon, -ium) |
| 5 | **Epic** | Power/scale morphemes (ultra-, mega-, nova-, -on, -ex) |

Enter numbers separated by commas (e.g. `1,2,3`) or type `all`.

Combining **Cute + Combat** is recommended for a cute arena fighter — it produces names that capture the contrast between adorable art and real combat mechanics.

### Step 2: Review Generated Names

Each round generates 20 names displayed in a scored table:

```
                    Round 1 — Generated Names
╭─────┬────────────────┬─────────┬────────┬────────┬────────┬────────┬───────┬───────╮
│   # │ Name           │  Score  │ Pron.  │ Memo.  │ Uniq.  │ Theme  │ Len.  │ Dom.  │
├─────┼────────────────┼─────────┼────────┼────────┼────────┼────────┼───────┼───────┤
│   1 │ Dewora         │  0.91   │ █████  │ █████  │ ███░░  │ █████  │ ████░ │ █████ │
├─────┼────────────────┼─────────┼────────┼────────┼────────┼────────┼───────┼───────┤
│   2 │ Ettebu         │  0.90   │ ████░  │ ████░  │ ████░  │ █████  │ ████░ │ █████ │
╰─────┴────────────────┴─────────┴────────┴────────┴────────┴────────┴───────┴───────╯
```

### Score Breakdown

| Criterion | Weight | What It Measures |
|-----------|--------|------------------|
| **Pron.** (Pronounceability) | 25% | Consonant-vowel ratio, no harsh clusters, natural flow |
| **Memo.** (Memorability) | 25% | 2-3 syllables, regular CV patterns, easy to recall |
| **Uniq.** (Uniqueness) | 20% | Levenshtein distance from common English words |
| **Theme** (Theme Alignment) | 15% | How much of the name traces to your selected morphemes |
| **Len.** (Length) | 10% | Bell curve centered on 6-8 characters |
| **Dom.** (Domain-likeness) | 5% | Clean alpha-only, no ambiguous letter pairs |

Names marked with `*` have been boosted because they share patterns with your previous favorites.

### Step 3: Mark Favorites

Enter the row numbers of names you like, separated by commas:

```
Action: 1,3,7
  + Dewora
  + Squibaduel
  + Stormeki
```

The feedback engine extracts morphemes and trigrams from your picks and boosts similar patterns in the next batch.

### Step 4: Iterate

| Command | Action |
|---------|--------|
| `1-20` | Add names to favorites (comma-separated) |
| `g` | Generate a fresh batch |
| `t` | Change theme selection |
| `e` | Export favorites to a `.txt` file |
| `q` | Quit (prompts to export) |

Repeat until you find the name. The more rounds you run and the more favorites you mark, the better the generator gets at producing names you'll like.

## How the Generator Works

### Morpheme Blending

Each name is assembled from tagged word parts:

```
prefix("brawl") + suffix("kin") → "Brawlkin"
prefix("pix")   + root("ora")   → "Pixora"
prefix("val")   + root("fury")  + suffix("on") → "Valfuryon"
```

Parts are blended at phoneme boundaries — if two consonants collide, a bridging vowel is inserted. If endings overlap with beginnings, they merge naturally.

### Markov Chain

A trigram character-level model trained on a corpus of game names, fantasy places, and character names. It's used two ways:

- **Pure generation** — creates entirely new words that "feel" like real names
- **Smoothing** — extends morpheme fragments with natural-sounding continuations

### Hybrid Pipeline

Each name is generated using one of three methods (randomly selected):

- **40%** — Pure morpheme blend
- **30%** — Morpheme prefix + Markov continuation
- **30%** — Pure Markov generation

This mix ensures variety: structured thematic names alongside organic surprises.

## Tips for Best Results

- **Start broad** — use `all` themes in round 1 to see what the generator produces
- **Narrow quickly** — after round 1, switch to 2-3 themes that match your vision
- **Like generously** — the feedback loop needs data; mark anything that's even close
- **Run 5+ rounds** — the generator improves significantly after 3-4 rounds of feedback
- **Say it out loud** — high scores don't guarantee a name sounds good spoken; trust your ear
