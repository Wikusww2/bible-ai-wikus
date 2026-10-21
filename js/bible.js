/* ============================================================
   bible.js — Deterministic reference parser + Scripture provider
   Provider: bolls.life (free, CORS-enabled, many translations).
   The LLM is NEVER allowed to fabricate scripture text — every
   verse shown in the UI comes from this provider.
   ============================================================ */

const BibleData = (() => {
  // [canonical name, bolls book id, chapters, aliases...]
  const B = [
    ["Genesis",1,50,"gen","ge","gn"],["Exodus",2,40,"exo","ex","exod"],["Leviticus",3,27,"lev","le","lv"],
    ["Numbers",4,36,"num","nu","nm","nb"],["Deuteronomy",5,34,"deut","dt","deu"],["Joshua",6,24,"josh","jos","jsh"],
    ["Judges",7,21,"judg","jdg","jg","jdgs"],["Ruth",8,4,"rth","ru"],["1 Samuel",9,31,"1sam","1sa","1s","i samuel","1st samuel","first samuel"],
    ["2 Samuel",10,24,"2sam","2sa","2s","ii samuel","2nd samuel","second samuel"],["1 Kings",11,22,"1kgs","1ki","1k","i kings","1st kings","first kings"],
    ["2 Kings",12,25,"2kgs","2ki","2k","ii kings","2nd kings","second kings"],["1 Chronicles",13,29,"1chr","1ch","i chronicles","1st chronicles","first chronicles"],
    ["2 Chronicles",14,36,"2chr","2ch","ii chronicles","2nd chronicles","second chronicles"],["Ezra",15,10,"ezr","ez"],
    ["Nehemiah",16,13,"neh","ne"],["Esther",17,10,"esth","est","es"],["Job",18,42,"jb"],
    ["Psalms",19,150,"psalm","ps","psa","pss","psm"],["Proverbs",20,31,"prov","pro","prv","pr"],
    ["Ecclesiastes",21,12,"eccl","ecc","ec","qoh"],["Song of Solomon",22,8,"song","sos","song of songs","canticles","cant"],
    ["Isaiah",23,66,"isa","is"],["Jeremiah",24,52,"jer","je","jr"],["Lamentations",25,5,"lam","la"],
    ["Ezekiel",26,48,"ezek","eze","ezk"],["Daniel",27,12,"dan","da","dn"],["Hosea",28,14,"hos","ho"],
    ["Joel",29,3,"jl","joe"],["Amos",30,9,"am","amo"],["Obadiah",31,1,"obad","ob","oba"],
    ["Jonah",32,4,"jnh","jon"],["Micah",33,7,"mic","mc"],["Nahum",34,3,"nah","na"],
    ["Habakkuk",35,3,"hab","hb"],["Zephaniah",36,3,"zeph","zep","zp"],["Haggai",37,2,"hag","hg"],
    ["Zechariah",38,14,"zech","zec","zc"],["Malachi",39,4,"mal","ml"],
    ["Matthew",40,28,"matt","mat","mt"],["Mark",41,16,"mrk","mk","mr","mar"],["Luke",42,24,"luk","lk","lu"],
    ["John",43,21,"jn","jhn","joh"],["Acts",44,28,"act","ac"],["Romans",45,16,"rom","ro","rm"],
    ["1 Corinthians",46,16,"1cor","1co","i corinthians","1st corinthians","first corinthians"],
    ["2 Corinthians",47,13,"2cor","2co","ii corinthians","2nd corinthians","second corinthians"],
    ["Galatians",48,6,"gal","ga"],["Ephesians",49,6,"eph","ep"],["Philippians",50,4,"phil","php","pp"],
    ["Colossians",51,4,"col","co"],["1 Thessalonians",52,5,"1thess","1th","1thes","i thessalonians","first thessalonians"],
    ["2 Thessalonians",53,3,"2thess","2th","2thes","ii thessalonians","second thessalonians"],
    ["1 Timothy",54,6,"1tim","1ti","i timothy","first timothy"],["2 Timothy",55,4,"2tim","2ti","ii timothy","second timothy"],
    ["Titus",56,3,"tit","ti"],["Philemon",57,1,"phlm","phm","philem"],["Hebrews",58,13,"heb","he"],
    ["James",59,5,"jas","jm","ja"],["1 Peter",60,5,"1pet","1pe","1pt","i peter","first peter"],
    ["2 Peter",61,3,"2pet","2pe","2pt","ii peter","second peter"],["1 John",62,5,"1jn","1jo","1joh","i john","first john"],
    ["2 John",63,1,"2jn","2jo","2joh","ii john","second john"],["3 John",64,1,"3jn","3jo","3joh","iii john","third john"],
    ["Jude",65,1,"jud","jde"],["Revelation",66,22,"rev","re","revelations","apocalypse"],
  ];
  const books = B.map(([name,id,chapters,...aliases]) => ({ name, id, chapters, aliases }));
  const lookup = new Map();
  for (const b of books) {
    lookup.set(b.name.toLowerCase(), b);
    for (const a of b.aliases) lookup.set(a, b);
  }
  return { books, lookup };
})();

