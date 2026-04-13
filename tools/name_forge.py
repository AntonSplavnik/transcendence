#!/usr/bin/env python3
"""
Name Forge — Game Name Generator
Generates invented words for game names using morpheme blending + Markov chain smoothing.
Interactive Rich TUI with scoring and feedback loop.
"""

import random
import math
import string
from collections import defaultdict

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.prompt import Prompt, IntPrompt
from rich.text import Text
from rich import box

console = Console()

# =============================================================================
# MORPHEME DATABASE
# =============================================================================

MORPHEMES = {
    "cute": {
        "prefixes": [
            ("pix", "c", "c"), ("chi", "c", "v"), ("lil", "c", "c"),
            ("pom", "c", "c"), ("mochi", "c", "v"), ("nub", "c", "c"),
            ("pip", "c", "c"), ("bun", "c", "c"), ("dew", "c", "v"),
            ("fluff", "c", "c"), ("tum", "c", "c"), ("wub", "c", "c"),
            ("squib", "c", "c"), ("fizz", "c", "c"), ("puff", "c", "c"),
        ],
        "roots": [
            ("kin", "c", "c"), ("let", "c", "c"), ("ling", "c", "c"),
            ("ette", "v", "v"), ("iko", "v", "v"), ("umi", "v", "v"),
            ("aki", "v", "v"), ("iki", "v", "v"), ("obi", "v", "v"),
            ("ori", "v", "v"), ("elu", "v", "v"), ("ino", "v", "v"),
        ],
        "suffixes": [
            ("le", "c", "v"), ("ie", "v", "v"), ("oo", "v", "v"),
            ("ki", "c", "v"), ("ni", "c", "v"), ("mi", "c", "v"),
            ("bu", "c", "v"), ("lu", "c", "v"), ("ri", "c", "v"),
            ("pi", "c", "v"), ("chi", "c", "v"), ("shi", "c", "v"),
        ],
    },
    "combat": {
        "prefixes": [
            ("brawl", "c", "c"), ("clash", "c", "c"), ("smash", "c", "c"),
            ("strike", "c", "v"), ("slash", "c", "c"), ("crush", "c", "c"),
            ("bonk", "c", "c"), ("thwack", "c", "c"), ("pummel", "c", "c"),
            ("rend", "c", "c"), ("shred", "c", "c"), ("blitz", "c", "c"),
            ("ram", "c", "c"), ("bash", "c", "c"), ("wreck", "c", "c"),
        ],
        "roots": [
            ("fray", "c", "v"), ("duel", "c", "c"), ("bout", "c", "c"),
            ("melee", "c", "v"), ("fury", "c", "v"), ("rage", "c", "v"),
            ("havoc", "c", "c"), ("onslaught", "v", "c"), ("siege", "c", "v"),
            ("storm", "c", "c"), ("bane", "c", "v"), ("strife", "c", "v"),
        ],
        "suffixes": [
            ("er", "v", "c"), ("or", "v", "c"), ("ix", "v", "c"),
            ("us", "v", "c"), ("ax", "v", "c"), ("on", "v", "c"),
            ("ek", "v", "c"), ("al", "v", "c"), ("um", "v", "c"),
            ("ik", "v", "c"), ("ar", "v", "c"), ("en", "v", "c"),
        ],
    },
    "fantasy": {
        "prefixes": [
            ("val", "c", "c"), ("eld", "v", "c"), ("myth", "c", "c"),
            ("rune", "c", "v"), ("glyph", "c", "c"), ("fae", "c", "v"),
            ("wyr", "c", "c"), ("sol", "c", "c"), ("lun", "c", "c"),
            ("astra", "v", "v"), ("crypt", "c", "c"), ("drak", "c", "c"),
            ("nyx", "c", "c"), ("zeph", "c", "c"), ("thor", "c", "c"),
        ],
        "roots": [
            ("ora", "v", "v"), ("heim", "c", "c"), ("gard", "c", "c"),
            ("helm", "c", "c"), ("thorn", "c", "c"), ("veil", "c", "c"),
            ("forge", "c", "v"), ("spire", "c", "v"), ("ward", "c", "c"),
            ("hallow", "c", "v"), ("shade", "c", "v"), ("blight", "c", "c"),
        ],
        "suffixes": [
            ("ia", "v", "v"), ("ium", "v", "c"), ("is", "v", "c"),
            ("os", "v", "c"), ("an", "v", "c"), ("el", "v", "c"),
            ("yn", "v", "c"), ("oth", "v", "c"), ("ael", "v", "c"),
            ("ire", "v", "v"), ("wyn", "v", "c"), ("ral", "v", "c"),
        ],
    },
    "arena": {
        "prefixes": [
            ("arena", "v", "v"), ("pit", "c", "c"), ("ring", "c", "c"),
            ("coloss", "c", "c"), ("glad", "c", "c"), ("titan", "c", "c"),
            ("apex", "v", "c"), ("prime", "c", "v"), ("crown", "c", "c"),
            ("iron", "v", "c"), ("steel", "c", "c"), ("stone", "c", "v"),
            ("grand", "c", "c"), ("crest", "c", "c"), ("peak", "c", "c"),
        ],
        "roots": [
            ("champion", "c", "c"), ("victor", "c", "c"), ("legend", "c", "c"),
            ("glory", "c", "v"), ("honor", "c", "c"), ("trial", "c", "c"),
            ("arena", "v", "v"), ("field", "c", "c"), ("ground", "c", "c"),
            ("dome", "c", "v"), ("vault", "c", "c"), ("hall", "c", "c"),
        ],
        "suffixes": [
            ("eon", "v", "c"), ("ium", "v", "c"), ("ica", "v", "v"),
            ("ion", "v", "c"), ("ade", "v", "v"), ("orn", "v", "c"),
            ("ess", "v", "c"), ("ance", "v", "v"), ("ent", "v", "c"),
            ("ium", "v", "c"), ("ux", "v", "c"), ("ax", "v", "c"),
        ],
    },
    "epic": {
        "prefixes": [
            ("ultra", "v", "v"), ("mega", "c", "v"), ("omni", "v", "v"),
            ("hyper", "c", "c"), ("nova", "c", "v"), ("proto", "c", "v"),
            ("arch", "v", "c"), ("neo", "c", "v"), ("phan", "c", "c"),
            ("vex", "c", "c"), ("zen", "c", "c"), ("flux", "c", "c"),
            ("supra", "c", "v"), ("exo", "v", "v"), ("aero", "v", "v"),
        ],
        "roots": [
            ("cron", "c", "c"), ("lex", "c", "c"), ("max", "c", "c"),
            ("nox", "c", "c"), ("plex", "c", "c"), ("rex", "c", "c"),
            ("surge", "c", "v"), ("pulse", "c", "v"), ("core", "c", "v"),
            ("prime", "c", "v"), ("volt", "c", "c"), ("spark", "c", "c"),
        ],
        "suffixes": [
            ("on", "v", "c"), ("ex", "v", "c"), ("us", "v", "c"),
            ("is", "v", "c"), ("os", "v", "c"), ("ix", "v", "c"),
            ("um", "v", "c"), ("al", "v", "c"), ("or", "v", "c"),
            ("ant", "v", "c"), ("yx", "v", "c"), ("az", "v", "c"),
        ],
    },
}

