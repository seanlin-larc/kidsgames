"""Builds words.js for Word Guess. Run once when the word rules change.

    pip install wordfreq lemminflect english-words
    python build-words.py

Answer words: Zipf frequency >= 3.0 (1 use per million words or more) in
wordfreq, a base form known to lemminflect (no plurals or past tenses),
and not in blocklist.txt.
Accepted guesses: real words with Zipf >= 1.0. A word is real when lemminflect
knows it, when it is in the web2 or gcide word lists, or when it is an
inflected form of such a word. Blocklist words are not accepted either.
"""
import json, pathlib
from wordfreq import top_n_list, zipf_frequency
from lemminflect import getAllLemmas, getAllLemmasOOV
from english_words import get_english_words_set

HERE = pathlib.Path(__file__).parent
LENGTHS = (5, 6, 7)
ANSWER_ZIPF = 3.0
GUESS_ZIPF = 1.0

block = {w for line in (HERE / 'blocklist.txt').read_text().splitlines()
         if not line.startswith('#') for w in line.split()}
dic = (get_english_words_set(['web2'], lower=True, alpha=True)
       | get_english_words_set(['gcide'], lower=True, alpha=True))

def is_base(w):
    lem = getAllLemmas(w)
    return bool(lem) and any(w in v for v in lem.values())

def is_real(w):
    if getAllLemmas(w) or w in dic:
        return True
    for pos in ('NOUN', 'VERB', 'ADJ'):
        for l in getAllLemmasOOV(w, pos).get(pos, ()):
            if l != w and (l in dic or getAllLemmas(l)):
                return True
    return False

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
    if is_real(w):
        valid[len(w)].add(w)
    if z >= ANSWER_ZIPF and is_base(w) and not looks_inflected(w):
        answers[len(w)].append(w)

def base_of(w):
    # Dictionary entry for an inflected guess: "boxes" -> "box". None if w is a base form.
    lem = getAllLemmas(w)
    if not lem or any(w in v for v in lem.values()):
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
