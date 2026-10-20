let francAll = null;
let langs = null;

// Attempt to load libraries asynchronously without blocking the app
import('https://esm.sh/franc@6.2.0?bundle')
    .then(module => { francAll = module.francAll; })
    .catch(err => console.warn('franc failed to load from esm.sh:', err));

import('https://esm.sh/langs@2.0.0')
    .then(module => { langs = module.default; }) // 'langs' is a default export
    .catch(err => console.warn('langs failed to load from esm.sh:', err));

const FADE_DELAY_MS = 800;

let currentContentLang = 'en'; // Use primary code
let currentLineChars = [];
let isWordRevokeEnabled = true;

// Maps for the Searchable Selector
let langCodeToName = {};
let langNameToCode = {};

// Special map for 3-letter codes that 'langs' lib doesn't cover
// (e.g., script variations for Chinese)
const ISO3_TO_SPECIAL_CLDR = {
    'cmn': 'zh-Hans', // Mandarin -> Simplified Chinese
    'zho': 'zh',      // Chinese (general)
    'yue': 'zh-Hant'  // Cantonese -> Traditional Chinese
};

// Languages that don't use spaces for word separation
const NO_SPACE_LANGS = ['ja', 'zh', 'th', 'ko', 'lo', 'my', 'bo', 'km'];
// (Japanese, Chinese, Thai, Korean, Lao, Burmese, Tibetan, Khmer)

// Languages with Right-to-Left direction
const RTL_LANGS = ['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv'];
// (Arabic, Hebrew, Persian, Urdu, Pashto, Sindhi, Yiddish, Divehi)

// Regex Markers
const RE_ARABIC = /\p{Script=Arabic}/u;
const RE_HEBREW = /\p{Script=Hebrew}/u;
const RE_HAN = /\p{Script=Han}/u;
const RE_HIRAGANA = /\p{Script=Hiragana}/u;
const RE_KATAKANA = /\p{Script=Katakana}/u;
const RE_HANGUL = /\p{Script=Hangul}/u;
const RE_DEVANAGARI = /\p{Script=Devanagari}/u;
const RE_BENGALI = /\p{Script=Bengali}/u;
const RE_THAI = /\p{Script=Thai}/u;
const RE_KHMER = /\p{Script=Khmer}/u;
const RE_LAO = /\p{Script=Lao}/u;
const RE_MYANMAR = /\p{Script=Myanmar}/u;
const RE_CYRILLIC = /\p{Script=Cyrillic}/u;
const RE_ARMENIAN = /\p{Script=Armenian}/u;
const RE_ETHIOPIC = /\p{Script=Ethiopic}/u;
const RE_GEORGIAN = /\p{Script=Georgian}/u;
// Arabic-script finer markers
const RE_PERSIAN_MARKERS = /[\u067E\u0686\u0698\u06AF\u06A9\u06CC\u06C0\u06BE]/u; // پ چ ژ گ ک ی ...
const RE_URDU_MARKERS = /[\u0679\u0688\u06C1\u06BE\u06BA\u06D2\u06D3\u06C0\u0681]/u; // Urdu-specific shapes

// Common Titles/Honorifics (Keep this: these ALMOST ALWAYS require merging)
const ABBR_TITLES = /^(?:Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Sr|Jr|St|Capt|Col|Gen|Lt|Sgt)\.$/i;
// REMOVED: const ABBR_INITIALS = ... (Too aggressive for "Index A.")
// REMOVED: const ABBR_ACRONYMS = ... (Too aggressive for lists)

// Valid plain-text extensions
const EXTENSION_LIST = ['bat', 'c', 'cfg', 'conf', 'cpp', 'cs', 'css', 'csv', 'go', 'h', 'hpp', 'html', 'ini', 'java', 'js', 'json', 'jsx', 'kt', 'log', 'lua', 'markdown', 'md', 'php', 'pl', 'ps1', 'py', 'rb', 'rs', 'sh', 'sql', 'srt', 'swift', 'text', 'toml', 'ts', 'tsv', 'tsx', 'txt', 'xml', 'yaml', 'yml'];
const ALLOWED_EXTS = new RegExp(`\\.(${EXTENSION_LIST.join('|')})$`, 'i');
const ACCEPT_ATTR_STRING = EXTENSION_LIST.map(ext => '.' + ext).join(',') + ',text/plain';
// Mistyping one of these doesn't cost the whole word.
const REVOKE_EXEMPT = [' ', '—', '_', '/', '.', ',', ';', ':', '!', '?', '"', "'", '(', ')', '[', ']'];

