// QA-only synthetic/demo fixtures. Production code must never import this file.

export const favorites = [
  { id: "lotr", title: "The Lord of the Rings", type: "book", displayLabel: "Book + film", domains: ["read", "watch"], note: "All-time favorite", selected: true },
  { id: "circe", title: "Circe", type: "book", domains: ["read"], note: "Mythic, adult, character-driven", selected: true },
  { id: "portal2", title: "Portal 2", type: "game", domains: ["play"], note: "Puzzle systems + specific humor", selected: true },
  { id: "alanwake2", title: "Alan Wake 2", type: "game", domains: ["play"], note: "Mystery + structure + tonal collision", selected: true },
  { id: "thefall", title: "The Fall", type: "movie", domains: ["watch"], note: "Distinctive visual identity", selected: true },
  { id: "buffy", title: "Buffy the Vampire Slayer", type: "tv", domains: ["watch"], note: "Genre mixing + character", selected: true },
  { id: "starwars", title: "Original Star Wars trilogy", type: "movie", displayLabel: "Film", domains: ["watch"], note: "Adventure + worldbuilding", selected: false },
  { id: "breakingbad", title: "Breaking Bad", type: "tv", domains: ["watch"], note: "Moral messiness", selected: false },
  // #60: a wider first-run pool so a new visitor can find 4 meaningful favorites without every strong
  // choice already being pre-selected for them. Left unselected on purpose — see #59 on real first-run
  // favorites starting from the user's own choices.
  { id: "houseofleaves", title: "House of Leaves", type: "book", domains: ["read"], note: "Unreliable narrative, formal strangeness", selected: false },
  { id: "obradinn", title: "Return of the Obra Dinn", type: "game", domains: ["play"], note: "Structured deduction, procedural mystery", selected: false },
  { id: "annihilation", title: "Annihilation", type: "book", domains: ["read"], note: "Eerie, adult, formally strange", selected: false },
  { id: "goodplace", title: "The Good Place", type: "tv", domains: ["watch"], note: "Philosophical comedy, twist-heavy structure", selected: false }
];

export const hypotheses = [
  {
    id: "H04",
    title: "Comedy works better when it has teeth",
    claim: "Absurd, abrasive, deconstructive, or highly specific comedy tends to fit better than warm, earnest comedy.",
    strength: "Strong",
    status: "strong",
    evidence: "Always Sunny, Eastbound & Down, MacGruber, Conan"
  },
  {
    id: "H05",
    title: "Fantasy lands when it feels adult",
    claim: "Mythic and fantastical material is a strong fit when the treatment feels mature, strange, serious, or formally distinctive.",
    strength: "Strong",
    status: "strong",
    evidence: "LOTR, Circe, Pan's Labyrinth, The Green Knight"
  },
  {
    id: "H03",
    title: "Moral messiness is not a turnoff",
    claim: "Compromised, selfish, abrasive, or manipulative characters can be a feature when the work has a strong point of view.",
    strength: "Strong",
    status: "strong",
    evidence: "Breaking Bad, Better Call Saul, The Americans, early Game of Thrones"
  },
  {
    id: "H01/H07",
    title: "Discovery needs structure",
    claim: "Mystery and exploration work best when goals, narrative, stakes, characters, or another system provide momentum.",
    strength: "Conditional",
    status: "conditional",
    evidence: "Alan Wake, Control, Obra Dinn vs. Outer Wilds, Myst"
  },
  {
    id: "H09",
    title: "Tonal collision is often a plus",
    claim: "Works that deliberately mix horror, comedy, fantasy, surrealism, or pulp can fit unusually well.",
    strength: "Conditional",
    status: "conditional",
    evidence: "Buffy, Twin Peaks, Control, Pan's Labyrinth"
  }
];