const Translations = [
  { code: "CSB",  name: "Christian Standard Bible" },
  { code: "ESV",  name: "English Standard Version" },
  { code: "NIV",  name: "New International Version" },
  { code: "KJV",  name: "King James Version" },
  { code: "NKJV", name: "New King James Version" },
  { code: "NASB", name: "New American Standard Bible" },
  { code: "NLT",  name: "New Living Translation" },
  { code: "WEB",  name: "World English Bible" },
  { code: "YLT",  name: "Young's Literal Translation" },
];
const TRANSLATION_ALIASES = {
  csb:"CSB", hcsb:"CSB", esv:"ESV", niv:"NIV", kjv:"KJV", "king james":"KJV",
  nkjv:"NKJV", nasb:"NASB", nas:"NASB", nlt:"NLT", web:"WEB", ylt:"YLT",
};

const ORDINAL_WORDS = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,first:1,last:-1 };

/* ---------- Deterministic reference parser ---------- */
const RefParser = {
  // Find a translation token anywhere in the text; returns {code|null, stripped}
  extractTranslation(text) {
    let code = null;
    const stripped = text.replace(/\b(csb|hcsb|esv|niv|kjv|nkjv|nasb|nas|nlt|web|ylt|king james)\b/gi, m => {
      code = TRANSLATION_ALIASES[m.toLowerCase()] || null;
      return "";
    }).replace(/\s+/g, " ").trim();
    return { code, stripped };
  },

  matchBook(raw) {
    const key = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
    return BibleData.lookup.get(key) || BibleData.lookup.get(key.replace(/\s/g, "")) || null;
  },

  /* Parse "Matthew 1:1", "1 John 3:16-18", "Ps 23", "Matt 1:18-2:5", "Rom 8:28,31,38"
     Returns null or {book, chapterStart, verseStart, chapterEnd, verseEnd, verses[], translation, confidence} */
  parse(input) {
    if (!input) return null;
    const { code: translation, stripped } = this.extractTranslation(input.trim());
    const chapterRange=stripped.match(/^(.+?)\s+(\d{1,3})\s*[-–—]\s*(\d{1,3})$/i);
    if(chapterRange){const start=this.parse(`${chapterRange[1]} ${chapterRange[2]}`);const end=Number(chapterRange[3]);if(!start||start.error)return start;if(end<start.chapterStart||end>BibleData.books.find(b=>b.id===start.bookId).chapters)return {error:"Invalid chapter range."};return {...start,chapterEnd:end,translation};}
    const m = stripped.match(/^((?:[1-3]|i{1,3})?\s*[a-z]+(?:\s+(?:of\s+)?[a-z]+)*?)\.?\s+(\d{1,3})(?:\s*[:.]\s*(\d{1,3}(?:\s*[-–—]\s*\d{1,3}(?:\s*[:.]\s*\d{1,3})?)?(?:\s*,\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)*))?\s*$/i);
    if (!m) return this.parseNatural(stripped, translation);
    const book = this.matchBook(m[1]);
    // Natural-language requests can superficially match the canonical pattern
    // ("first five verses of Jude 2"). Give that parser a chance before failing.
    if (!book) return this.parseNatural(stripped, translation);
    let chapter = parseInt(m[2], 10);
    let singleChapterVerse = null;
    // Conventional shorthand for one-chapter books: "Jude 5" means Jude 1:5.
    if (book.chapters === 1 && !m[3] && chapter > 1) {
      singleChapterVerse = chapter;
      chapter = 1;
    }
    if (chapter < 1 || chapter > book.chapters) {
      return { error: `${book.name} only has ${book.chapters} chapter${book.chapters>1?"s":""}.`, book: book.name, translation };
    }
    const out = { book: book.name, bookId: book.id, chapterStart: chapter, chapterEnd: chapter,
                  verseStart: null, verseEnd: null, verses: null, translation, confidence: 0.97 };
    if (singleChapterVerse) {
      out.verseStart = singleChapterVerse;
      out.verseEnd = singleChapterVerse;
    } else if (m[3]) {
      const spec = m[3].replace(/\s+/g, "");
      if (spec.includes(",")) {
        out.verses = [];
        for (const part of spec.split(",")) {
          if (!/^\d+(?:[-–—]\d+)?$/.test(part)) {
            return { error: `Comma-separated references must stay within ${book.name} ${chapter}.`, book: book.name, translation };
          }
          const bounds = part.split(/[-–—]/).map(v => parseInt(v, 10));
          if (!bounds[0] || (bounds[1] && bounds[1] < bounds[0])) {
            return { error: `Invalid verse list in ${book.name} ${chapter}.`, book: book.name, translation };
          }
          const end = bounds[1] || bounds[0];
          for (let v = bounds[0]; v <= end; v++) out.verses.push(v);
        }
        out.verses = [...new Set(out.verses)];
        out.verseStart = out.verses[0]; out.verseEnd = out.verses[out.verses.length - 1];
      } else {
        const range = spec.split(/[-–—]/);
        out.verseStart = parseInt(range[0], 10);
        if (range[1]) {
          if (range[1].includes(":") || range[1].includes(".")) {
            const [c2, v2] = range[1].split(/[:.]/).map(n => parseInt(n, 10));
            out.chapterEnd = c2; out.verseEnd = v2;
          } else out.verseEnd = parseInt(range[1], 10);
        } else out.verseEnd = out.verseStart;
      }
    }
    if(out.verseStart===0||out.verseEnd===0)return {error:"Verse numbers start at 1.",book:book.name,translation};
    if (out.chapterEnd < out.chapterStart || out.chapterEnd > book.chapters) {
      return { error: `${book.name} only has ${book.chapters} chapter${book.chapters>1?"s":""}.`, book: book.name, translation };
    }
    if (out.chapterEnd === out.chapterStart && out.verseStart != null && out.verseEnd < out.verseStart) {
      return { error: `Verse ranges must run forwards in ${book.name} ${chapter}.`, book: book.name, translation };
    }
    return out;
  },

  /* "first five verses of Matthew", "the first 3 verses of john 3 niv" */
  parseNatural(input, translation) {
    const t = input.toLowerCase();
    const m = t.match(/(?:first|the first)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+verses?\s+(?:of|in|from)\s+((?:[1-3]\s*)?[a-z]+(?:\s+(?:of\s+)?[a-z]+)*?)(?:\s+chapter\s+(\d+)|\s+(\d+))?\s*$/);
    if (!m) return null;
    const n = ORDINAL_WORDS[m[1]] || parseInt(m[1], 10);
    const book = this.matchBook(m[2]);
    if (!book || !n) return null;
    const chapter = parseInt(m[3] || m[4] || "1", 10);
    if (chapter < 1 || chapter > book.chapters) {
      return { error: `${book.name} only has ${book.chapters} chapter${book.chapters>1?"s":""}.`, book: book.name, translation };
    }
    return { book: book.name, bookId: book.id, chapterStart: chapter, chapterEnd: chapter,
             verseStart: 1, verseEnd: n, verses: null, translation, confidence: 0.9, inferred: true };
  },

  format(ref) {
    if (!ref || ref.error) return "";
    let s = `${ref.book} ${ref.chapterStart}`;
    if(ref.verseStart==null&&ref.chapterEnd!==ref.chapterStart)s+=`–${ref.chapterEnd}`;
    if (ref.verses) s += ":" + ref.verses.join(",");
    else if (ref.verseStart) {
      s += `:${ref.verseStart}`;
      if (ref.chapterEnd !== ref.chapterStart) s += `–${ref.chapterEnd}:${ref.verseEnd}`;
      else if (ref.verseEnd !== ref.verseStart) s += `–${ref.verseEnd}`;
    }
    return s;
  },
};