# =============================================================================
# MARKOV CHAIN
# =============================================================================

TRAINING_CORPUS = [
    # Existing game names
    "valorant", "fortnite", "splatoon", "brawlhalla", "overwatch",
    "minecraft", "terraria", "starcraft", "warcraft", "diablo",
    "palworld", "genshin", "zelda", "metroid", "castlevania",
    "bloodborne", "soulsborne", "hollowknight", "celeste", "hades",
    "transistor", "bastion", "pyre", "supergiant", "cuphead",
    "shovelknight", "undertale", "deltarune", "oneshot", "tunic",
    "crosscode", "hyperlight", "deadcells", "skullgirls", "brawlout",
    "rivals", "smashbros", "tekken", "soulcalibur", "blazblue",
    "guiltygear", "streetfighter", "mortalcombat", "injustice",
    # Fantasy place names
    "eldoria", "mythaven", "runegard", "solheim", "aetheron",
    "crystalis", "drakenvald", "faewhisper", "glyphmark", "ironspire",
    "lunarveil", "nyxhallow", "shadowfen", "thornwick", "valoria",
    "wyrmrest", "zenithpeak", "arcanum", "celestia", "dawnforge",
    "embercrest", "frostholm", "goldenvale", "havenreach", "ivyspire",
    "jadecrown", "knightfall", "luminara", "moonhaven", "nightward",
    "oakheart", "phoenixrise", "queensgate", "ravenhold", "stormveil",
    "thunderkeep", "umbravale", "vanguard", "windshear", "xenoblade",
    # Fantasy character-style names
    "azurath", "belvion", "corvaxis", "delvyn", "elorath",
    "fenwick", "galadorn", "halvex", "irontusk", "javelin",
    "kaldris", "lyranth", "mordaxis", "nexarian", "olvaris",
    "pyralith", "quillon", "ravonis", "silvex", "thalion",
    "umbrath", "vexaris", "wyldren", "xantheos", "yvellion",
    "zarathul", "aelindra", "bramwick", "cindrath", "duskara",
    # Cute-style names
    "kirby", "pikachu", "togepi", "jigglypuff", "clefairy",
    "moogle", "chocobo", "tonberry", "cactuar", "carbuncle",
    "pachimari", "molcar", "sumikko", "tamagotchi", "neopets",
    "webkinz", "furby", "amiibo", "toontown", "maplestory",
    "ragnarok", "flyff", "latale", "elsword", "dungeon",
    # Arena/competitive
    "colosseum", "gladiator", "tribunal", "crucible", "gauntlet",
    "olympus", "pantheon", "citadel", "bastion", "bulwark",
    "rampart", "sentinel", "vanguard", "paragon", "champion",
    "contender", "challenger", "maverick", "tempest", "typhoon",
]