export const recommendations = [
  {
    id: "eeaao",
    about: "A multiverse action-comedy about a laundromat owner pulled into increasingly strange alternate realities.",
    rank: 1,
    title: "Everything Everywhere All at Once",
    type: "movie",
    domains: ["watch"],
    fit: "Very strong fit",
    prediction: "Likely to like",
    hypotheses: ["H04", "H08", "H09"],
    reason: "Absurd comedy, choreographed action, and deliberate tonal mixing all match established taste signals.",
    surprise: false
  },
  {
    id: "barry",
    about: "A dark comedy about a hitman who tries to leave crime behind after joining an acting class in Los Angeles.",
    rank: 2,
    title: "Barry",
    type: "tv",
    domains: ["watch"],
    fit: "Very strong fit",
    prediction: "Likely to like",
    hypotheses: ["H03", "H04", "H09"],
    reason: "A morally compromised lead, dark comedy, and tonal shifts align with several strong parts of the model.",
    surprise: false
  },
  {
    id: "wwdits",
    about: "A mockumentary comedy about a group of selfish, centuries-old vampires sharing a house.",
    rank: 3,
    title: "What We Do in the Shadows",
    type: "tv",
    domains: ["watch"],
    fit: "Strong fit",
    prediction: "Likely to like",
    hypotheses: ["H03", "H04", "H05"],
    reason: "Specific absurd comedy, selfish characters, and a supernatural frame make this a clean model match.",
    surprise: false
  },
  {
    id: "disco",
    about: "A dialogue-heavy detective RPG where you investigate a murder while rebuilding a deeply unstable protagonist.",
    rank: 4,
    title: "Disco Elysium",
    type: "game",
    domains: ["play"],
    fit: "Strong fit",
    prediction: "Likely to like",
    hypotheses: ["H03", "H04"],
    reason: "Its morally messy protagonist and dark humor fit well, though dense dialogue remains an uncertainty.",
    surprise: false
  },
  {
    id: "inscryption",
    about: "A horror card game that gradually turns into a puzzle-box mystery and keeps changing its own rules.",
    rank: null,
    title: "Inscryption",
    type: "game",
    domains: ["play"],
    fit: "Exploratory fit",
    prediction: "Worth testing",
    hypotheses: ["H01", "H02", "H09"],
    reason: "The card-game format is outside the known pattern, but structured mystery, horror identity, and genre shifts create a deeper fit.",
    surprise: true
  }
];