// Reduces an accented letter to its base form (é -> e, ñ -> n) via Unicode
// decomposition. Only folds precomposed base+diacritic pairs; letters that
// are independently encoded (ø, ß, ı, æ, ð...) pass through unchanged.
function stripDiacritics(ch) {
    return ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// App state
let lines = [];
let sequence = [];
let currentIndex = -1;
let currentLine = '';
let position = 0;
let mistakes = 0;
let isComposing = false;
let mode = 'shuffle';
let isAutopilot = false;
let isSpeechUnlocked = false;
let shuffleStateBeforeEssays = null;
let isFileRunPerfect = true; // Tracks if the whole file has been perfect so far
let isFileFinished = false;  // Tracks if we are showing the end screen

// Elements
const linesWrapper = document.getElementById('lines-wrapper');
const teleprompter = document.getElementById('teleprompter');
const shuffleCheckbox = document.getElementById('shuffle');
const wordRevokeCheckbox = document.getElementById('word-revoke');
const autoNextCheckbox = document.getElementById('auto-next');
const dictationCheckbox = document.getElementById('dictation');
const resultElem = document.getElementById('result');
const inputElem = document.getElementById('input');
const nextBtn = document.getElementById('next-btn');
const autopilotBtn = document.getElementById('autopilot-btn');
const autopilotContainer = document.getElementById('autopilot-container');
const playIcon = autopilotBtn.querySelector('.icon-play');
const stopIcon = autopilotBtn.querySelector('.icon-stop');
const presetSourcesList = document.getElementById('preset-sources-list');
const customSourcesList = document.getElementById('custom-sources-list');
const openFolderBtn = document.getElementById('open-folder-btn');
const chooseFileBtn = document.getElementById('choose-file-btn');
const importInput = document.getElementById('import-input');
const textarea = document.getElementById('custom-text');
const loadBtn = document.getElementById('load-btn');
const exportBtn = document.getElementById('export-btn');
const langInput = document.getElementById('lang-input');
// --- ELEMENTS FOR COLLAPSIBLE SIDEBARS ---
const leftSidebar = document.getElementById('left-sidebar');
const rightSidebar = document.getElementById('right-sidebar');
const leftToggleBtn = document.getElementById('left-sidebar-toggle');
const rightToggleBtn = document.getElementById('right-sidebar-toggle');
const backdrop = document.getElementById('overlay-backdrop');

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// --- FUNCTIONS AND LISTENERS FOR SIDEBAR TOGGLING ---
function closeAllSidebars() {
    leftSidebar.classList.remove('is-overlay-visible');
    rightSidebar.classList.remove('is-overlay-visible');
    backdrop.classList.remove('is-visible');
    leftToggleBtn.setAttribute('aria-expanded', 'false');
    rightToggleBtn.setAttribute('aria-expanded', 'false');
}

leftToggleBtn.addEventListener('click', () => {
    const isVisible = leftSidebar.classList.contains('is-overlay-visible');
    closeAllSidebars(); // Close any other open sidebar first
    if (!isVisible) {
        leftSidebar.classList.add('is-overlay-visible');
        backdrop.classList.add('is-visible');
        leftToggleBtn.setAttribute('aria-expanded', 'true');
        leftSidebar.focus({ preventScroll: true });
    }
});

rightToggleBtn.addEventListener('click', () => {
    const isVisible = rightSidebar.classList.contains('is-overlay-visible');
    closeAllSidebars(); // Close any other open sidebar first
    if (!isVisible) {
        rightSidebar.classList.add('is-overlay-visible');
        backdrop.classList.add('is-visible');
        rightToggleBtn.setAttribute('aria-expanded', 'true');
        rightSidebar.focus({ preventScroll: true });
    }
});

// Backdrop click or Escape closes the open sidebar and returns focus to its toggle
function closeAndRestoreFocus() {
    const opener = leftSidebar.classList.contains('is-overlay-visible') ? leftToggleBtn : rightToggleBtn;
    closeAllSidebars();
    opener.focus({ preventScroll: true });
}
backdrop.addEventListener('click', closeAndRestoreFocus);
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop.classList.contains('is-visible')) closeAndRestoreFocus();
});

// Also close sidebars if the user resizes back to desktop view
window.addEventListener('resize', debounce(() => {
    if (window.innerWidth > 1100) closeAllSidebars();
    if (currentIndex >= 0 && !isFileFinished) {
        renderTeleprompter();
    }
}, 150));

// Check for browser speech synthesis support
function checkSpeechSynthesis() {
    if (!('speechSynthesis' in window)) {
        // Total browser incompatibility
        disableSpeechFeatures('Speech synthesis not supported by this browser');
        return;
    }
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
        // No voices installed at all
        disableSpeechFeatures('No speech synthesis voices found on this system');
        return;
    }
    // Now, check for a voice that matches the *current* language
    const hasCompatibleVoice = voices.some(voice => voice.lang.startsWith(currentContentLang) || voice.lang.startsWith(currentContentLang.split('-')[0]));
    if (hasCompatibleVoice) {
        enableSpeechFeatures();
    } else {
        disableSpeechFeatures(`No voice found for the selected language (${currentContentLang})`);
    }
}

function stopSpeech() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function disableSpeechFeatures(title) {
    dictationCheckbox.disabled = true;
    dictationCheckbox.parentElement.classList.add('disabled-feature');
    dictationCheckbox.parentElement.title = title;
    autopilotBtn.disabled = true;
    autopilotContainer.classList.add('disabled-feature');
    autopilotContainer.title = title;
}

function enableSpeechFeatures() {
    dictationCheckbox.disabled = false;
    dictationCheckbox.parentElement.classList.remove('disabled-feature');
    dictationCheckbox.parentElement.title = '';
    autopilotBtn.disabled = false;
    autopilotContainer.classList.remove('disabled-feature');
    autopilotContainer.title = '';
}

if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = checkSpeechSynthesis;
checkSpeechSynthesis(); // Initial check on load

// --- SEARCHABLE LANGUAGE SELECTOR ---
const CLDR_URL = 'https://cdn.jsdelivr.net/npm/cldr-localenames-full@48.2.0/main/en/languages.json';

