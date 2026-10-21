"""Builds words.js for Word Guess. Run once when the word rules change.

    pip install wordfreq lemminflect nltk
    python -m nltk.downloader wordnet
    python build-words.py

Answer words: Zipf frequency >= 3.0 (1 use per million words or more) in
wordfreq, a base form known to lemminflect (no plurals or past tenses),
and not in blocklist.txt.
Accepted guesses: real words with Zipf >= 1.0. A word is real when lemminflect
knows it, when WordNet knows it or its base form with a lowercase sense, or when
it is in allowlist.txt. So names ("steve"), words that are always capitalized
("monday", "french"), Roman numerals ("lxiii") and non-words ("prssa") are not
accepted. Blocklist words are not accepted either; rude blocklist words also
block their other forms ("wankers"). Answer words are always accepted.
(Until 2026-10-21 the web2 and gcide word lists also counted, with a loose
inflection rule. They let in thousands of names and non-words.)
"""
import json, pathlib, re
from wordfreq import top_n_list, zipf_frequency
from lemminflect import getAllLemmas, getAllInflections, getAllInflectionsOOV
from nltk.corpus import wordnet as wn

HERE = pathlib.Path(__file__).parent
LENGTHS = (5, 6, 7)
ANSWER_ZIPF = 3.0
GUESS_ZIPF = 1.0
ROMAN = re.compile(r'm*(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})')

def word_file(name):
    return {w for line in (HERE / name).read_text().splitlines()
            if not line.startswith('#') for w in line.split()}
block = word_file('blocklist.txt')
allow = word_file('allowlist.txt')
# Blocklist words above its "# EXACT" line also block their other forms as guesses.
block_forms = {w for line in (HERE / 'blocklist.txt').read_text().split('\n# EXACT\n')[0].splitlines()
               if not line.startswith('#') for w in line.split()}

def is_base(w):
    lem = getAllLemmas(w)
    return bool(lem) and any(w in v for v in lem.values())

def wordnet_base(w):
    # WordNet base form of w ("busked" -> "busk") when it has a lowercase sense.
    # Names and words that are always capitalized have only capitalized senses.
    # WordNet strips endings without a spelling check ("admited" -> "admit"), so a
    # form that is not w itself must also be a correct inflection of its base.
    for pos, upos in ((wn.NOUN, 'NOUN'), (wn.VERB, 'VERB'), (wn.ADJ, 'ADJ'), (wn.ADV, 'ADV')):
        b = wn.morphy(w, pos)
        if not (b and any(l.name() == b for s in wn.synsets(b, pos) for l in s.lemmas())):
            continue
        if b == w:
            return b
        if upos in ('NOUN', 'VERB'):
            known = getAllInflections(b, upos) or getAllInflectionsOOV(b, upos)   # {'NNS': ('boxes',)}
            if any(w in forms for forms in known.values()):
                return b
    return None

def is_real(w):
    if ROMAN.fullmatch(w):         # WordNet lists numbers such as "lxiii"
        return False
    return w in allow or bool(getAllLemmas(w)) or wordnet_base(w) is not None

def blocked_form(w):
    # A guess whose base word is blocked: "wankers" (wanker), "bitches" (bitch).
    bases = {l for v in getAllLemmas(w).values() for l in v} | {wordnet_base(w)}
    return bool(bases & block_forms)

def looks_inflected(w):
    # lemminflect lists some inflected forms as adjectives or nouns
    # ("blocked", "depths"). Drop them when the root is a known word.
    for suf, add in (('ies', 'y'), ('es', ''), ('s', ''), ('ed', ''), ('ed', 'e'),
                     ('ied', 'y'), ('ing', ''), ('ing', 'e')):
        if w.endswith(suf) and not w.endswith('ss'):
            root = w[:-len(suf)] + add
            if len(root) >= 3 and getAllLemmas(root) and root != w:
                return True
    # Doubled last letter before -ed or -ing: "capping" (cap), "fitted" (fit).
    for suf in ('ing', 'ed'):
        root = w[:-len(suf)]
        if w.endswith(suf) and len(root) >= 4 and root[-1] == root[-2] and getAllLemmas(root[:-1]):
            return True
    return False

answers = {L: [] for L in LENGTHS}
valid = {L: set() for L in LENGTHS}
for w in top_n_list('en', 10**7):
    if not (w.isascii() and w.isalpha() and w.islower() and len(w) in LENGTHS):
        continue
    z = zipf_frequency(w, 'en')
    if z < GUESS_ZIPF:
        break                      # the list is in frequency order
    if w in block:
        continue
    if is_real(w) and not blocked_form(w):
        valid[len(w)].add(w)
    if z >= ANSWER_ZIPF and is_base(w) and not looks_inflected(w):
        answers[len(w)].append(w)

def base_of(w):
    # Dictionary entry for an inflected guess: "boxes" -> "box". None if w is a base form.
    lem = getAllLemmas(w)
    if not lem:
        return wordnet_base(w)     # "lumens" -> "lumen"; None for "lumen" itself and allowlist words
    if any(w in v for v in lem.values()):
        return None
    for pos in ('NOUN', 'VERB', 'ADJ', 'ADV'):
        if pos in lem:
            return lem[pos][0]
    return next(iter(lem.values()))[0]

out = {'answers': {}, 'valid': {}, 'base': {}}
for L in LENGTHS:
    a = sorted(set(answers[L]))
    v = sorted(valid[L] | set(a))
    out['answers'][L] = ' '.join(a)
    out['valid'][L] = ' '.join(v)
    pairs = [(w, base_of(w)) for w in v]
    out['base'][L] = ' '.join(w + ':' + b for w, b in pairs if b and b != w)
    print(L, 'answers', len(a), 'valid', len(v))

(HERE / 'words.js').write_text(
    '// Made by build-words.py. Do not edit by hand.\n'
    '// Words are space-separated, in a-z order.\n'
    '// base: "guess:entry" pairs, so the book button opens "box" for "boxes".\n'
    'window.WG_WORDS = ' + json.dumps(out, indent=1) + ';\n')
