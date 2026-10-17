// JSON schemas for the API's structured outputs (output_config.format), Oct 16. The Oct 16 stress run
// had 8 of 360 Haiku 5.5 pick calls fall back to the catalog on malformed JSON (missing commas,
// unterminated strings); with a schema the API returns JSON that parses. The schemas fix the SHAPE
// only: allowed values (levels, cross-domain labels, which ids may be cited) stay with the validators,
// so what counts as a good answer is unchanged.

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const strings = { type: "array", items: { type: "string" } };

export const PICKS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: { itemId: { type: "string" }, why: { type: "string" }, cites: strings },
        required: ["itemId", "why", "cites"],
        additionalProperties: false
      }
    },
    curveballItemId: nullableString
  },
  required: ["picks", "curveballItemId"],
  additionalProperties: false
};

export const HYPOTHESES_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          claim: { type: "string" },
          evidence: strings,
          counter: strings,
          domains: strings,
          crossDomain: { type: "string" },
          level: { type: "string" },
          conditional: { type: "boolean" },
          context: nullableString
        },
        required: ["id", "label", "claim", "evidence", "counter", "domains", "crossDomain", "level", "conditional", "context"],
        additionalProperties: false
      }
    },
    insufficientEvidence: { type: "boolean" }
  },
  required: ["hypotheses", "insufficientEvidence"],
  additionalProperties: false
};
