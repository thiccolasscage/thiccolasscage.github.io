const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/catalog.json"), "utf8"));
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "logic.js"), "utf8"), sandbox, { filename: "logic.js" });

const logic = sandbox.SpinLogic;

function names(pool) {
  return Array.from(pool, (title) => title.name).sort();
}

function pool(packId, options) {
  return logic.buildNightPool(catalog, packId, options || {});
}

test("engine spin and dilemma helpers still build a pool", () => {
  const engine = logic.createEngine(catalog);
  const seen = new Set();
  const list = engine.pool({
    lanes: { mainstream: true, studio: false, streamer: false, reddit: false },
    heatMax: "suggestive",
    minScore: 60,
    query: "",
    hideSeen: true,
    seen: seen,
    themeId: null,
    packId: null,
  });
  assert.ok(list.length >= 19);
  assert.equal(typeof engine.spinDraw, "function");
  assert.equal(typeof engine.dilemmaShelf, "function");
});

test("night exposes five packs", () => {
  const packs = logic.listNightPacks();
  assert.deepEqual(Array.from(packs, (pack) => pack.label), [
    "Soft",
    "Camp",
    "Thriller",
    "Shower",
    "Prestige-sensual",
  ]);
});

test("soft pool is the light mainstream set plus named fallbacks", () => {
  assert.deepEqual(names(pool("soft", { heatMax: "suggestive" })), [
    "Challengers",
    "Knocked Up",
    "Love & Other Drugs",
    "Magic Mike",
    "Risky Business",
  ]);
  assert.equal(names(pool("soft", { heatMax: "suggestive" })).includes("American Pie"), false);
  assert.equal(names(pool("soft", { heatMax: "suggestive" })).includes("Fast Times at Ridgemont High"), false);
});

test("soft heat ceiling drops suggestive fallbacks and hide-seen removes a title", () => {
  const softOnly = names(pool("soft", { heatMax: "soft" }));
  assert.deepEqual(softOnly, ["Challengers", "Magic Mike", "Risky Business"]);
  const seen = new Set(["mainstream-challengers"]);
  const hidden = names(pool("soft", { heatMax: "suggestive", hideSeen: true, seen: seen }));
  assert.equal(hidden.includes("Challengers"), false);
  assert.equal(hidden.includes("Magic Mike"), true);
});

test("camp pool keeps the named sex-comedies and suggestive camp titles", () => {
  assert.deepEqual(names(pool("camp", { heatMax: "explicit" })), [
    "American Pie",
    "Fast Times at Ridgemont High",
    "Showgirls",
    "Wild Things",
  ]);
  assert.deepEqual(names(pool("camp", { heatMax: "soft" })), [
    "American Pie",
    "Fast Times at Ridgemont High",
  ]);
});

test("thriller pool includes the erotic thrillers and public-risk titles", () => {
  const thriller = pool("thriller", { heatMax: "suggestive" });
  const found = names(thriller);
  for (const name of ["Basic Instinct", "Body Heat", "Eyes Wide Shut", "Wild Things", "Bound"]) {
    assert.equal(found.includes(name), true, found.join(", "));
  }
  assert.equal(found.includes("Knocked Up"), false);
  assert.equal(found.includes("Showgirls"), false);
  assert.ok(thriller.some((title) => title.themes.indexOf("public_risk") !== -1));
});

test("shower pool is the shower theme, widened only when that theme is absent", () => {
  const suggestive = pool("shower", { heatMax: "suggestive" });
  assert.ok(suggestive.length >= 2);
  assert.ok(suggestive.every((title) => title.themes.indexOf("shower") !== -1));
  assert.equal(suggestive.some((title) => title.heat === "explicit"), false);
  const all = pool("shower");
  assert.ok(all.length > suggestive.length);

  const broad = logic.buildNightPool({
    heats: [{ id: "soft", rank: 1 }, { id: "suggestive", rank: 2 }],
    themes: [{ id: "steam_bath", label: "Shower scene", keyword: "bath" }],
    titles: [
      { id: "a", name: "Steam", lane: "mainstream", heat: "soft", year: 2001, themes: ["steam_bath"], score: 10, genres: [] },
      { id: "b", name: "Office", lane: "mainstream", heat: "soft", year: 2002, themes: ["desk"], score: 9, genres: [] },
    ],
  }, "shower");
  assert.deepEqual(names(broad), ["Steam"]);
});