async function populateLangSelector() {
    const dataList = document.getElementById('lang-list');

    let browserLocale = navigator.language || 'en';
    try {
        browserLocale = Intl.getCanonicalLocales(browserLocale)[0] || browserLocale;
    } catch (err) { }

    // The tag list still has to come from CLDR — there's no browser API that enumerates
    // language codes. Try the live, actively-maintained package first, capped at 3s;
    // if the CDN is unreachable, blocked, or slow, fall back to the vendored copy of
    // the same file, served same-origin.
    let codes = null;
    try {
        const r = await fetch(CLDR_URL, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        codes = Object.keys((await r.json()).main.en.localeDisplayNames.languages);
    } catch (err) {
        console.warn('CLDR CDN unreachable, using local languages.json fallback.', err);
        try {
            const r = await fetch('/languages.json');
            if (r.ok) codes = Object.keys((await r.json()).main.en.localeDisplayNames.languages);
        } catch (err2) {
            console.error('Local languages.json fallback also failed.', err2);
        }
    }
    if (!codes) return; // selector stays empty; the rest of the app still works

    codes = codes.filter(tag => !tag.includes('-alt-') && !tag.includes('-menu-'));

    // Localized names come from the browser's own CLDR data — no network, no third party.
    let displayNames = null;
    try {
        displayNames = new Intl.DisplayNames([browserLocale], { type: 'language', fallback: 'none' });
    } catch (err) { } // practically never throws — supported in every major browser since 2021

    const seen = new Set();
    const entries = [];
    for (const tag of codes) {
        let label;
        if (displayNames) {
            try { label = displayNames.of(tag); } catch (err) { }
            if (!label) continue; // browser has no name for this tag — skip it, keep the list clean
        } else {
            label = tag; // last-resort fallback if Intl.DisplayNames is ever unavailable
        }
        if (label.length >= 60 || seen.has(label)) continue;
        seen.add(label);
        entries.push([tag, label]);
    }
    entries.sort((a, b) => a[1].localeCompare(b[1], displayNames ? browserLocale : 'en', { sensitivity: 'base' }));

    langCodeToName = {};
    langNameToCode = {};
    dataList.innerHTML = '';
    for (const [tag, label] of entries) {
        langCodeToName[tag] = label;
        langNameToCode[label] = tag;
        const opt = document.createElement('option');
        opt.value = label;
        dataList.appendChild(opt);
    }
}

// --- SHARED FUNCTION ---
// Apply language-dependent behaviour. Does NOT touch the text on screen.
function applyLanguageSettings(code) {
    if (!code) return;
    currentContentLang = code;
    updateDirection();
    updateWordRevokeAvailability();
    checkSpeechSynthesis();
}

// Re-split what's already loaded under the new language's rules.
function resegmentCurrentText() {
    if (!lines.length) return;
    lines = splitIntoLines(lines.join('\n'));
    resetAndRender();
}

function handleLanguageChange(nameValue) {
    const code = langNameToCode[nameValue];
    if (!code || code === currentContentLang) return;
    applyLanguageSettings(code);
    resegmentCurrentText();
}

langInput.addEventListener('change', (e) => {
    handleLanguageChange(e.target.value);
});

// --- HELPER FUNCTIONS ---
function restoreShuffleState() {
    // Check if we are *currently* on Essays
    const currentSourceIsEssays = activeSourceElement && activeSourceElement.textContent === 'Essays';

    if (currentSourceIsEssays && shuffleStateBeforeEssays !== null) {
        // We are leaving Essays. Restore the state.
        if (shuffleCheckbox.checked !== shuffleStateBeforeEssays) {
            shuffleCheckbox.checked = shuffleStateBeforeEssays;
            mode = shuffleStateBeforeEssays ? 'shuffle' : 'ordered';
            localStorage.setItem('shuffle', shuffleStateBeforeEssays.toString());
        }
    }
}

function updateDirection() {
    // Get the primary code (e.g., 'en' from 'en-US' or 'zh' from 'zh-Hans')
    const primary = (currentContentLang || '').split('-')[0];
    const isRTL = RTL_LANGS.includes(primary);

    if (isRTL) {
        // For RTL: caret on the left, text flows right
        inputElem.dir = 'rtl';
        inputElem.style.textAlign = 'left';
        inputElem.style.unicodeBidi = 'bidi-override'; // Maintain the override
    } else {
        // For LTR (default): caret on the right, text flows left
        inputElem.dir = 'ltr';
        inputElem.style.textAlign = 'right';
        inputElem.style.unicodeBidi = 'bidi-override'; // Maintain the override
    }

    // Set direction for the teleprompter lines (this doesn't need alignment)
    teleprompter.dir = isRTL ? 'rtl' : 'ltr';
}

function updateWordRevokeAvailability() {
    const primary = (currentContentLang || '').split('-')[0];
    isWordRevokeEnabled = !NO_SPACE_LANGS.includes(primary);

    wordRevokeCheckbox.disabled = !isWordRevokeEnabled;
    wordRevokeCheckbox.parentElement.classList.toggle('disabled-feature', !isWordRevokeEnabled);
    wordRevokeCheckbox.parentElement.title = !isWordRevokeEnabled ? 'Not available for non-spaced languages' : '';
}

// Closest name we have for a code ('en-US' -> 'en' -> "English"), or ''.
function langLabelFor(code) {
    if (!code) return '';
    if (langCodeToName[code]) return langCodeToName[code];
    return langCodeToName[code.split('-')[0]] || '';
}

// Sets the visible selector text only. No side effects on typing state.
function syncLangInputLabel(code) {
    langInput.value = langLabelFor(code);
}

function setDetectedLanguage(code) {
    applyLanguageSettings(code);
    syncLangInputLabel(code);
}

function resetLanguageSelector() {
    langInput.value = '';
}

function detectAndSetLanguage(text) {
    if (!text) { resetLanguageSelector(); return; }
    const trimmed = text.trim();
    if (!trimmed) { resetLanguageSelector(); return; }

    // --- 1. SCRIPT HEURISTICS (Fast path for non-Latin scripts) ---
    if (RE_HEBREW.test(trimmed)) { setDetectedLanguage('he'); return; }
    if (RE_ARABIC.test(trimmed)) {
        if (RE_PERSIAN_MARKERS.test(trimmed)) { setDetectedLanguage('fa'); return; }
        if (RE_URDU_MARKERS.test(trimmed)) { setDetectedLanguage('ur'); return; }
        setDetectedLanguage('ar'); return;
    }
    if (RE_HAN.test(trimmed) || RE_HIRAGANA.test(trimmed) || RE_KATAKANA.test(trimmed)) {
        if (RE_HIRAGANA.test(trimmed) || RE_KATAKANA.test(trimmed)) {
            setDetectedLanguage('ja'); return;
        }
        setDetectedLanguage('zh'); return;
    }
    if (RE_HANGUL.test(trimmed)) { setDetectedLanguage('ko'); return; }
    if (RE_THAI.test(trimmed)) { setDetectedLanguage('th'); return; }
    if (RE_KHMER.test(trimmed)) { setDetectedLanguage('km'); return; }
    if (RE_LAO.test(trimmed)) { setDetectedLanguage('lo'); return; }
    if (RE_DEVANAGARI.test(trimmed)) { setDetectedLanguage('hi'); return; }
    if (RE_BENGALI.test(trimmed)) { setDetectedLanguage('bn'); return; }
    if (RE_MYANMAR.test(trimmed)) { setDetectedLanguage('my'); return; }
    if (RE_CYRILLIC.test(trimmed)) { setDetectedLanguage('ru'); return; }
    if (RE_ARMENIAN.test(trimmed)) { setDetectedLanguage('hy'); return; }
    if (RE_ETHIOPIC.test(trimmed)) { setDetectedLanguage('am'); return; }
    if (RE_GEORGIAN.test(trimmed)) { setDetectedLanguage('ka'); return; }

    // --- 2. FAST ENGLISH CHECK ---
    // Franc struggles with short text (< 50 chars). 
    // If we see unambiguous English stopwords, we trust them over the n-gram model.
    // Words: the, and, that, have, with, this, from, is, are, was, were
    const RE_COMMON_ENGLISH = /\b(the|and|that|have|with|this|from|is|are|was|were)\b/i;

    if (RE_COMMON_ENGLISH.test(trimmed)) {
        setDetectedLanguage('en');
        return;
    }

    // --- 3. STATISTICAL DETECTION (Franc) ---
    if (!francAll || !langs) {
        console.warn('Language libraries (franc/langs) not loaded.');
        resetLanguageSelector(); return;
    }

    let guesses;
    try {
        guesses = francAll(trimmed);
    } catch (err) {
        console.warn('francAll failed', err);
        resetLanguageSelector(); return;
    }
    if (!guesses || guesses.length === 0) { resetLanguageSelector(); return; }

    const [topIso3, topScore] = guesses[0];
    const isShort = trimmed.length < 25;

    // Keep the rigorous threshold for other languages
    const scoreThreshold = isShort ? 0.80 : 0.40;

    if (topIso3 === 'und' || topScore < scoreThreshold) {
        resetLanguageSelector(); return;
    }

    // --- 4. MAP GUESS TO CLDR KEY ---
    let cldrKey = null;
    if (ISO3_TO_SPECIAL_CLDR[topIso3]) {
        cldrKey = ISO3_TO_SPECIAL_CLDR[topIso3];
    } else {
        const langInfo = langs.where('3', topIso3);
        if (langInfo && langInfo['1']) cldrKey = langInfo['1'];
    }

    if (cldrKey) setDetectedLanguage(cldrKey);
    else resetLanguageSelector();
}

function normalizeQuotes(text) {
    return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function splitIntoLines(text) {
    text = normalizeQuotes(text || '');
    text = text.trim().normalize('NFC');
    if (!text) return [];

    // 1. Split into explicit paragraphs/lines first
    const paragraphs = text.split(/\r?\n+/).map(p => p.trim()).filter(Boolean);
    const results = [];

    let segLang = currentContentLang || 'en';
    // (Script detection fallback inside split omitted for brevity, usually currentContentLang is enough)

    let segger = null;
    try {
        segger = new Intl.Segmenter(segLang, { granularity: 'sentence' });
    } catch (err) {
        try { segger = new Intl.Segmenter('en', { granularity: 'sentence' }); } catch (e) { }
    }

    // 2. Process EACH paragraph individually
    for (const para of paragraphs) {
        let paraSegments = []; // Hold segments for JUST this paragraph

        if (segger) {
            try {
                const segments = Array.from(segger.segment(para));
                for (const s of segments) {
                    const segText = s.segment.trim();
                    if (segText) paraSegments.push(segText);
                }
            } catch (e) {
                paraSegments.push(para);
            }
        } else {
            paraSegments.push(para);
        }

        // 3. Merging Loop: Now only merges sentences WITHIN the same paragraph
        for (let i = 0; i < paraSegments.length - 1; i++) {
            const segment = paraSegments[i];
            const nextSegment = paraSegments[i + 1];

            if (!segment || !nextSegment) continue;

            const words = segment.split(/\s+/);
            const lastWord = words[words.length - 1];

            // Always merge known titles (e.g., "Mr." + "Smith")
            const isTitle = ABBR_TITLES.test(lastWord);

            // Only merge other things (like initials/acronyms) if the NEXT line 
            // starts with a LOWERCASE letter (indicating a broken sentence).
            // Note: We simply check if the first char is distinct from its uppercase version.
            const firstChar = nextSegment.charAt(0);
            const isContinuation = firstChar === firstChar.toLowerCase() && firstChar !== firstChar.toUpperCase();

            if (isTitle || isContinuation) {
                // Merge with the next line
                paraSegments[i] = paraSegments[i] + ' ' + nextSegment;
                paraSegments.splice(i + 1, 1);
                i--; // Step back to re-check
            }
        }

        // 4. Push the fully processed paragraph segments into the final array
        results.push(...paraSegments);
    }

    return results.length ? results : [text];
}

function initCheckbox(key, checkbox, defaultValue = true) {
    if (localStorage.getItem(key) !== null) {
        checkbox.checked = localStorage.getItem(key) === 'true';
    } else {
        localStorage.setItem(key, defaultValue.toString());
        checkbox.checked = defaultValue;
    }
    checkbox.addEventListener('change', () => localStorage.setItem(key, checkbox.checked));
}

initCheckbox('word-revoke', wordRevokeCheckbox, true);
initCheckbox('auto-next', autoNextCheckbox, true);
initCheckbox('shuffle', shuffleCheckbox, true);

shuffleCheckbox.addEventListener('change', () => {
    stopSpeech();
    mode = shuffleCheckbox.checked ? 'shuffle' : 'ordered';

    // If we are currently on Essays, update the 'before' state
    // so we restore this new preference when we leave.
    const currentSourceIsEssays = activeSourceElement && activeSourceElement.textContent === 'Essays';
    if (currentSourceIsEssays) {
        shuffleStateBeforeEssays = shuffleCheckbox.checked;
    }

    resetSequence();

    // Wrap the newLine call in a short timeout...
    setTimeout(() => {
        if (sequence.length) newLine(true);
    }, 50);
});

mode = shuffleCheckbox.checked ? 'shuffle' : 'ordered';

dictationCheckbox.checked = false;
dictationCheckbox.addEventListener('change', () => {
    // Prevent manual trigger if Autopilot is already handling speech
    if (dictationCheckbox.checked && currentLine && !isAutopilot) {
        if (!isSpeechUnlocked) {
            speechSynthesis.speak(new SpeechSynthesisUtterance(''));
            isSpeechUnlocked = true;
        }
        speakText(currentLine);
    }
});

const PRESET_SOURCES = {
    'Essays': '/texts/Essays.txt',
    'Sentences': '/texts/Sentences.txt',
    'Thesaurus': '/texts/Thesaurus.txt'
};
let activeSourceElement = null;
let localFileHandles = new Map();

function renderPresetSources() {
    presetSourcesList.innerHTML = '';
    for (const [name, path] of Object.entries(PRESET_SOURCES)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'source-item';
        item.textContent = name;
        item.dataset.path = path;
        item.addEventListener('click', () => handleSourceClick(item, 'preset'));
        presetSourcesList.appendChild(item);
    }
}

function setActiveSource(element) {
    if (activeSourceElement) {
        activeSourceElement.classList.remove('active');
        activeSourceElement.removeAttribute('aria-current');
    }
    activeSourceElement = element;
    if (!element) return;
    element.classList.add('active');
    element.setAttribute('aria-current', 'true');
}

async function handleSourceClick(element, type) {
    stopSpeech();

    const newSourceText = element ? element.textContent : null;
    const isSwitchingToEssays = newSourceText === 'Essays';

    // Check if we are *currently* on Essays
    const currentSourceIsEssays = activeSourceElement && activeSourceElement.textContent === 'Essays';

    if (isSwitchingToEssays) {
        // We are clicking ON "Essays".
        // Store the current shuffle state *before* changing it.
        // We only store it if we're not *already* on Essays (to avoid overwriting it if the user double-clicks)
        if (!currentSourceIsEssays) shuffleStateBeforeEssays = shuffleCheckbox.checked;

        // Now, force-uncheck it (if it's checked)
        if (shuffleCheckbox.checked) {
            shuffleCheckbox.checked = false;
            mode = 'ordered';
            localStorage.setItem('shuffle', 'false');
        }
    } else {
        restoreShuffleState();
    }

    setActiveSource(element);
    renderLoadingText('Loading...');

    let text = ''; // Define text variable here
    try {
        if (type === 'preset') {
            const r = await fetch(element.dataset.path);
            if (!r.ok) throw new Error(r.status);
            text = await r.text();
        } else if (type === 'custom') {
            const f = await localFileHandles.get(element).getFile();
            text = await f.text();
        } else if (type === 'custom-single-file') {
            const f = localFileHandles.get(element);
            text = await f.text();
        }
    } catch (err) {
        console.error(err);
        renderLoadingText('⚠️ Failed to load');
        return;
    }
    // Now that we have text, detect language FIRST
    detectAndSetLanguage(text);
    // THEN split lines (which now uses the new currentContentLang)
    lines = splitIntoLines(text);
    resetAndRender();
}

function resetAndRender() {
    resetSequence();
    newLine(true);
}

function updateCustomListPlaceholder() {
    const placeholder = document.getElementById('custom-list-placeholder');
    const hasFiles = customSourcesList.querySelector('.source-item');

    // If there are no files and no placeholder exists, create one.
    if (!hasFiles && !placeholder) {
        const el = document.createElement('div');
        el.id = 'custom-list-placeholder';

        const displayList = ['txt', 'md', 'csv', 'srt', 'js', 'py', 'html', 'json'];

        el.innerHTML = `
                    <p>Supported languages: any.</p>
                    <p>Supported formats: ${displayList.map(ext => '.' + ext).join(', ')}, and other UTF-8 text files.</p>
                    <p>None of your data leaves your device.<br>
                        Your files are processed locally.<br>
                        No database or server elsewhere.</p>
                    <p>To clear the file list, reload the page.</p>
                `;

        customSourcesList.appendChild(el);
    }
    // If there ARE files and a placeholder exists, remove it.
    else if (hasFiles && placeholder) {
        placeholder.remove();
    }
}

function updateOpenFolderAvailability() {
    if ('showDirectoryPicker' in window) return; // Chrome/Edge/Chromium: leave fully enabled
    openFolderBtn.setAttribute('aria-disabled', 'true');
    openFolderBtn.classList.add('disabled-feature');
    openFolderBtn.title = 'Folder import needs a browser feature (File System Access) this browser doesn\'t support yet — try Chrome, Edge, or another Chromium-based browser.';
}
updateOpenFolderAvailability();

openFolderBtn.addEventListener('click', async () => {
    if (openFolderBtn.getAttribute('aria-disabled') === 'true') {
        alert(openFolderBtn.title);
        return;
    }
    try {
        const dirHandle = await window.showDirectoryPicker();

        // 1. Collect all valid file entries into an array first
        const files = [];
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && ALLOWED_EXTS.test(entry.name)) files.push(entry);
        }

        // 2. Sort the array alphabetically by file name
        files.sort((a, b) => a.name.localeCompare(b.name));

        // 3. Clear the old list and build the new one from the sorted array
        customSourcesList.innerHTML = '';
        localFileHandles.clear(); // Clear the map before repopulating

        for (const entry of files) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'source-item';
            item.textContent = entry.name;
            customSourcesList.appendChild(item);

            localFileHandles.set(item, entry);
            item.addEventListener('click', () => handleSourceClick(item, 'custom'));
        }
        updateCustomListPlaceholder();
    } catch (err) {
        console.log('Directory picker was cancelled or failed.', err);
    }
});