class MarkovChain:
    def __init__(self, order=3):
        self.order = order
        self.transitions = defaultdict(lambda: defaultdict(int))
        self.starters = defaultdict(int)

    def train(self, corpus):
        for word in corpus:
            word = word.lower()
            padded = "^" * self.order + word + "$"
            self.starters[padded[self.order : self.order + 1]] += 1
            for i in range(len(padded) - self.order):
                context = padded[i : i + self.order]
                next_char = padded[i + self.order] if i + self.order < len(padded) else "$"
                self.transitions[context][next_char] += 1

    def generate(self, min_len=4, max_len=10):
        context = "^" * self.order
        result = []
        for _ in range(max_len + 5):
            choices = self.transitions.get(context)
            if not choices:
                break
            chars = list(choices.keys())
            weights = list(choices.values())
            next_char = random.choices(chars, weights=weights, k=1)[0]
            if next_char == "$":
                if len(result) >= min_len:
                    break
                else:
                    continue
            result.append(next_char)
            context = context[1:] + next_char
            if len(result) >= max_len:
                break
        return "".join(result)

    def score_transition(self, bigram):
        """How natural does this character transition feel? Returns 0.0-1.0."""
        if len(bigram) < 2:
            return 0.5
        context_key = None
        for ctx in self.transitions:
            if ctx.endswith(bigram[:-1]):
                context_key = ctx
                break
        if context_key is None:
            return 0.1
        choices = self.transitions[context_key]
        total = sum(choices.values())
        if bigram[-1] in choices:
            return min(1.0, choices[bigram[-1]] / total + 0.3)
        return 0.1

    def get_boosted_transitions(self, liked_names):
        """Extract trigrams from liked names for boosting."""
        trigrams = defaultdict(int)
        for name in liked_names:
            name = name.lower()
            for i in range(len(name) - 2):
                trigrams[name[i : i + 3]] += 1
        return trigrams