/* ---------- Scripture provider (bolls.life) ---------- */
/* UI translation code → bolls.life catalogue code, where they differ */
const PROVIDER_CODES = { CSB: "CSB17" };

const BibleProvider = {
  cache: new Map(),
  stripHtml(s) {
    return String(s)
      .replace(/<S>[\s\S]*?<\/S>/gi, "").replace(/<sup>[\s\S]*?<\/sup>/gi, "") // Strong's numbers, footnote sups
      .replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, "")
      .replace(/[Ⓐ-ⓩ①-⑳]|\[\d{1,2}\]/g, "") // footnote markers
      .replace(/\s+/g, " ").trim();
  },

  async getChapter(translation, bookId, chapter, signal) {
    const code = PROVIDER_CODES[translation] || translation;
    const key = `${code}/${bookId}/${chapter}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const res = await fetch(`https://bolls.life/get-text/${code}/${bookId}/${chapter}/`,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
    if (!res.ok) throw new Error(`Scripture provider returned ${res.status} for ${translation} ${bookId}:${chapter}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error(`${translation} is not carried by the provider.`);
    const verses = data.map(v => ({ verse: v.verse, text: this.stripHtml(v.text) }));
    this.cache.set(key, verses);
    return verses;
  },

  /* ref: parsed reference object; returns {reference, translation, verses:[{verse,text}], attribution} */
  async getPassage(ref, fallback = "WEB", signal) {
    const translation = ref.translation || fallback;
    const tryOne = async (trans) => {
      const out = [];
      for (let ch = ref.chapterStart; ch <= (ref.chapterEnd || ref.chapterStart); ch++) {
        const all = await this.getChapter(trans, ref.bookId, ch, signal);
        let picked = all;
        if (ref.verses) picked = all.filter(v => ref.verses.includes(v.verse));
        else if (ref.verseStart != null) {
          const start = ch === ref.chapterStart ? ref.verseStart : 1;
          const end = ch === (ref.chapterEnd || ref.chapterStart) ? (ref.verseEnd ?? ref.verseStart) : Infinity;
          picked = all.filter(v => v.verse >= start && v.verse <= end);
        }
        const requested=ref.verses || (ref.verseStart!=null ? [ch===ref.chapterStart?ref.verseStart:1, ch===(ref.chapterEnd||ref.chapterStart)?ref.verseEnd:all.at(-1).verse] : []);
        if(requested.some(v=>!all.some(actual=>actual.verse===v)))throw Object.assign(new Error(`The requested verse is outside ${ref.book} ${ch} in ${trans}.`),{referenceError:true});
        for (const v of picked) out.push({ chapter: ch, verse: v.verse, text: v.text });
      }
      if (!out.length) throw new Error("No verses found — the verse number may be out of range.");
      return out;
    };
    try {
      const verses = await tryOne(translation);
      const tinfo = Translations.find(t => t.code === translation);
      return { reference: RefParser.format(ref), translation, translationName: tinfo?.name || translation,
               verses, attribution: `${tinfo?.name || translation} (${translation}) — text via bolls.life` };
    } catch (e) {
      if(e.referenceError||e.name==="AbortError")throw e;
      if (translation !== "WEB" && /not carried/.test(e.message)) {
        const verses = await tryOne("WEB");
        return { reference: RefParser.format(ref), translation: "WEB", translationName: "World English Bible",
                 requested: translation, fallbackNote: `${translation} unavailable from the provider — showing WEB (public domain) instead.`,
                 verses, attribution: "World English Bible (WEB) — text via bolls.life" };
      }
      throw e;
    }
  },

  async searchText(translation, query, limit = 12) {
    limit=Math.max(1,Math.min(50,Number(limit)||12));
    const clean = encodeURIComponent(query);
    const code = PROVIDER_CODES[translation] || translation;
    const urls = [
      `https://bolls.life/v2/find/${code}?search=${clean}&match_case=false&match_whole=false&limit=${limit}`,
      `https://bolls.life/find/${code}?search=${clean}&match_case=false&match_whole=false`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const arr = Array.isArray(data) ? data : (data.results || []);
        return arr.slice(0, limit).map(r => {
          const book = BibleData.books.find(b => b.id === r.book);
          return { reference: `${book ? book.name : "Book " + r.book} ${r.chapter}:${r.verse}`,
                   book: book?.name, chapter: r.chapter, verse: r.verse, text: this.stripHtml(r.text) };
        });
      } catch { /* try next endpoint */ }
    }
    throw new Error("Bible text search is unavailable right now.");
  },
};