test("prestige pool is the sensual art-house set", () => {
  assert.deepEqual(names(pool("prestige", { heatMax: "suggestive" })), [
    "9½ Weeks",
    "Blue Is the Warmest Color",
    "Eyes Wide Shut",
    "Nymphomaniac: Vol. I",
    "Secretary",
    "The Dreamers",
    "Y Tu Mamá También",
  ]);
});

test("camp and thriller match director, title, and theme text", () => {
  const custom = {
    heats: [
      { id: "soft", rank: 1 },
      { id: "suggestive", rank: 2 },
      { id: "explicit", rank: 3 },
    ],
    themes: [{ id: "meyer", label: "Ultra-Vixens", keyword: "vixen" }],
    titles: [
      { id: "meyer", name: "Beneath the Valley", director: "Russ Meyer", lane: "mainstream", heat: "suggestive", year: 1970, themes: [], score: 40, genres: [], tag: "Camp" },
      { id: "theme", name: "Shelf", lane: "mainstream", heat: "suggestive", year: 1979, themes: ["meyer"], score: 30, genres: [], tag: "Camp" },
      { id: "sliver", name: "Sliver", lane: "mainstream", heat: "suggestive", year: 1993, themes: ["hotel"], score: 50, genres: [{ label: "Thriller", score: 80 }], tag: "Thriller" },
      { id: "strings", name: "No Strings Attached", lane: "mainstream", heat: "suggestive", year: 2011, themes: ["boobs"], score: 60, genres: [{ label: "Comedy", score: 70 }], tag: "Comedy" },
    ],
  };
  assert.deepEqual(names(logic.buildNightPool(custom, "camp")), ["Beneath the Valley", "Shelf"]);
  assert.equal(names(logic.buildNightPool(custom, "thriller")).includes("Sliver"), true);
  assert.equal(names(logic.buildNightPool(custom, "soft")).includes("No Strings Attached"), true);
});

test("draw helpers return one title per requested pack and skip repeats", () => {
  const soft = pool("soft", { heatMax: "suggestive" });
  assert.equal(logic.drawNightTitle(soft, () => 0).id, soft[0].id);
  assert.equal(logic.drawNightTitle(soft, () => 0, soft[0].id).id, soft[1].id);
  assert.equal(logic.drawNightTitle([], () => 0), null);

  const picks = logic.drawNightAll(catalog, { heatMax: "suggestive" }, () => 0);
  assert.ok(picks.length <= 5);
  assert.equal(new Set(picks.map((pick) => pick.packId)).size, picks.length);
  assert.equal(new Set(picks.map((pick) => pick.title.id)).size, picks.length);
  assert.deepEqual(Array.from(picks, (pick) => pick.packId), ["soft", "camp", "thriller", "shower", "prestige"]);
});

test("copy night is plain text with pack, title, and year", () => {
  const picks = [
    { label: "Soft", title: { name: "Challengers", year: 2024, posterKey: "challengers-sm" } },
    { packId: "camp", label: "Camp", title: { name: "Showgirls", year: 1995, links: [{ href: "https://example.invalid/still.jpg" }] } },
  ];
  const text = logic.formatNightCopy(picks);
  assert.equal(text, "Soft — Challengers (2024)\nCamp — Showgirls (1995)");
  assert.equal(text.includes("http"), false);
  assert.equal(text.includes(".jpg"), false);
  assert.equal(text.includes("poster"), false);
});