# =============================================================================
# BLENDING PIPELINE
# =============================================================================

VOWELS = set("aeiou")
CONSONANTS = set(string.ascii_lowercase) - VOWELS

BAD_CLUSTERS = [
    "bk", "dk", "fk", "gk", "hk", "jk", "kk", "mk", "pk", "tk", "vk", "wk",
    "xk", "zk", "bf", "df", "gf", "hf", "jf", "kf", "mf", "pf", "tf", "vf",
    "wf", "xf", "zf", "bv", "dv", "gv", "hv", "jv", "kv", "mv", "pv", "tv",
    "wv", "xv", "zv", "cj", "dj", "fj", "gj", "hj", "kj", "mj", "pj", "tj",
    "vj", "wj", "xj", "zj", "bx", "cx", "dx", "fx", "gx", "hx", "jx", "kx",
    "mx", "px", "rx", "sx", "tx", "vx", "wx", "zx", "qq", "xx", "zz",
]


def has_bad_clusters(word):
    word_lower = word.lower()
    for cluster in BAD_CLUSTERS:
        if cluster in word_lower:
            return True
    consonant_run = 0
    for ch in word_lower:
        if ch in CONSONANTS:
            consonant_run += 1
            if consonant_run >= 4:
                return True
        else:
            consonant_run = 0
    return False


def blend_at_boundary(part_a, part_b):
    """Blend two morphemes at their phoneme boundary."""
    a = part_a.lower()
    b = part_b.lower()

    # Try overlapping endings of a with beginnings of b
    best_overlap = 0
    for overlap_len in range(1, min(len(a), len(b)) + 1):
        if a[-overlap_len:] == b[:overlap_len]:
            best_overlap = overlap_len

    if best_overlap > 0:
        return a + b[best_overlap:]

    # If a ends with consonant and b starts with consonant, insert a bridging vowel
    if a[-1] in CONSONANTS and b[0] in CONSONANTS:
        bridge = random.choice(["a", "e", "i", "o", "u"])
        return a + bridge + b

    return a + b


def generate_blended_name(themes, morphemes_db, markov, min_len=4, max_len=10):
    """Generate a name by blending morphemes from selected themes."""
    # Pick a random structure
    structures = [
        ("prefixes", "suffixes"),
        ("prefixes", "roots"),
        ("roots", "suffixes"),
        ("prefixes", "roots", "suffixes"),
    ]
    structure = random.choice(structures)

    parts = []
    theme_parts_used = []
    for part_type in structure:
        theme = random.choice(themes)
        pool = morphemes_db[theme][part_type]
        morpheme_text, _, _ = random.choice(pool)
        parts.append(morpheme_text)
        theme_parts_used.append((theme, morpheme_text))

    # Blend parts together
    result = parts[0]
    for i in range(1, len(parts)):
        result = blend_at_boundary(result, parts[i])

    # Trim to max length
    if len(result) > max_len:
        result = result[:max_len]

    # Capitalize
    result = result.capitalize()

    return result, theme_parts_used


def generate_markov_name(markov, min_len=4, max_len=10):
    """Generate a pure Markov name."""
    for _ in range(50):
        name = markov.generate(min_len, max_len)
        if min_len <= len(name) <= max_len and not has_bad_clusters(name):
            return name.capitalize(), []
    return None, []