/* ---------- Original-language provider ----------
   Real manuscripts from bolls.life:
   - OT: Westminster Leningrad Codex (WLC, Hebrew w/ vowel points)
   - NT: Elzevir Textus Receptus (TR, Greek)
   Word-level data comes from KJV's inline Strong's tags (<S>7225</S>),
   and lexicon entries from the BDBT (BDB + Thayer) dictionary API. */
/* The Aramaic portions of the Old Testament. The Masoretic text (WLC)
   preserves these sections in Biblical Aramaic, written in the same
   square script as the Hebrew — so the manuscript source is identical,
   but the LANGUAGE must be labelled correctly. */
const ARAMAIC_RANGES = [
  { book: 27, test: (c, v) => (c === 2 && v >= 4) || (c >= 3 && c <= 7) },          // Daniel 2:4b–7:28
  { book: 15, test: (c, v) => (c === 4 && v >= 8) || c === 5 || (c === 6 && v <= 18) || (c === 7 && v >= 12 && v <= 26) }, // Ezra
  { book: 24, test: (c, v) => c === 10 && v === 11 },                               // Jeremiah 10:11
  { book: 1,  test: (c, v) => c === 31 && v === 47, partial: true },                // Genesis 31:47 (the phrase Jegar-sahadutha)
];
function isAramaicVerse(bookId, chapter, verse) {
  const r = ARAMAIC_RANGES.find(x => x.book === bookId && x.test(chapter, verse));
  return r ? (r.partial ? "partial" : true) : false;
}

