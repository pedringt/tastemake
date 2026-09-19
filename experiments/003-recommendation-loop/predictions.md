# Experiment 003 committed recommendations

## Top five

| Rank | Item | Medium | Predicted reaction | Confidence | Decisive hypotheses |
| --- | --- | --- | --- | ---: | --- |
| 1 | Everything Everywhere All at Once | movie | strong_positive | 94 | H04, H08, H09 |
| 2 | Barry | tv | strong_positive | 91 | H03, H04, H09 |
| 3 | What We Do in the Shadows | tv | strong_positive | 90 | H03, H04, H05 |
| 4 | Disco Elysium | game | strong_positive | 86 | H03, H04 |
| 5 | The Library at Mount Char | book | strong_positive | 84 | H02, H05, H09 |

## Surprise Me

| Item | Medium | Predicted reaction | Confidence | Decisive hypotheses |
| --- | --- | --- | ---: | --- |
| Inscryption | game | positive | 77 | H01, H02, H09 |

### Surprise logic
The surface format, a card game, is not an obvious recommendation from the taste model. The deeper case is structured mystery, puzzles, horror with a distinct identity, meta construction, and deliberate genre shifts.

### Learning value
A strong reaction would support transferring preferences for distinctive form, structured mystery, and genre collision into unfamiliar gameplay formats. A poor reaction would suggest interaction format deserves more weight in game recommendations.

## Committed alternates

| Alternate | Item | Predicted reaction | Confidence | Decisive hypotheses |
| --- | --- | --- | ---: | --- |
| A1 | Severance | positive | 84 | H01, H04, H09 |
| A2 | The Handmaiden | positive | 82 | H03, H01 |
| A3 | The Spear Cuts Through Water | positive | 80 | H05, H09 |
| A4 | The Nice Guys | positive | 79 | H04, H01 |

## Pre-reveal read

- **Safest recommendation:** Everything Everywhere All at Once
- **Most likely to be overconfident:** The Library at Mount Char
- **Ranking failure signal:** lower-ranked alternates or Surprise Me consistently outperform higher-ranked selections even when individual predictions are directionally right.
- **Taste-model failure signal:** repeated directional failures on high-confidence hypothesis clusters, especially H03/H04 or H02/H05.

## Detailed rationale snapshot

### Everything Everywhere All at Once
Three independent positive signals: absurd comedy (H04), martial arts/choreographed action (H08), and tonal mixing (H09). Main risk: earnest family drama may matter more than the model captures.

### Barry
Morally compromised lead plus dark comedy/absurdity strongly fits H03 and H04, with tonal mixture through H09. Main risk: crime/violence may occupy more space than the model expects.

### What We Do in the Shadows
Absurd comedy and selfish characters strongly fit H04/H03, with supernatural material adding H05. Main risk: the comedy hypothesis may be too broad for this specific rhythm.

### Disco Elysium
Morally messy protagonist and dark humor strongly fit H03/H04. Main risk: dense dialogue is not modeled.

### The Library at Mount Char
Dark fantasy is supported by unconventional mythology, surrealism, and adult/distinctive treatment through H02/H05/H09. Main risk: the model may overvalue strangeness without enough evidence about narrative traction or character engagement.

### Inscryption
Structured mystery, horror identity, meta construction, and genre shifts support H01/H02/H09. Main risk: the central card-game interaction may matter more than the model predicts.

### Severance
Structured mystery plus dark humor and a distinctive visual identity support H01/H04/H09.

### The Handmaiden
Morally complex characters, deception, twists, and stylized filmmaking support H03/H01.

### The Spear Cuts Through Water
Mythic storytelling plus experimental structure support H05/H09.

### The Nice Guys
Abrasive humor strongly supports H04, with crime-mystery structure giving H01 support.
