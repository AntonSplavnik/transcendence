# Game Name Generator — Design Spec

## Overview

A Python CLI tool (`tools/name_forge.py`) that generates invented game names by combining rule-based morpheme blending with Markov chain smoothing. Interactive Rich TUI with scoring and feedback loop.

## Architecture

```
Interactive CLI (Rich TUI)
  → Theme picker → Generate → Score → Rate → Refine
        │
Generator Engine
  ├── Morpheme Blender (theme-tagged word parts + phonetic rules)
  ├── Markov Chain (trigram model trained on fantasy/game name corpus)
  └── Merge: blend at phoneme boundaries, smooth with Markov
        │
Scoring Engine (6 criteria, weighted 0.0–1.0)
        │
Feedback Loop (liked names boost similar morphemes/trigrams)
```

## Components

### 1. Morpheme Database

Python dict of categorized word parts:

- **Themes**: `cute`, `combat`, `fantasy`, `arena`, `epic`
- **Parts**: `prefixes`, `roots`, `suffixes`
- Each morpheme tagged with phonetic properties (vowel/consonant start/end)

### 2. Markov Chain

- Trigram character-level model
- Trained on ~500 hardcoded fantasy/game names (existing game names, fantasy place names, character names)
- Generates organic letter sequences that "feel" like real words

### 3. Blending Pipeline

1. Pick 2–3 morphemes from selected themes
2. Blend at shared phoneme boundaries (e.g., "brawl" + "kin" → "Brawlkin")
3. Run Markov smoothing pass on awkward junctions
4. Filter out unpronounceable consonant clusters (no triple consonants, etc.)

### 4. Scoring Engine

Each criterion returns 0.0–1.0:

| Criterion | Weight | Method |
|-----------|--------|--------|
| Pronounceability | 25% | Consonant-vowel ratio, no triple consonants, known phoneme patterns |
| Memorability | 25% | Syllable count (2–3 ideal), CV pattern regularity |
| Uniqueness | 20% | Levenshtein distance from common English words (higher = more unique) |
| Theme alignment | 15% | % of output traceable to selected theme morphemes |
| Length | 10% | Bell curve centered on 6–8 characters |
| Domain-likeness | 5% | Lowercase-alpha only, no ambiguous spellings |

Final score = weighted average of all criteria.

### 5. Interactive Loop

1. **Pick themes** — multi-select from cute / combat / fantasy / arena / epic
2. **Generate** — produce 20 names, display as Rich table with score breakdown columns
3. **Rate** — user marks favorites by number
4. **Refine** — favorites boost their morphemes and trigrams in next generation
5. **Repeat** — until user exits; option to export favorites to `.txt`

## Dependencies

- `rich` — TUI tables, panels, prompts
- No other external dependencies. Pure Python for generation and scoring.

## File Structure

Single file: `tools/name_forge.py`. Self-contained, no package structure.

## Running

```bash
pip install rich
python tools/name_forge.py
```