def generate_hybrid_name(themes, morphemes_db, markov, min_len=4, max_len=10):
    """Generate a name using both morpheme blending and Markov influence."""
    method = random.random()

    if method < 0.4:
        # Pure morpheme blend
        return generate_blended_name(themes, morphemes_db, markov, min_len, max_len)
    elif method < 0.7:
        # Morpheme prefix + Markov continuation
        theme = random.choice(themes)
        part_type = random.choice(["prefixes", "roots"])
        pool = morphemes_db[theme][part_type]
        morph_text, _, _ = random.choice(pool)

        # Use Markov to generate a suffix
        markov_tail = markov.generate(2, max_len - len(morph_text))
        if markov_tail:
            result = blend_at_boundary(morph_text, markov_tail)
            if len(result) > max_len:
                result = result[:max_len]
            return result.capitalize(), [(theme, morph_text)]
        return generate_blended_name(themes, morphemes_db, markov, min_len, max_len)
    else:
        # Pure Markov
        return generate_markov_name(markov, min_len, max_len)


# =============================================================================
# SCORING ENGINE
# =============================================================================

COMMON_WORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "her",
    "was", "one", "our", "out", "day", "had", "hot", "oil", "sit", "now",
    "old", "see", "way", "may", "say", "she", "two", "how", "boy", "did",
    "its", "let", "put", "too", "use", "dad", "mom", "set", "run", "got",
    "big", "red", "top", "cut", "eat", "far", "fly", "hit", "men", "low",
    "game", "play", "name", "word", "fight", "battle", "clash", "arena",
    "champion", "hero", "war", "sword", "shield", "magic", "quest", "realm",
    "king", "dark", "light", "fire", "storm", "blade", "forge", "iron",
    "steel", "stone", "gold", "star", "moon", "sun", "wind", "shadow",
    "knight", "rogue", "mage", "ranger", "warrior", "hunter", "thief",
}


def levenshtein(s1, s2):
    if len(s1) < len(s2):
        return levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = prev_row[j + 1] + 1
            deletions = curr_row[j] + 1
            substitutions = prev_row[j] + (c1 != c2)
            curr_row.append(min(insertions, deletions, substitutions))
        prev_row = curr_row
    return prev_row[-1]


def count_syllables(word):
    word = word.lower()
    count = 0
    prev_vowel = False
    for ch in word:
        is_vowel = ch in VOWELS
        if is_vowel and not prev_vowel:
            count += 1
        prev_vowel = is_vowel
    return max(1, count)


def score_pronounceability(name):
    """Score based on consonant-vowel patterns and cluster quality."""
    lower = name.lower()
    if has_bad_clusters(lower):
        return 0.1

    # Check consonant-vowel ratio
    vowel_count = sum(1 for c in lower if c in VOWELS)
    ratio = vowel_count / len(lower) if lower else 0

    # Ideal ratio is around 0.35-0.55
    if 0.30 <= ratio <= 0.60:
        ratio_score = 1.0
    elif 0.20 <= ratio <= 0.70:
        ratio_score = 0.7
    else:
        ratio_score = 0.3

    # Check for alternating CV patterns (more pronounceable)
    alternation = 0
    for i in range(1, len(lower)):
        a_vowel = lower[i - 1] in VOWELS
        b_vowel = lower[i] in VOWELS
        if a_vowel != b_vowel:
            alternation += 1
    alt_score = alternation / max(1, len(lower) - 1)

    return ratio_score * 0.5 + alt_score * 0.5


def score_uniqueness(name):
    """Score based on distance from common English words."""
    lower = name.lower()
    min_dist = float("inf")
    for word in COMMON_WORDS:
        dist = levenshtein(lower, word)
        min_dist = min(min_dist, dist)
    # Normalize: 0 distance = 0.0 score, 5+ distance = 1.0
    return min(1.0, min_dist / 5.0)


def score_length(name):
    """Bell curve centered on 6-8 characters."""
    length = len(name)
    ideal = 7.0
    sigma = 2.0
    return math.exp(-0.5 * ((length - ideal) / sigma) ** 2)


