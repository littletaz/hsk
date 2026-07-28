async function boot() {
    await Promise.all([
    document.fonts.load('900 60px "Resource Han Rounded"'),
    document.fonts.load('600 15px "Quicksand"'),
    document.fonts.load('400 53px "Noto Sans SC"'),
    loadCardMask('assets/card-mask.png'),
    loadCardBorder('assets/card-border.png')
    ]);

    const canvas = document.getElementById('wall');
    const ALL_WORDS = [...HSK1, ...HSK2, ...HSK3];
    currentWords = ALL_WORDS;
    const wall = createWall(canvas, ALL_WORDS);
    setupFilterPanel(ALL_WORDS, wall);
    setupFilterToggle();
    setupSearch(wall);
}

// Updated by setupFilterPanel every time Level/Type changes -- search
// reads this so it only searches within whatever's currently filtered,
// not the full word list.
let currentWords = [];

// Strips tone marks/diacritics for forgiving pinyin matching (typing
// "wo" should find "wǒ" -- most people won't type tone marks).
function stripDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function setupSearch(wall) {
    const input = document.getElementById('search-input');
    input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    const rawQuery = input.value.trim();
    if (!rawQuery) return;
    const query = stripDiacritics(rawQuery.toLowerCase());

    const idx = findSearchMatch(currentWords, rawQuery, query);

    if (idx === -1) {
        input.classList.remove('search-not-found');
        void input.offsetWidth; // restart the animation if triggered again
        input.classList.add('search-not-found');
        return;
    }

    wall.centerCameraOnWordIndex(idx, true);
    });
}

// Splits a definition like "I; me" or "to see; to catch sight of" into
// individual searchable senses, so "I" or "me" alone can match precisely
// rather than only the whole "I; me" string.
function definitionSenses(def) {
    return def.split(/[;,]/).map(s => s.trim().toLowerCase());
}

// Two passes: exact matches (hanzi, pinyin, or a whole definition sense)
// always win first, since they're unambiguous. Only if nothing exact
// exists does this fall back to loose substring matching -- otherwise a
// short query like "i" could match some unrelated word whose definition
// merely contains that letter somewhere (e.g. "time"), rather than the
// word whose actual meaning is "I".
function findSearchMatch(words, rawQuery, query) {
    let idx = words.findIndex(w =>
    w.h === rawQuery ||
    stripDiacritics(w.p.toLowerCase()) === query ||
    definitionSenses(w.def).includes(query)
    );
    if (idx !== -1) return idx;

    return words.findIndex(w =>
    w.h.includes(rawQuery) ||
    stripDiacritics(w.p.toLowerCase()).includes(query) ||
    w.def.toLowerCase().includes(query)
    );
}

// Folds the 13 raw pos values into 6 practical groups -- number+classifier
// together (a number almost never appears without a measure word in
// Chinese, so splitting them apart isn't a useful distinction), and the
// long tail of grammar-glue words (adverb, particle, phrase, conjunction,
// prefix, suffix, interjection -- several of which are single-word
// categories on their own) folded into one "Function Words" bucket.
const POS_GROUPS = {
  noun: 'noun', verb: 'verb', pronoun: 'pronoun', adjective: 'adjective',
  number: 'numMeasure', classifier: 'numMeasure',
  adverb: 'func', particle: 'func', phrase: 'func',
  conjunction: 'func', prefix: 'func', suffix: 'func', interjection: 'func',
  preposition: 'func',
};
const GROUP_LABELS = {
    noun: 'Nouns', verb: 'Verbs', pronoun: 'Pronouns',
    numMeasure: 'Numbers & Measure Words', adjective: 'Adjectives',
    func: 'Function Words'
};

// Mirrors card.js's LEVEL_COLORS base values, so an active Level chip
// lights up in that level's actual wall color rather than a generic
// highlight. Only 1 and 2 exist in card.js right now -- add more here
// as new levels get their own palette.
const LEVEL_ACTIVE_COLORS = { 1: '#F8B51E', 2: '#1D7E89', 3: '#FD4F1C' };
const MAX_ENABLED_LEVEL = 6; // 7-9 shown as future placeholders, disabled

// Only real number-words get reordered; anything else (classifiers, or
// any word not in this table) keeps its original relative position,
// placed after all the ordered numbers.
const NUMBER_VALUES = {
    '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '百': 100,
    '千': 1000, '万': 10000, '半': 0.5, '一半': 0.5
};

