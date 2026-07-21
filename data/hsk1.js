// HSK1 word data.
// Each entry: h = hanzi, p = pinyin, pos = part of speech, def = definition,
// ctx = usage note, ex = {cn, py, en} example sentence, learned = self-rated
// progress flag (flipped by the "Got it" / "Still learning" prompt on the card).
//
// Only one seed entry for now, for the single-card prototype. The full
// 300-word rebuild (from the updated 2026 HSK1 list) comes later — this file
// is where those entries will live, one object per word, same shape.

const HSK1 = [
  {
    h: "我",
    p: "wǒ",
    pos: "pronoun",
    def: "I; me",
    ctx: "The default first-person pronoun — no conjugation, no gendered forms, no formal/informal distinction (unlike 您 for \"you,\" Chinese doesn't have a polite version of \"I\").",
    ex: { cn: "我是学生。", py: "Wǒ shì xuésheng.", en: "I am a student." },
    learned: false
  }
];