def score_memorability(name):
    """Score based on syllable count and CV pattern regularity."""
    syllables = count_syllables(name)
    # 2-3 syllables is ideal
    if 2 <= syllables <= 3:
        syl_score = 1.0
    elif syllables == 1 or syllables == 4:
        syl_score = 0.6
    else:
        syl_score = 0.3

    # CV pattern regularity
    lower = name.lower()
    pattern = ""
    for ch in lower:
        pattern += "V" if ch in VOWELS else "C"

    # Count CV and VC transitions (more regular = more memorable)
    good_transitions = 0
    for i in range(len(pattern) - 1):
        if pattern[i] != pattern[i + 1]:
            good_transitions += 1
    regularity = good_transitions / max(1, len(pattern) - 1)

    return syl_score * 0.6 + regularity * 0.4


def score_theme_alignment(name, theme_parts):
    """Score based on how much of the name traces to theme morphemes."""
    if not theme_parts:
        return 0.3  # Pure Markov names get a baseline
    lower = name.lower()
    covered_chars = 0
    for _, morph in theme_parts:
        if morph.lower() in lower:
            covered_chars += len(morph)
    return min(1.0, covered_chars / max(1, len(lower)))


def score_domain_likeness(name):
    """Score based on domain name suitability."""
    lower = name.lower()
    # All alpha?
    if not lower.isalpha():
        return 0.2
    # Length suitable for domain?
    if len(lower) < 3 or len(lower) > 12:
        return 0.3
    # No ambiguous letter pairs
    ambiguous = ["ii", "ll", "oo", "ee"]
    for pair in ambiguous:
        if pair in lower:
            return 0.6
    return 1.0


WEIGHTS = {
    "pronounceability": 0.25,
    "memorability": 0.25,
    "uniqueness": 0.20,
    "theme_alignment": 0.15,
    "length": 0.10,
    "domain_likeness": 0.05,
}


def score_name(name, theme_parts):
    """Score a name on all criteria. Returns (total, breakdown)."""
    scores = {
        "pronounceability": score_pronounceability(name),
        "memorability": score_memorability(name),
        "uniqueness": score_uniqueness(name),
        "theme_alignment": score_theme_alignment(name, theme_parts),
        "length": score_length(name),
        "domain_likeness": score_domain_likeness(name),
    }
    total = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)
    return total, scores


# =============================================================================
# FEEDBACK SYSTEM
# =============================================================================

class FeedbackEngine:
    def __init__(self):
        self.liked_morphemes = defaultdict(int)
        self.liked_trigrams = defaultdict(int)

    def record_like(self, name, theme_parts):
        lower = name.lower()
        for _, morph in theme_parts:
            self.liked_morphemes[morph.lower()] += 2
        for i in range(len(lower) - 2):
            self.liked_trigrams[lower[i : i + 3]] += 1

    def boost_score(self, name, theme_parts):
        """Extra score boost based on similarity to liked names."""
        if not self.liked_morphemes and not self.liked_trigrams:
            return 0.0
        lower = name.lower()
        morph_boost = 0
        for _, morph in theme_parts:
            morph_boost += self.liked_morphemes.get(morph.lower(), 0)

        tri_boost = 0
        for i in range(len(lower) - 2):
            tri_boost += self.liked_trigrams.get(lower[i : i + 3], 0)

        return min(0.3, (morph_boost * 0.05 + tri_boost * 0.02))


# =============================================================================
# NAME GENERATION MANAGER
# =============================================================================