chooseFileBtn.addEventListener('click', () => importInput.click());

importInput.addEventListener('change', (e) => {
    if (!e.target.files) return;

    // 1. Convert the FileList to an array and sort it
    const files = Array.from(e.target.files);
    files.sort((a, b) => a.name.localeCompare(b.name));

    // 2. Loop through the sorted array to add files
    for (const file of files) {
        if (ALLOWED_EXTS.test(file.name)) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'source-item';
            item.textContent = file.name;
            customSourcesList.appendChild(item);

            localFileHandles.set(item, file);
            item.addEventListener('click', () => handleSourceClick(item, 'custom-single-file'));
        }
    }
    updateCustomListPlaceholder();
    e.target.value = ''; // Reset input
});

// Keep paste, but maybe debounce it so it doesn't fire multiple times if they paste rapidly.
textarea.addEventListener('paste', debounce(() => loadBtn.click(), 200));

textarea.addEventListener('input', debounce(() => {
    localStorage.setItem('saved_custom_text', textarea.value);
}, 500));

loadBtn.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) return;

    restoreShuffleState();

    // Un-highlight any selected file in the sidebars
    if (activeSourceElement) {
        activeSourceElement.classList.remove('active');
        activeSourceElement = null;
    }

    // Detect language FIRST
    detectAndSetLanguage(text);
    // THEN split lines
    lines = splitIntoLines(text);
    resetAndRender();
});

