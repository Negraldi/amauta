"""Text saved without spaces between words ("Useronmobilecan'tseeHTML"): detect it, never repair it.

Pure and conservative. Only Latin-script text long enough to judge is judged; fenced and inline code and URLs are left
out of the measure; a text with a noticeable share of scripts written without spaces (CJK, Thai, ...) is never judged.
A text is flagged only when both signals agree: very few spaces for its letters, and a real share of its letters in
long lowercase runs (glued words), which identifiers and paths split by case or separators do not produce.
Used by the memory MCP server (refuse on write) and the portal quality report (flag what is already stored).
"""
import re

MIN_LETTERS = 80             # Latin letters needed before a text is judged at all
MIN_LETTERS_PER_WORD = 12    # prose averages 4-7 letters per space-separated word
LONG_RUN = 16                # a lowercase run this long is rarely one word
MIN_LONG_RUN_SHARE = 0.15    # share of letters inside such runs
MAX_UNSPACED_SCRIPT = 0.2    # share of CJK/Thai/Lao/Khmer/Myanmar/kana letters that exempts a text

_FENCE = re.compile(r"```.*?(?:```|\Z)|~~~.*?(?:~~~|\Z)", re.S)
_INLINE = re.compile(r"`[^`\n]*`")
_URL = re.compile(r"\b(?:[a-z][a-z0-9+.-]*://|www\.)\S+", re.I)
_LATIN = re.compile(r"[A-Za-zÀ-ɏ]")
_UNSPACED_SCRIPT = re.compile(r"[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]")
_LOWER_RUN = re.compile(r"[a-zß-öø-ÿ]+")


def measure(text):
    """The numbers the judgement uses: letters, letters per word, long-run share, unspaced-script share."""
    body = _URL.sub(" ", _INLINE.sub(" ", _FENCE.sub(" ", text or "")))
    letters = len(_LATIN.findall(body))
    other = len(_UNSPACED_SCRIPT.findall(body))
    words = sum(1 for w in body.split() if _LATIN.search(w))
    long_runs = sum(len(r) for r in _LOWER_RUN.findall(body) if len(r) >= LONG_RUN)
    return {
        "letters": letters,
        "letters_per_word": round(letters / words, 1) if words else 0.0,
        "long_run_share": round(long_runs / letters, 2) if letters else 0.0,
        "unspaced_script_share": round(other / (letters + other), 2) if letters + other else 0.0,
    }


def looks_unspaced(text):
    """True when the text reads as prose whose spaces were stripped. False when unsure."""
    m = measure(text)
    return (m["letters"] >= MIN_LETTERS and m["unspaced_script_share"] < MAX_UNSPACED_SCRIPT
            and m["letters_per_word"] >= MIN_LETTERS_PER_WORD and m["long_run_share"] >= MIN_LONG_RUN_SHARE)