export const followUpPool = [
  {
    id: "fargo",
    title: "Fargo",
    type: "tv",
    domains: ["watch"],
    about: "A crime anthology series mixing violence, moral messiness, eccentric characters, and very dark humor.",
    hypotheses: ["H03", "H04"],
    reason: "Dark comedy and moral messiness give Tastemake two established signals to test together."
  },
  {
    id: "handmaiden",
    title: "The Handmaiden",
    type: "movie",
    domains: ["watch"],
    about: "A stylized period thriller built around deception, shifting loyalties, and multiple reveals.",
    hypotheses: ["H03", "H01/H07"],
    reason: "Deception, morally complex characters, and structured reveals test whether mystery works best when it has strong narrative momentum."
  },
  {
    id: "golden-idol",
    title: "The Case of the Golden Idol",
    type: "game",
    domains: ["play"],
    about: "A deduction game where you inspect frozen crime scenes and reconstruct exactly what happened.",
    hypotheses: ["H01/H07"],
    reason: "Highly structured deduction makes this a focused test of the discovery-needs-structure hypothesis."
  },
  {
    id: "vita-nostra",
    title: "Vita Nostra",
    type: "book",
    domains: ["read"],
    about: "A strange adult fantasy about a student forced into a mysterious school that changes how she understands reality.",
    hypotheses: ["H05", "H01/H07"],
    reason: "Adult fantastical material and demanding strangeness test two parts of the model at once."
  },
  {
    id: "lighthouse",
    title: "The Lighthouse",
    type: "movie",
    domains: ["watch"],
    about: "A surreal black-and-white psychological drama about two lighthouse keepers unraveling in isolation.",
    hypotheses: ["H04", "H09"],
    reason: "Black comedy, surrealism, and tonal collision make this useful when those signals are holding up."
  },
  {
    id: "yellowjackets",
    title: "Yellowjackets",
    type: "tv",
    domains: ["watch"],
    about: "A survival mystery following a girls soccer team after a crash and the adults they later become.",
    hypotheses: ["H03", "H09"],
    reason: "Messy characters, horror, and tonal shifts make this a broader cross-signal test."
  },
  {
    id: "dnd",
    title: "Dungeons & Dragons: Honor Among Thieves",
    type: "movie",
    domains: ["watch"],
    about: "A fast-moving fantasy adventure about a mismatched group of thieves trying to fix a very bad mistake.",
    hypotheses: ["H05", "H04"],
    reason: "Fantasy plus comedy tests whether those signals still work when the tone is lighter and more conventional."
  },
  // #60: broader seed set so multiple "Keep discovering" rounds have real variety to draw from instead of
  // exhausting quickly, with deliberate mix of narrow signal checks, cross-signal combinations, a likely
  // strong fit, and one item that is the H01/H07 hypothesis's own known counter-example (a probable miss).
  {
    id: "piranesi",
    title: "Piranesi",
    type: "book",
    domains: ["read"],
    about: "A hushed, dreamlike novel about a man living inside an endless, flooding house of statues.",
    hypotheses: ["H05"],
    reason: "Tests adult-fantastical fit on its own, without comedy or moral messiness alongside it."
  },
  {
    id: "severance",
    title: "Severance",
    type: "tv",
    domains: ["watch"],
    about: "A workplace thriller about employees who surgically split their memories between work and home.",
    hypotheses: ["H01/H07", "H09"],
    reason: "Heavily structured mystery plus tonal collision (corporate horror and dry comedy) tests both signals together."
  },
  {
    id: "outerwilds",
    title: "Outer Wilds",
    type: "game",
    domains: ["play"],
    about: "An open, unguided space-exploration game where discovery comes from curiosity rather than a directed system.",
    hypotheses: ["H01/H07"],
    reason: "The conditional hypothesis's own counter-example: open-ended discovery without imposed structure. A deliberate likely miss."
  },
  {
    id: "bettercallsaul",
    title: "Better Call Saul",
    type: "tv",
    domains: ["watch"],
    about: "A slow-burn character drama about a small-time lawyer's descent into compromise and rationalization.",
    hypotheses: ["H03"],
    reason: "Isolates moral messiness on its own, without comedy layered in."
  },
  {
    id: "controlgame",
    title: "Control",
    type: "game",
    domains: ["play"],
    about: "A supernatural action game set in a shifting, bureaucratic government building full of unexplained phenomena.",
    hypotheses: ["H01/H07", "H09"],
    reason: "Structured mystery plus tonal collision tests the same combination as Alan Wake, in a different domain."
  },
  {
    id: "spiderverse",
    title: "Spider-Man: Across the Spider-Verse",
    type: "movie",
    domains: ["watch"],
    about: "A visually inventive animated superhero sequel juggling multiple universes, tones, and a large ensemble.",
    hypotheses: ["H09"],
    reason: "A more mainstream pick that still tests tonal collision — a near-fit check against pickier, weirder titles."
  },
  {
    id: "signalis",
    title: "Signalis",
    type: "game",
    domains: ["play"],
    about: "A survival-horror game with a deliberately opaque, dreamlike story told through fragments.",
    hypotheses: ["H05", "H09"],
    reason: "Adult, formally strange genre work plus tonal ambiguity, in a domain where that combination is less tested."
  },
  {
    id: "the-menu",
    title: "The Menu",
    type: "movie",
    domains: ["watch"],
    about: "A dark satire about an exclusive dinner that turns into something much stranger and more dangerous.",
    hypotheses: ["H03", "H04"],
    reason: "Moral messiness and sharp, specific comedy together — a likely strong fit, useful as a confidence-check pick."
  },
  // #60: balance the expanded pool so Read and Play are real test surfaces too, not token filters.
  {
    id: "spear-cuts-water",
    title: "The Spear Cuts Through Water",
    type: "book",
    domains: ["read"],
    about: "A mythic fantasy told through an unusually layered structure, following two warriors carrying a dying god across a violent land.",
    hypotheses: ["H05", "H09"],
    reason: "Adult mythic fantasy plus formal experimentation tests whether the fantasy signal still holds when the storytelling itself is unconventional."
  },
  {
    id: "library-mount-char",
    title: "The Library at Mount Char",
    type: "book",
    domains: ["read"],
    about: "A dark contemporary fantasy about damaged adopted siblings competing over the impossible library of their missing father.",
    hypotheses: ["H03", "H05", "H09"],
    reason: "Morally messy characters, adult fantasy, and abrupt tonal shifts make this a dense cross-signal test rather than a genre-only match."
  },
  {
    id: "secret-history",
    title: "The Secret History",
    type: "book",
    domains: ["read"],
    about: "A literary crime novel about an insular group of students whose intellectual obsession curdles into murder and complicity.",
    hypotheses: ["H03"],
    reason: "Isolates the moral-messiness signal in a non-fantasy book, which helps test whether that preference travels beyond genre."
  },
  {
    id: "forgotten-city",
    title: "The Forgotten City",
    type: "game",
    domains: ["play"],
    about: "A time-loop mystery built around investigation, explicit goals, dialogue, and the consequences of a community-wide moral rule.",
    hypotheses: ["H01/H07", "H03"],
    reason: "Structured investigation and moral compromise test whether mystery works better when exploration has clear goals and human stakes."
  }
];