const OriginalProvider = {
  rawCache: new Map(),
  lexCache: new Map(),

  sourceFor(bookId) {
    return bookId <= 39
      ? { code: "WLC", lang: "hebrew", dir: "rtl", name: "Westminster Leningrad Codex", langName: "Biblical Hebrew", prefix: "H" }
      : { code: "TR", lang: "greek", dir: "ltr", name: "Elzevir Textus Receptus (1624)", langName: "Koine Greek", prefix: "G" };
  },

  async fetchChapterRaw(code, bookId, chapter) {
    const key = `raw/${code}/${bookId}/${chapter}`;
    if (this.rawCache.has(key)) return this.rawCache.get(key);
    const res = await fetch(`https://bolls.life/get-text/${code}/${bookId}/${chapter}/`,{signal:AbortSignal.timeout(12000)});
    if (!res.ok) throw new Error(`Original-language provider returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("This chapter is not available in the manuscript source.");
    this.rawCache.set(key, data);
    return data;
  },

  /* "In the beginning<S>7225</S> God<S>430</S> ... <S>853</S>the heaven<S>8064</S>"
     → [{ text:"In the beginning", strongs:["H7225"] }, { text:"—", strongs:["H853"], untranslated:true }, …] */
  parseStrongsWords(raw, prefix) {
    const clean = String(raw)
      .replace(/<sup>[\s\S]*?<\/sup>/gi, "") // KJV marginal notes
      .replace(/<br\s*\/?\s*>/gi, " ").replace(/<(?!\/?S\b)[^>]+>/g, "");
    const words = [];
    const re = /([^<]*)<S>(\d+)<\/S>/g;
    let m, lastIndex = 0;
    while ((m = re.exec(clean))) {
      lastIndex = re.lastIndex;
      const text = m[1].replace(/\s+/g, " ").replace(/^[\s,;:.·]+/, "").trim();
      const code = prefix + m[2];
      if (!text && words.length) words[words.length - 1].strongs.push(code); // marker glued to previous phrase
      else if (!text) words.push({ text: "—", strongs: [code], untranslated: true });
      else words.push({ text, strongs: [code] });
    }
    const tail = clean.slice(lastIndex).replace(/\s+/g, " ").trim();
    if (/[a-z0-9]/i.test(tail)) words.push({ text: tail, strongs: [] });
    return words;
  },

  /* Full interlinear bundle for a parsed reference */
  async getInterlinear(ref) {
    if ((ref.chapterEnd || ref.chapterStart) !== ref.chapterStart) {
      throw new Error("Original-language ranges must stay within one chapter. Open each chapter separately.");
    }
    const src = this.sourceFor(ref.bookId);
    const chapter = ref.chapterStart;
    const [origAll, kjvAll] = await Promise.all([
      this.fetchChapterRaw(src.code, ref.bookId, chapter),
      this.fetchChapterRaw("KJV", ref.bookId, chapter),
    ]);
    const wanted = v => {
      if (ref.verses) return ref.verses.includes(v);
      if (ref.verseStart == null) return true;
      return v >= ref.verseStart && v <= (ref.verseEnd ?? ref.verseStart);
    };
    const alignmentVerified=origAll.length===kjvAll.length && origAll.every(o=>kjvAll.some(k=>k.verse===o.verse));
    const alignmentWarning=alignmentVerified?null:"Manuscript verse numbering differs from KJV in this chapter. References below use the manuscript numbering; KJV word links are disabled until an explicit mapping is available.";
    const verses = [];
    for (const o of origAll) {
      if (!wanted(o.verse)) continue;
      const kj = alignmentVerified ? kjvAll.find(k => k.verse === o.verse) : null;
      verses.push({
        verse: o.verse,
        original: BibleProvider.stripHtml(o.text),
        aramaic: ref.bookId <= 39 ? isAramaicVerse(ref.bookId, chapter, o.verse) : false,
        words: kj ? this.parseStrongsWords(kj.text, src.prefix) : [],
      });
    }
    if (!verses.length) throw new Error("No verses found for that reference.");
    /* Correct the language label for Aramaic sections of the Masoretic text */
    const source = { ...src };
    if (source.lang === "hebrew") {
      const aram = verses.filter(v => v.aramaic === true).length;
      if (aram === verses.length && aram > 0) { source.lang = "aramaic"; source.langName = "Biblical Aramaic"; }
      else if (aram > 0) { source.lang = "mixed"; source.langName = "Hebrew & Biblical Aramaic"; }
      else if (verses.some(v => v.aramaic === "partial")) source.langName = "Biblical Hebrew (contains an Aramaic phrase)";
    }
    return { alignmentWarning, alignmentVerified, reference: RefParser.format(ref), book: ref.book, bookId: ref.bookId, chapter, source, verses,
             attribution: `${source.name} · Strong's tagging via KJV · lexicon: BDB/Thayer — data via bolls.life` };
  },

  sanitizeLex(html) {
    return String(html)
      .replace(/<(he|el)>/gi, "<b>").replace(/<\/(he|el)>/gi, "</b>")
      .replace(/<(?!\/?(b|i|p|br|ol|ul|li)\b)[^>]*>/gi, "")
      .replace(/<(\/?)(b|i|p|br|ol|ul|li)[^>]*>/gi, "<$1$2>");
  },

  /* strongs like "H7225" or "G2316" → lexicon entry */
  async getLexicon(strongs) {
    const code = String(strongs).toUpperCase().trim();
    if (!/^[HG]\d{1,5}$/.test(code)) throw new Error(`"${strongs}" is not a valid Strong's number (use H7225 / G26).`);
    if (this.lexCache.has(code)) return this.lexCache.get(code);
    const res = await fetch(`https://bolls.life/dictionary-definition/BDBT/${code}/`,{signal:AbortSignal.timeout(12000)});
    if (!res.ok) throw new Error(`Lexicon lookup failed (${res.status})`);
    const data = await res.json();
    const hit = Array.isArray(data) ? data.find(d => d.topic === code) || data[0] : null;
    if (!hit) throw new Error(`No lexicon entry found for ${code}.`);
    const entry = {
      strongs: code,
      lexeme: BibleProvider.stripHtml(hit.lexeme || ""),
      transliteration: BibleProvider.stripHtml(hit.transliteration || ""),
      pronunciation: BibleProvider.stripHtml(hit.pronunciation || ""),
      short: BibleProvider.stripHtml(hit.short_definition || ""),
      definitionHtml: this.sanitizeLex(hit.definition || ""),
      definitionText: BibleProvider.stripHtml(hit.definition || "").slice(0, 4000),
    };
    this.lexCache.set(code, entry);
    return entry;
  },
};

window.OriginalProvider = OriginalProvider;
window.BibleData = BibleData;
window.Translations = Translations;
window.RefParser = RefParser;
window.BibleProvider = BibleProvider;
