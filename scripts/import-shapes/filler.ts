/* Plain invented prose for the shapes that need length (no-headings): a
   seeded draw from a bank of sentences that say nothing real. Same seed,
   same text, in every format. */

const BANK = [
  'The kettle had been on the stove since morning, and nobody had thought to take it off.',
  'Outside, the rain kept on at the gutters in the patient way it had all week.',
  'She folded the letter twice and put it back in the drawer without reading the end.',
  'The road out of the village bent left at the mill and then forgot where it was going.',
  'He counted the steps up to the attic and got a different number every time.',
  'There was bread on the table, a little stale, and a knife beside it.',
  'Nobody in the house could say when the clock in the hall had stopped.',
  'The garden wall leaned toward the lane as if it wanted to hear what passers said.',
  'By noon the fog had lifted enough to show the far side of the field.',
  'A dog barked twice somewhere down the hill and then thought better of it.',
  'The lamp in the window was lit early, though the evening was still bright.',
  'She wrote the date at the top of the page and nothing under it.',
  'The train was late, as it always was on market days.',
  'He kept the key on a string around his neck and touched it when he was nervous.',
  'The boat at the jetty had a new coat of paint and an old name.',
  'Somebody had left a chair out in the yard, and it had gone grey in the weather.',
  'The baker opened his shutters at six and closed them again at half past.',
  'They walked along the shore until the town was only a line of roofs behind them.',
  'The letter came on a Tuesday, which was the only thing that seemed right about it.',
  'In the kitchen the radio talked quietly to itself about the weather in other places.',
  'Her brother had promised to mend the fence in the spring, and spring had come and gone.',
  'The library smelled of dust and polish and a little of the river.',
  'He said he would be back by supper, and for once he was.',
  'The hill behind the church was steeper than it looked from the square.',
  'A cart went by with a load of turnips and a boy asleep on top of them.',
  'The new teacher wore a green coat and learned everyone’s name in a day.',
  'There were three cups on the shelf, and only two of them matched.',
  'The wind turned in the night and brought the smell of the sea inland.',
  'She found the old map in a book about birds, pressed flat between two pages.',
  'The bridge had been repaired so many times that none of it was the first bridge.',
  'At the end of the lane the post box stood with its mouth open, waiting.',
  'He made tea for both of them and drank his standing at the window.',
  'The shop sold string, nails, seed and, for reasons no one remembered, umbrellas.',
  'By the time the candles were lit, the argument had worn itself out.',
  'The snow that year came late and stayed until everyone was tired of it.',
  'Someone was whistling on the stairs, the same four notes over and over.',
  'They agreed to meet at the fountain, though neither said what time.',
  'The cat slept in the one patch of sun and moved with it across the floor.',
  'Her handwriting leaned forward, as if every word were in a hurry.',
  'The evening ended the way most of them did, with the dishes and the dark.',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wc = (s: string) => s.split(/\s+/).length;

/** Paragraphs of 60–120 words (the last may be shorter), about `words` in all. */
export function fillerParagraphs(seed: number, words: number): string[] {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  let total = 0;
  while (total < words) {
    const target = 60 + Math.floor(rnd() * 61);
    const para: string[] = [];
    let n = 0;
    while (n < target && total < words) {
      const s = BANK[Math.floor(rnd() * BANK.length)];
      if (n + wc(s) > 120) break;
      para.push(s); n += wc(s); total += wc(s);
    }
    out.push(para.join(' '));
  }
  return out;
}