function sortNumbersInPlace(words) {
    return words
    .map((w, i) => ({ w, i }))
    .sort((a, b) => {
        const keyA = (a.w.pos === 'number' && NUMBER_VALUES[a.w.h] !== undefined) ? NUMBER_VALUES[a.w.h] : 100000 + a.i;
        const keyB = (b.w.pos === 'number' && NUMBER_VALUES[b.w.h] !== undefined) ? NUMBER_VALUES[b.w.h] : 100000 + b.i;
        return keyA - keyB;
    })
    .map(x => x.w);
}

// Filter state persists across reloads via localStorage. Wrapped in
// try/catch since localStorage can throw in some private-browsing modes
// -- if that happens, filters just won't persist, not worth an error.
const FILTER_STORAGE_KEY = 'hskWallFilters';

function saveFilters(activeLevels, activeTypes) {
    try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
        levels: [...activeLevels],
        types: [...activeTypes]
    }));
    } catch (e) { /* ignore -- filters simply won't persist */ }
}

function loadFilters() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    // No saved state at all -- a real first visit, not someone who
    // deliberately cleared every filter (that would still save an
    // empty-but-present state, handled below). Default to HSK1.
    if (!raw) return { levels: [1], types: [] };
    const parsed = JSON.parse(raw);
    return {
      levels: Array.isArray(parsed.levels) ? parsed.levels : [],
      types: Array.isArray(parsed.types) ? parsed.types : []
    };
  } catch (e) {
    return { levels: [1], types: [] };
  }
}

// Level and Type are independent dimensions: a word must match the
// active Level selection (if any) AND the active Type selection (if
// any); within each dimension, matching any one active chip is enough.
function setupFilterPanel(allWords, wall) {
    const stored = loadFilters();
    const activeLevels = new Set(stored.levels);
    const activeTypes = new Set(stored.types);

    function applyFilters() {
    const filtered = allWords.filter(w =>
        (activeLevels.size === 0 || activeLevels.has(w.lvl)) &&
        (activeTypes.size === 0 || activeTypes.has(POS_GROUPS[w.pos] || w.pos))
    );
    currentWords = sortNumbersInPlace(filtered);
    wall.setActiveWords(currentWords);
    saveFilters(activeLevels, activeTypes);
    }

    // ---- Level row (fixed 1-9, not derived from data) ----
    const levelRow = document.getElementById('level-row');
    for (let lvl = 1; lvl <= 9; lvl++) {
    const btn = document.createElement('button');
    btn.className = 'filter-chip';
    btn.type = 'button';
    btn.textContent = 'HSK' + lvl;

    if (lvl > MAX_ENABLED_LEVEL) {
        btn.disabled = true;
        btn.classList.add('disabled');
    } else {
        if (activeLevels.has(lvl)) {
        btn.classList.add('active');
        btn.style.background = LEVEL_ACTIVE_COLORS[lvl] || '#1c1712';
        btn.style.color = '#1c1712';
        }
        btn.addEventListener('click', () => {
        if (activeLevels.has(lvl)) {
            activeLevels.delete(lvl);
            btn.classList.remove('active');
            btn.style.background = '';
            btn.style.color = '';
        } else {
            activeLevels.add(lvl);
            btn.classList.add('active');
            btn.style.background = LEVEL_ACTIVE_COLORS[lvl] || '#1c1712';
            btn.style.color = '#1c1712';
        }
        applyFilters();
        });
    }
    levelRow.appendChild(btn);
    }

    // ---- Type row (derived from data, same grouping as before) ----
    const typeRow = document.getElementById('type-row');
    const groups = [...new Set(allWords.map(w => POS_GROUPS[w.pos] || w.pos))].sort();
    groups.forEach(group => {
    const btn = document.createElement('button');
    btn.className = 'filter-chip';
    btn.type = 'button';
    btn.textContent = GROUP_LABELS[group] || group;
    if (activeTypes.has(group)) {
        btn.classList.add('active');
    }
    btn.addEventListener('click', () => {
        if (activeTypes.has(group)) {
        activeTypes.delete(group);
        btn.classList.remove('active');
        } else {
        activeTypes.add(group);
        btn.classList.add('active');
        }
        applyFilters();
    });
    typeRow.appendChild(btn);
    });

    // Apply any restored filters immediately so the wall reflects them on
    // load, instead of showing everything until the next click.
    if (activeLevels.size > 0 || activeTypes.size > 0) {
    applyFilters();
    }
}

function setupFilterToggle() {
    const toggle = document.getElementById('filter-toggle');
    const panel = document.getElementById('filter-panel');
    toggle.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    toggle.classList.toggle('active');
    });
}

boot();