exportBtn.addEventListener('click', () => {
    const textToExport = textarea.value;
    if (!textToExport) return;
    const blob = new Blob([textToExport], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom-text.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function renderLoadingText(text) {
    linesWrapper.innerHTML = '';

    linesWrapper.classList.add('centered-wrapper');

    const div = document.createElement('div');
    div.className = 'line faded';
    div.style.margin = '0';

    // 2. Center the text within the line (Text Alignment)
    // This fixes the "slightly above center" issue
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.style.width = '100%'; // Ensure it spans width to center properly

    div.textContent = text;
    linesWrapper.appendChild(div);
}

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function resetSequence() {
    if (mode === 'shuffle') sequence = shuffleArray(lines || []);
    else sequence = (lines || []).slice();
    currentIndex = -1;
    linesWrapper.innerHTML = '';

    // Unlock the input for the new run
    inputElem.readOnly = false;

    // Reset completion tracking
    isFileRunPerfect = true;
    isFileFinished = false;
}

function renderTeleprompter() {
    linesWrapper.classList.remove('centered-wrapper');

    if (!sequence || sequence.length === 0) {
        // Show empty state (uses loading style centering)
        renderLoadingText('Select a source from the right sidebar to begin.');
        return;
    }

    if (linesWrapper.childElementCount !== sequence.length) {
        linesWrapper.innerHTML = '';

        // Create a Fragment to hold elements in memory
        const fragment = document.createDocumentFragment();

        sequence.forEach((text) => {
            const line = document.createElement('div');
            line.setAttribute('role', 'listitem');
            line.className = 'line faded';
            const textSpan = document.createElement('span');
            textSpan.className = 'textSpan';
            textSpan.textContent = text;
            line.appendChild(textSpan);

            // Append to fragment instead of DOM
            fragment.appendChild(line);
        });

        // Write to DOM only once
        linesWrapper.appendChild(fragment);
    }

    const lineEls = linesWrapper.querySelectorAll('.line');
    lineEls.forEach((el, i) => {
        if (i === currentIndex) {
            el.classList.add('active');
            el.classList.remove('faded');
        } else {
            el.classList.add('faded');
            el.classList.remove('active');
        }
    });
    requestAnimationFrame(() => {
        const activeEl = linesWrapper.querySelector('.line.active');
        if (!activeEl) return;
        const activeTop = activeEl.offsetTop;
        const activeHeight = activeEl.offsetHeight;
        const activeCenter = activeTop + activeHeight / 2;
        const containerCenter = teleprompter.clientHeight / 2;
        const translateY = containerCenter - activeCenter;
        linesWrapper.style.transform = `translateY(${translateY}px)`;
    });
}

function speakText(text, onEndCallback = () => { }) {
    if (!('speechSynthesis' in window)) return;

    const voices = speechSynthesis.getVoices();
    const utterance = new SpeechSynthesisUtterance(text);

    // Helper: Normalize language tags (e.g. "en_GB" -> "en-gb")
    const normalize = (tag) => tag.replace('_', '-').toLowerCase();
    const normalizedTarget = normalize(currentContentLang);

    let targetVoice = null;

    // --- STRATEGY: EXACT MATCH ONLY ---
    // 1. Look for a voice that matches the specific region exactly.
    //    - Chrome: Finds "Oliver" for "en-GB".
    //    - Safari 26: Finds "Daniel" for "en-GB".
    //    - Safari 16: Finds nothing for "en-GB" (voices hidden).
    const exactMatches = voices.filter(v => normalize(v.lang) === normalizedTarget);

    if (exactMatches.length > 0) {
        // Prefer the default voice if multiple exist for this region
        targetVoice = exactMatches.find(v => v.default) || exactMatches[0];
    }

    // --- APPLY ---
    if (targetVoice) {
        // We found an exact match (e.g. User asked for GB, we found GB)
        utterance.voice = targetVoice;
        utterance.lang = targetVoice.lang;
    } else {
        // We found NO exact match.
        // EXAMPLES:
        // 1. User asked for "en" (Generic). We have no voice named "en".
        //    -> We leave voice as NULL.
        //    -> Chrome sees lang="en" + voice=null -> Uses OS Default (Oliver).
        // 2. User asked for "en-GB" on Safari 16 (Hidden voices).
        //    -> We found no GB voice.
        //    -> We leave voice as NULL.
        //    -> Safari 16 sees lang="en-GB" -> Uses hidden GB voice.
        utterance.voice = null;
        utterance.lang = currentContentLang;
    }

    // --- DEBUG LOG ---
    utterance.onstart = (event) => {
        const v = event.target.voice;
        // If v is null, the browser chose the voice internally
        const voiceName = v ? `${v.name} (${v.lang})` : 'System/Browser Default';
        console.log(`🗣️ Speaking [${currentContentLang}]: ${voiceName}`);
    };

    utterance.onend = onEndCallback;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
}

function showResult(text, colorClass = '') {
    resultElem.textContent = text;
    resultElem.classList.remove('perfect', 'success');
    if (colorClass) resultElem.classList.add(colorClass);
    resultElem.style.opacity = '1';
    clearTimeout(resultElem._fadeTimer);
    resultElem._fadeTimer = setTimeout(() => {
        resultElem.style.opacity = '0';
    }, FADE_DELAY_MS);
}

function showFileCompletion() {
    isFileFinished = true;
    inputElem.readOnly = true;
    inputElem.focus();
    linesWrapper.innerHTML = '';

    linesWrapper.classList.add('centered-wrapper');

    const container = document.createElement('div');
    container.className = 'completion-container';

    if (isFileRunPerfect) {
        triggerConfetti();
        container.innerHTML = `
                    <div class="completion-title trophy">🏆 Perfect Run!</div>
                    <div class="completion-subtitle">You typed every line without a single error.</div>
                    <div class="completion-action">Press Enter to restart</div>
                `;
        if (dictationCheckbox.checked) speakText('Perfect run! Congratulations.');
    } else {
        container.innerHTML = `
                    <div class="completion-title">🏁 File Completed</div>
                    <div class="completion-subtitle">Good job. Keep practising to reach perfection.</div>
                    <div class="completion-action">Press Enter to restart</div>
                `;
        if (dictationCheckbox.checked) speakText('File completed.');
    }
    linesWrapper.appendChild(container);
}

function triggerConfetti() {
    // 1. RESPECT REDUCED MOTION
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) return;

    const emojis = ['⭐'];
    const particleCount = 45;
    const mainElement = document.querySelector('main');

    // Safety check for positioning
    if (getComputedStyle(mainElement).position === 'static') {
        mainElement.style.position = 'relative';
    }

    // 2. STORE OVERFLOW
    const originalOverflow = mainElement.style.overflow;
    mainElement.style.overflow = 'hidden';

    let activeParticles = 0;

    for (let i = 0; i < particleCount; i++) {
        const el = document.createElement('div');
        el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        el.className = 'falling-item';

        el.style.left = Math.random() * 100 + '%';
        el.style.fontSize = (Math.random() * 20 + 20) + 'px';

        const duration = Math.random() * 2 + 2; // 2s to 4s
        const delay = Math.random() * 1.5;      // 0s to 1.5s

        el.style.animationDuration = duration + 's';
        el.style.animationDelay = delay + 's';

        // Increment count of active particles
        activeParticles++;

        // 3. ROBUST CLEANUP
        // Instead of guessing the time, we wait for the browser to tell us it's done.
        el.addEventListener('animationend', () => {
            el.remove();
            activeParticles--;

            // Restore overflow only when the very last particle finishes
            if (activeParticles === 0) mainElement.style.overflow = originalOverflow;
        });

        mainElement.appendChild(el);
    }
}

function newLine(force = false) {
    if (!sequence || sequence.length === 0) return;
    if (!force && !autoNextCheckbox.checked && currentIndex !== -1) {
        if (!checkCompletion()) return;
    }

    currentIndex++;

    // CHECK COMPLETION
    if (currentIndex >= sequence.length) {
        // AUTOPILOT CHECK: If running, just stop. Do not show rewards.
        if (isAutopilot) {
            autopilotBtn.click(); // This toggles it off via the existing handler
            resetAndRender();     // Reset to start
            return;
        }

        showFileCompletion();
        return;
    }

    currentLine = sequence[currentIndex] || '';

    currentLineChars = Array.from(currentLine);

    // Prevent Dictation from firing if Autopilot is already managing the speech
    if (dictationCheckbox.checked && currentLine && !isAutopilot) {
        speakText(currentLine);
    }

    position = 0;
    mistakes = 0;

    inputElem.value = '';

    renderTeleprompter();
    requestAnimationFrame(() => {
        if (!isAutopilot) inputElem.focus();
    });
}

function checkCompletion() {
    if (position === currentLineChars.length) {
        if (mistakes === 0) showResult('⭐ Perfect', 'perfect');
        else showResult('✅ Corrected.', 'corrected');
        if (autoNextCheckbox.checked) setTimeout(() => newLine(), 100);
        return true;
    }
    return false;
}

function revokeWord() {
    let i = position - 1;
    const boundaries = [' ', '—', '_', '/'];
    while (i >= 0 && !boundaries.includes(currentLineChars[i])) i--;
    position = i + 1;
}

function updateCaret() {
    if (!inputElem) return;
    requestAnimationFrame(() => {
        const len = inputElem.value.length;
        try {
            inputElem.setSelectionRange(len, len);
        } catch (err) {
            inputElem.selectionStart = inputElem.selectionEnd = len;
        }
        inputElem.scrollLeft = inputElem.scrollWidth;
        inputElem.focus();
    });
}

function flashWrong() {
    inputElem.classList.remove('wrong');
    void inputElem.offsetWidth; // force reflow so it restarts even on back-to-back mistakes
    inputElem.classList.add('wrong');
}

function handleInput() {
    const inputValue = inputElem.value.normalize('NFC');

    // Check if the entire input value is a correct prefix of the current line
    if (currentLine.startsWith(inputValue)) {
        // Correct so far. Update our position.
        // We use Array.from to correctly count Unicode symbols.
        position = Array.from(inputValue).length;
        updateCaret(); // Ensure caret stays in the right place
        checkCompletion();
    } else {
        // Mistake
        mistakes++;
        flashWrong();

        // Mark the file run as imperfect
        isFileRunPerfect = false;

        // Only revoke if the *expected* character is NOT a separator.
        // If the user finished the word "Hello" and mistakes the upcoming "," for ".", 
        // we spare them. But if they mistake "l" for "k" inside "Hello", we revoke.
        const expectedChar = currentLineChars[position];
        const isSeparator = REVOKE_EXEMPT.includes(expectedChar);

        // Check if we should revoke the word
        if (wordRevokeCheckbox.checked && isWordRevokeEnabled && !isSeparator) revokeWord(); // This sets 'position' back to the start of the word

        // Force the input value back to the last known-good state (at 'position')
        // This will either be the start of the mistyped word or the same spot as before.
        inputElem.value = currentLineChars.slice(0, position).join('');
        updateCaret();
    }
}

inputElem.addEventListener('compositionstart', () => {
    isComposing = true;
});

inputElem.addEventListener('compositionend', () => {
    isComposing = false;
    // We must call handleInput() here for browsers like Safari
    // that don't fire a final 'input' event on composition end.
    handleInput();
});

inputElem.addEventListener('input', () => {
    if (isComposing) return;

    // We only handle CORRECT input here now (caret updates, completion checks)
    const inputValue = inputElem.value.normalize('NFC');

    if (currentLine.startsWith(inputValue)) {
        position = Array.from(inputValue).length;
        updateCaret();
        checkCompletion();
    }
    // We NO LONGER handle mistakes here, because beforeinput blocked them.
});

inputElem.addEventListener('beforeinput', (e) => {
    // 1. Ignore if autopilot is running or if composing IME text (e.g. Chinese/Japanese Pinyin)
    if (isAutopilot || isComposing) return;

    // Line is already complete and the advance is pending — swallow the keystroke instead of scoring it against the next line.
    if (position >= currentLineChars.length) {
        e.preventDefault();
        return;
    }

    // 2. We only care about inserting text (not deleting, pasting, etc.)
    if (e.inputType === 'insertText' && e.data) {

        // Calculate where we are *supposed* to be
        // (We use the current value length because the new char isn't added yet)
        const currentVal = inputElem.value.normalize('NFC');
        const nextCharIndex = Array.from(currentVal).length;
        const expectedChar = currentLineChars[nextCharIndex];

        // 3. Normalize inputs (handle smart quotes if necessary, though the script handles that in split)
        const typedChar = e.data.normalize('NFC');

        // 4. CHECK: Is the typed character correct?
        if (typedChar === expectedChar) return; // Exact match — browser inserts normally.

        if (typedChar === stripDiacritics(expectedChar)) {
            // Accept the bare letter for an accented target. Still have to
            // preventDefault and insert manually: letting the browser insert
            // the literal keystroke would put the unaccented letter in the
            // field, breaking every startsWith(inputValue) check downstream,
            // which assumes the field is always an exact prefix of the target.
            e.preventDefault();
            position = nextCharIndex + 1;
            inputElem.value = currentLineChars.slice(0, position).join('');
            updateCaret();
            checkCompletion();
            return;
        }

        // Mistake
        e.preventDefault();
        mistakes++;
        flashWrong();
        isFileRunPerfect = false;

        const isSeparator = REVOKE_EXEMPT.includes(expectedChar);

        if (wordRevokeCheckbox.checked && isWordRevokeEnabled && !isSeparator) {
            revokeWord();
            inputElem.value = currentLineChars.slice(0, position).join('');
        }
    }
});

inputElem.addEventListener('keydown', (e) => {
    // If finished, Enter restarts the file
    if (isFileFinished) {
        if (e.key === 'Enter') {
            e.preventDefault();
            resetAndRender(); // Reshuffles (if enabled) and starts from line 1
            inputElem.focus();
        }
        return; // Ignore other keys when finished
    }
    if (!currentLine) {
        e.preventDefault();
        return;
    }
    const blockedKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete', 'Tab'];
    if (blockedKeys.includes(e.key)) {
        e.preventDefault();
        return;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        // checkCompletion() has already scheduled the advance when auto-next is on
        if (!autoNextCheckbox.checked) newLine();
    }
});

inputElem.addEventListener('paste', (e) => e.preventDefault());
inputElem.addEventListener('mousedown', () => setTimeout(updateCaret, 0));
inputElem.addEventListener('touchstart', () => setTimeout(updateCaret, 0), { passive: true });

// Also update the button listener for mobile/mouse users
nextBtn.addEventListener('click', () => {
    if (isFileFinished) {
        resetAndRender();
        inputElem.focus();
    } else {
        newLine();
    }
});

autopilotBtn.addEventListener('click', () => {
    isAutopilot = !isAutopilot;

    // Toggle the .hidden class on both icons
    playIcon.classList.toggle('hidden', isAutopilot); // hide play if autopilot is ON
    stopIcon.classList.toggle('hidden', !isAutopilot); // hide stop if autopilot is OFF

    if (isAutopilot) {
        autopilotBtn.setAttribute('aria-label', 'Stop Autopilot');

        inputElem.blur();
        if (!isSpeechUnlocked) {
            speechSynthesis.speak(new SpeechSynthesisUtterance(''));
            isSpeechUnlocked = true;
        }
        function autoAdvance() {
            if (isAutopilot) {
                newLine(true);
                speakText(currentLine, autoAdvance);
            }
        }
        speakText(currentLine, autoAdvance);
    } else {
        autopilotBtn.setAttribute('aria-label', 'Start Autopilot');

        stopSpeech();
        inputElem.focus();
    }
});

// Prevent ghost audio if the user closes or refreshes the tab while reading
window.addEventListener('beforeunload', () => stopSpeech());

window.addEventListener('load', async () => {
    // Nothing here needs the network.
    document.getElementById('year').textContent = new Date().getFullYear();
    importInput.setAttribute('accept', ACCEPT_ATTR_STRING);
    const savedText = localStorage.getItem('saved_custom_text');
    if (savedText) textarea.value = savedText;

    renderPresetSources();
    updateCustomListPlaceholder();

    // The CLDR name list only labels the selector, so let it land in the
    // background instead of holding the first script behind 3 × 1500 ms.
    const langListReady = populateLangSelector();

    const defaultSourceEl = presetSourcesList.querySelector(`[data-path="${PRESET_SOURCES.Sentences}"]`);
    if (defaultSourceEl) handleSourceClick(defaultSourceEl, 'preset');
    else renderTeleprompter();

    await langListReady;
    if (!langInput.value) syncLangInputLabel(currentContentLang);
});