def generate_batch(themes, morphemes_db, markov, feedback, batch_size=20):
    """Generate a batch of scored, unique names."""
    candidates = []
    seen = set()
    attempts = 0
    max_attempts = batch_size * 15

    while len(candidates) < batch_size and attempts < max_attempts:
        attempts += 1
        name, theme_parts = generate_hybrid_name(themes, morphemes_db, markov)
        if name is None:
            continue
        lower = name.lower()
        if lower in seen or len(name) < 3:
            continue
        if has_bad_clusters(lower):
            continue
        seen.add(lower)

        total, breakdown = score_name(name, theme_parts)
        boost = feedback.boost_score(name, theme_parts)
        total = min(1.0, total + boost)

        candidates.append({
            "name": name,
            "theme_parts": theme_parts,
            "total": total,
            "breakdown": breakdown,
            "boosted": boost > 0,
        })

    candidates.sort(key=lambda x: x["total"], reverse=True)
    return candidates


# =============================================================================
# RICH TUI
# =============================================================================

def display_banner():
    banner = Text()
    banner.append("  NAME FORGE  ", style="bold white on dark_orange3")
    banner.append("  Game Name Generator", style="dim")
    console.print()
    console.print(Panel(banner, box=box.DOUBLE, border_style="dark_orange3"))
    console.print()


def display_theme_picker(available_themes):
    console.print("[bold]Select themes to blend:[/bold]")
    console.print("[dim]Enter numbers separated by commas, or 'all' for everything[/dim]")
    console.print()
    for i, theme in enumerate(available_themes, 1):
        count = sum(
            len(MORPHEMES[theme][pt])
            for pt in ["prefixes", "roots", "suffixes"]
        )
        console.print(f"  [dark_orange3]{i}[/dark_orange3]. [bold]{theme.capitalize()}[/bold] [dim]({count} morphemes)[/dim]")
    console.print()


def display_results(candidates, round_num):
    table = Table(
        title=f"Round {round_num} — Generated Names",
        box=box.ROUNDED,
        border_style="dark_orange3",
        title_style="bold dark_orange3",
        show_lines=True,
    )
    table.add_column("#", style="dim", width=3, justify="right")
    table.add_column("Name", style="bold white", min_width=14)
    table.add_column("Score", justify="center", width=7)
    table.add_column("Pron.", justify="center", width=6)
    table.add_column("Memo.", justify="center", width=6)
    table.add_column("Uniq.", justify="center", width=6)
    table.add_column("Theme", justify="center", width=6)
    table.add_column("Len.", justify="center", width=5)
    table.add_column("Dom.", justify="center", width=5)

    for i, c in enumerate(candidates, 1):
        b = c["breakdown"]

        def bar(val):
            filled = int(val * 5)
            color = "green" if val >= 0.7 else "yellow" if val >= 0.4 else "red"
            return f"[{color}]{'█' * filled}{'░' * (5 - filled)}[/{color}]"

        boosted_marker = " [dim cyan]*[/dim cyan]" if c.get("boosted") else ""
        score_color = "green" if c["total"] >= 0.7 else "yellow" if c["total"] >= 0.5 else "red"

        table.add_row(
            str(i),
            c["name"] + boosted_marker,
            f"[bold {score_color}]{c['total']:.2f}[/bold {score_color}]",
            bar(b["pronounceability"]),
            bar(b["memorability"]),
            bar(b["uniqueness"]),
            bar(b["theme_alignment"]),
            bar(b["length"]),
            bar(b["domain_likeness"]),
        )

    console.print()
    console.print(table)
    console.print("[dim cyan]*[/dim cyan] [dim]= boosted by your previous likes[/dim]")
    console.print()


def display_favorites(favorites):
    if not favorites:
        return
    console.print(Panel(
        "\n".join(f"  [bold dark_orange3]{name}[/bold dark_orange3]" for name in favorites),
        title="Your Favorites",
        border_style="green",
        box=box.ROUNDED,
    ))
    console.print()


def export_favorites(favorites):
    if not favorites:
        console.print("[yellow]No favorites to export.[/yellow]")
        return
    filename = Prompt.ask("Export filename", default="name_forge_favorites.txt")
    with open(filename, "w") as f:
        f.write("# Name Forge — Favorites\n\n")
        for name in favorites:
            f.write(f"{name}\n")
    console.print(f"[green]Exported {len(favorites)} names to {filename}[/green]")


def main():
    display_banner()

    # Initialize Markov chain
    markov = MarkovChain(order=3)
    markov.train(TRAINING_CORPUS)
    feedback = FeedbackEngine()

    available_themes = list(MORPHEMES.keys())

    # Theme selection
    display_theme_picker(available_themes)
    theme_input = Prompt.ask("Themes").strip().lower()

    if theme_input == "all":
        selected_themes = available_themes[:]
    else:
        indices = []
        for part in theme_input.replace(" ", "").split(","):
            try:
                idx = int(part) - 1
                if 0 <= idx < len(available_themes):
                    indices.append(idx)
            except ValueError:
                # Try matching by name
                for i, t in enumerate(available_themes):
                    if t.startswith(part):
                        indices.append(i)
        selected_themes = list({available_themes[i] for i in indices})

    if not selected_themes:
        selected_themes = available_themes[:]
        console.print("[yellow]No valid themes selected, using all.[/yellow]")

    console.print(f"[bold]Using themes:[/bold] {', '.join(t.capitalize() for t in selected_themes)}")
    console.print()

    favorites = []
    all_candidates = []
    round_num = 0

    while True:
        round_num += 1
        candidates = generate_batch(selected_themes, MORPHEMES, markov, feedback)
        all_candidates = candidates
        display_results(candidates, round_num)

        if favorites:
            display_favorites(favorites)

        console.print("[bold]Actions:[/bold]")
        console.print("  [dark_orange3]1-20[/dark_orange3]  — Add to favorites (comma-separated)")
        console.print("  [dark_orange3]g[/dark_orange3]     — Generate another batch")
        console.print("  [dark_orange3]t[/dark_orange3]     — Change themes")
        console.print("  [dark_orange3]e[/dark_orange3]     — Export favorites to file")
        console.print("  [dark_orange3]q[/dark_orange3]     — Quit")
        console.print()

        action = Prompt.ask("Action").strip().lower()

        if action == "q":
            if favorites:
                export_choice = Prompt.ask("Export favorites before quitting?", choices=["y", "n"], default="y")
                if export_choice == "y":
                    export_favorites(favorites)
            console.print("[bold dark_orange3]Thanks for using Name Forge![/bold dark_orange3]")
            break
        elif action == "g":
            continue
        elif action == "t":
            display_theme_picker(available_themes)
            theme_input = Prompt.ask("Themes").strip().lower()
            if theme_input == "all":
                selected_themes = available_themes[:]
            else:
                indices = []
                for part in theme_input.replace(" ", "").split(","):
                    try:
                        idx = int(part) - 1
                        if 0 <= idx < len(available_themes):
                            indices.append(idx)
                    except ValueError:
                        for i, t in enumerate(available_themes):
                            if t.startswith(part):
                                indices.append(i)
                selected_themes = list({available_themes[i] for i in indices})
            if not selected_themes:
                selected_themes = available_themes[:]
            console.print(f"[bold]Using themes:[/bold] {', '.join(t.capitalize() for t in selected_themes)}")
        elif action == "e":
            export_favorites(favorites)
        else:
            # Parse number selections
            try:
                nums = [int(x.strip()) for x in action.split(",") if x.strip()]
                for n in nums:
                    if 1 <= n <= len(all_candidates):
                        c = all_candidates[n - 1]
                        if c["name"] not in favorites:
                            favorites.append(c["name"])
                            feedback.record_like(c["name"], c["theme_parts"])
                            console.print(f"  [green]+ {c['name']}[/green]")
                        else:
                            console.print(f"  [dim]{c['name']} already in favorites[/dim]")
            except ValueError:
                console.print("[red]Unknown action. Try a number, 'g', 't', 'e', or 'q'.[/red]")


if __name__ == "__main__":
    main()
