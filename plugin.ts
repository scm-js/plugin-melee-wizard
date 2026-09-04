/**
 * Melee Wizard — a plugin for the scmJS map editor (https://github.com/jeany55/scm-js).
 *
 * Tools ▸ Melee Wizard… opens a panel beside the map for the parts of a ladder-style map
 * that are geometry rather than art: symmetric start locations for 2, 4 or 8 players,
 * and a base's resources — the mineral line on the three-tile ring the game mines
 * fastest from, wrapping round the hall's corner, and the geyser past one end of it —
 * placed for every player at once. Each is one action and one undo step. Beside those:
 * bases at every start location the map already has, a blocking patch tool, mirroring
 * whatever units are selected, a symmetry check, and a per-player resource summary.
 *
 * The map work is `api.ui.mapTool` (a press-and-drag that points the mineral line, with
 * the layout previewed as it goes — refused spots in red), `api.ui.panel` and
 * `api.document.edit` with `placeUnit` / `canPlaceUnit` / `updateUnits`. `layout.ts` is
 * the pure geometry (the ring, the line, the symmetries) with its own tests; this file
 * is the panel, the tools and the transactions. `@scm-js/plugin-api` is the editor's type
 * declarations, a devDependency generated from its own `src/plugins/api.ts`; the host
 * erases the type-only import.
 */
import type { EditTransaction, MapPointer, MapToolHandle, MapView, PanelHandle, PluginApi } from "@scm-js/plugin-api";
import {
  angleDiff, baseImages, centreOf, HALL, inMap, isResource, MINERAL, MINERAL_FIELDS, NEUTRAL, outwardDirection,
  rectAt, rectImages, sameKind, snapAngle, START_LOCATION, summarizeBases, swapsAxes, symmetryAvailable, symmetryAxes, symmetryGaps, symmetryImages, symmetryInfo, SYMMETRIES, TILE,
  VESPENE_GEYSER,
  type BaseSpec, type BaseUnits, type GeyserSide, type MineralLook, type Placed, type Point, type PointMap, type ResourceValues, type SymmetryMode, type TileRect,
} from "./layout";

/* ── DOM helpers ────────────────────────────────────────── */

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "className") el.className = String(v);
      else if (k === "style") el.setAttribute("style", String(v));
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

const STYLE = `
.mlw { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.mlw .mlw-row { display: grid; grid-template-columns: 78px 1fr; align-items: center; gap: 6px; min-height: 22px; }
.mlw .mlw-row > label { color: var(--text-dim, #99a2b3); }
.mlw .mlw-row .mlw-in { display: flex; align-items: center; gap: 6px; min-width: 0; }
.mlw .mlw-row select { flex: 1; min-width: 0; }
.mlw .mlw-row input[type=number] { width: 62px; }
.mlw .mlw-row .mlw-unit { color: var(--text-dim, #99a2b3); }
.mlw .mlw-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.mlw .mlw-tool { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 4px 5px; border: 1px solid var(--border, #333); border-radius: 4px; background: var(--bg-2, #1b1f27); color: var(--text, #e6e9ef); cursor: pointer; font-size: 11px; text-align: center; }
.mlw .mlw-tool:hover { background: var(--bg-3, #232833); }
.mlw .mlw-tool.on { background: var(--teal-dim, #2c8a83); border-color: var(--teal, #4fd1c5); color: #fff; }
.mlw .mlw-tool .mlw-glyph { font-size: 16px; line-height: 18px; }
.mlw .mlw-tool[disabled] { opacity: .45; cursor: default; }
.mlw details { border: 1px solid var(--border, #333); border-radius: 4px; background: var(--bg-1, #14171d); }
.mlw details > summary { cursor: pointer; padding: 4px 8px; color: var(--text, #e6e9ef); user-select: none; }
.mlw details > .mlw-body { display: flex; flex-direction: column; gap: 6px; padding: 6px 8px 8px; border-top: 1px solid var(--border, #333); }
.mlw .mlw-status { padding: 5px 8px; border: 1px solid var(--border, #333); border-radius: 4px; background: var(--bg-0, #0f1115); line-height: 1.4; min-height: 30px; }
.mlw .mlw-status b { color: var(--gold, #e6b95c); }
.mlw .mlw-status .bad { color: #ff9f7a; }
.mlw .mlw-list { display: flex; flex-direction: column; max-height: 150px; overflow: auto; }
.mlw .mlw-item { display: flex; gap: 6px; padding: 2px 4px; cursor: pointer; }
.mlw .mlw-item:hover { background: var(--bg-3, #232833); }
.mlw .mlw-item .mlw-grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mlw .mlw-item .mlw-dim { color: var(--text-dim, #99a2b3); white-space: nowrap; }
.mlw .mlw-btns { display: flex; flex-wrap: wrap; gap: 4px; }
.mlw .mlw-keys { color: var(--text-faint, #6b7382); font-size: 11px; line-height: 1.4; }
.mlw .mlw-keys kbd { font-family: inherit; color: var(--text-dim, #99a2b3); }
`;

/* ── Settings ───────────────────────────────────────────── */

type Preset = "main" | "natural" | "third" | "custom";

const PRESETS: { id: Preset; label: string; minerals: number; geysers: number }[] = [
  { id: "main", label: "Main: 8 patches, 1 geyser", minerals: 8, geysers: 1 },
  { id: "natural", label: "Natural: 7 patches, 1 geyser", minerals: 7, geysers: 1 },
  { id: "third", label: "Third: 6 patches, 1 geyser", minerals: 6, geysers: 1 },
  { id: "custom", label: "Custom", minerals: 8, geysers: 1 },
];

interface Settings {
  symmetry: SymmetryMode;
  showAxes: boolean;
  preset: Preset;
  minerals: number;
  geysers: number;
  gap: number;
  geyserGap: number;
  geyserSpacing: number;
  geyserSide: GeyserSide;
  mineralValue: number;
  gasValue: number;
  /** Null: the same as the rest. */
  endPatches: number | null;
  look: MineralLook;
  /** Leave out any resource the Units palette's placement checks refuse. */
  skipRefused: boolean;
  /** Place the images for every player, not just the base under the pointer. */
  mirror: boolean;
  /** Snap the dragged direction to 45°. */
  snap45: boolean;
  /** Replace a player's existing start location rather than adding another. */
  replaceStarts: boolean;
  /** The blocking patch tool's amount. */
  blockValue: number;
}

const DEFAULTS: Settings = {
  symmetry: "rot180", showAxes: true, preset: "main", minerals: 8, geysers: 1, gap: 3, geyserGap: 3, geyserSpacing: 1, geyserSide: "auto",
  mineralValue: 1500, gasValue: 5000, endPatches: null, look: "mixed", skipRefused: true, mirror: true, snap45: false, replaceStarts: true, blockValue: 8,
};

function loadSettings(api: PluginApi): Settings {
  const stored = api.storage.get<Partial<Settings>>("settings", {});
  const s = { ...DEFAULTS, ...stored };
  if (!SYMMETRIES.some((m) => m.id === s.symmetry)) s.symmetry = DEFAULTS.symmetry;
  if (!PRESETS.some((p) => p.id === s.preset)) s.preset = DEFAULTS.preset;
  return s;
}

/* ── The session ────────────────────────────────────────── */

type ToolId = "starts" | "base" | "block";

interface Ghost {
  /** Footprints to draw: hall, patch or geyser, with whether the map would take a unit there, per image. */
  boxes: { rect: TileRect; kind: "hall" | "mineral" | "geyser" | "start"; ok: boolean; image: number; label?: string }[];
  /** The drag, for the base tool. */
  from: { x: number; y: number } | null;
  to: { x: number; y: number } | null;
}

class Session {
  readonly api: PluginApi;
  settings: Settings;
  panel: PanelHandle | null = null;
  tool: MapToolHandle | null = null;
  toolId: ToolId | null = null;
  ghost: Ghost | null = null;
  press: { x: number; y: number; hall: TileRect } | null = null;
  refresh: (() => void)[] = [];
  /** The last result, for the panel. */
  status = "";
  gaps: { index: number; image: number }[] = [];

  constructor(api: PluginApi) {
    this.api = api;
    this.settings = loadSettings(api);
  }

  save() { this.api.storage.set("settings", this.settings); }
  notify() { for (const r of this.refresh) r(); }
  get active() { return this.tool?.isActive() ?? false; }

  say(text: string) {
    this.status = text;
    this.api.ui.status(`Melee Wizard: ${text.replace(/<[^>]+>/g, "")}`);
    this.notify();
  }

  /* ── what the map and the settings give us ── */

  size(): { width: number; height: number; W: number; H: number } | null {
    const info = this.api.document.info();
    if (!info) return null;
    return { width: info.width, height: info.height, W: info.width * TILE, H: info.height * TILE };
  }

  /** The symmetry as it applies to the open map: square-only modes fall back to none on a wide map. */
  mode(): SymmetryMode {
    const sz = this.size();
    if (!sz) return "none";
    return symmetryAvailable(this.settings.symmetry, sz.width, sz.height) ? this.settings.symmetry : "none";
  }

  images(): PointMap[] {
    const sz = this.size();
    if (!sz) return [(p) => p];
    return symmetryImages(this.mode(), sz.W, sz.H);
  }

  /** The map's centre: where a half-tile rounds towards, so quarter-turn images stay half-turn images of each other. */
  toward(): Point | undefined {
    const sz = this.size();
    return sz ? { x: sz.W / 2, y: sz.H / 2 } : undefined;
  }

  spec(direction: number): BaseSpec {
    const s = this.settings;
    return { minerals: s.minerals, geysers: s.geysers, gap: s.gap, geyserGap: s.geyserGap, geyserSpacing: s.geyserSpacing, geyserSide: s.geyserSide, direction };
  }

  values(): ResourceValues {
    const s = this.settings;
    return { minerals: s.mineralValue, gas: s.gasValue, endPatches: s.endPatches, look: s.look };
  }

  /** The player slot a unit of `owner` has under image `k`: the image's own player for a player in the layout, unchanged otherwise. */
  ownerImage(owner: number, k: number): number {
    const imgs = this.images();
    if (owner >= imgs.length) return owner;
    // Find m with g_m = g_k ∘ g_owner by testing a generic point.
    const sz = this.size();
    if (!sz) return owner;
    const probe = { x: sz.W / 3 + 7, y: sz.H / 5 + 3 };
    const target = imgs[k](imgs[owner](probe));
    for (let m = 0; m < imgs.length; m++) {
      const q = imgs[m](probe);
      if (Math.abs(q.x - target.x) < 1 && Math.abs(q.y - target.y) < 1) return m;
    }
    return owner;
  }

  /**
   * How far an image may be from where the symmetry puts it: half a tile for anything
   * snapped to the grid. A resource under an image that swaps the axes gets more, since
   * such a mineral line is laid out again rather than mapped patch by patch and a line
   * along the hall's side is twice as long as one along its top: six tiles when
   * checking (a patch with no patch within six tiles of its image is surely missing),
   * one tile when mirroring (so a patch is only skipped when one already sits there).
   */
  tolerance(unitId: number, image: number, purpose: "check" | "mirror" = "check"): number {
    if (isResource(unitId) && swapsAxes(this.images()[image])) return purpose === "check" ? 6 * TILE : TILE;
    return TILE / 2;
  }

  /* ── tools ── */

  start(id: ToolId) {
    if (!this.api.document.isOpen()) { this.say("open a map first"); return; }
    if (this.active && this.toolId === id) { this.stop(); return; }
    this.toolId = id;
    this.ghost = null;
    this.press = null;
    const names: Record<ToolId, { name: string; hint: string }> = {
      starts: { name: "Melee Wizard: start locations", hint: "click where Player 1 starts; the others follow the symmetry" },
      base: { name: "Melee Wizard: base", hint: "press on the town hall spot and drag towards where the minerals go; a click points them away from the map's centre" },
      block: { name: "Melee Wizard: blocking patch", hint: "click to drop a mineral patch of the blocking amount" },
    };
    this.tool = this.api.ui.mapTool({
      ...names[id],
      onDown: (p) => this.onDown(p),
      onMove: (p) => this.onMove(p),
      onUp: (p) => this.onUp(p),
      onCancel: () => this.onCancel(),
      draw: (ctx, view) => this.draw(ctx, view),
      onStop: (reason) => {
        this.ghost = null;
        this.press = null;
        if (reason !== "replaced") { this.tool = null; this.toolId = null; }
        this.notify();
      },
    });
    this.notify();
  }

  stop() { this.tool?.stop(); }

  private onCancel(): boolean {
    if (this.press) { this.press = null; this.ghost = null; this.tool?.redraw(); return true; }
    return false;
  }

  private hallUnder(p: MapPointer): TileRect {
    // Snap onto an existing start location's hall when the pointer is inside it.
    for (const s of this.api.query.startLocations()) {
      const r = rectAt(s.x, s.y, HALL);
      if (p.tx >= r.x && p.tx < r.x + r.w && p.ty >= r.y && p.ty < r.y + r.h) return r;
    }
    return rectAt(p.px, p.py, HALL);
  }

  private onDown(p: MapPointer) {
    if (!p.inMap) return;
    if (this.toolId === "base") {
      const hall = this.hallUnder(p);
      this.press = { x: p.px, y: p.py, hall };
      this.previewBase(p);
    }
  }

  private onMove(p: MapPointer) {
    if (this.toolId === "starts") this.previewStarts(p);
    else if (this.toolId === "base") { if (this.press) this.previewBase(p); else this.previewHall(p); }
    else if (this.toolId === "block") this.previewBlock(p);
    this.tool?.redraw();
  }

  private onUp(p: MapPointer) {
    if (this.toolId === "starts") { if (p.inMap) this.placeStarts(p); }
    else if (this.toolId === "base") { if (this.press) { this.previewBase(p); this.placeBase(); } }
    else if (this.toolId === "block") { if (p.inMap) this.placeBlock(p); }
    this.press = null;
    if (this.toolId === "base") this.previewHall(p);
    this.tool?.redraw();
  }

  /* ── previews ── */

  private previewStarts(p: MapPointer) {
    if (!p.inMap) { this.ghost = null; return; }
    const sz = this.size();
    if (!sz) return;
    const hall = rectAt(p.px, p.py, HALL);
    const rects = rectImages(hall, this.images(), this.toward());
    this.ghost = {
      boxes: rects.map((rect, image) => ({ rect, kind: "start", ok: inMap(rect, sz.width, sz.height), image, label: this.api.names.player(image) })),
      from: null, to: null,
    };
  }

  private previewHall(p: MapPointer) {
    if (!p.inMap) { this.ghost = null; return; }
    const hall = this.hallUnder(p);
    this.ghost = { boxes: [{ rect: hall, kind: "hall", ok: true, image: 0 }], from: null, to: null };
  }

  private direction(p: MapPointer): number {
    const sz = this.size()!;
    const press = this.press!;
    const c = centreOf(press.hall);
    const dx = p.px - c.x;
    const dy = p.py - c.y;
    if (Math.hypot(dx, dy) < TILE) return outwardDirection(c.x, c.y, sz.width, sz.height);
    const a = Math.atan2(dy, dx);
    return this.settings.snap45 || p.shift ? snapAngle(a) : a;
  }

  private previewBase(p: MapPointer) {
    const sz = this.size();
    if (!sz || !this.press) return;
    const bases = baseImages(this.press.hall, this.spec(this.direction(p)), this.values(), this.settings.mirror ? this.images() : this.images().slice(0, 1), this.toward());
    const boxes: Ghost["boxes"] = [];
    for (const b of bases) {
      boxes.push({ rect: b.hall, kind: "hall", ok: inMap(b.hall, sz.width, sz.height), image: b.image });
      for (const r of b.resources) {
        const c = centreOf(r.rect);
        const ok = inMap(r.rect, sz.width, sz.height) && this.api.query.placement(r.unitId, c.x, c.y)?.problem === null;
        boxes.push({ rect: r.rect, kind: r.unitId === VESPENE_GEYSER ? "geyser" : "mineral", ok, image: b.image });
      }
    }
    this.ghost = { boxes, from: centreOf(this.press.hall), to: { x: p.px, y: p.py } };
  }

  private previewBlock(p: MapPointer) {
    if (!p.inMap) { this.ghost = null; return; }
    const sz = this.size();
    if (!sz) return;
    const rect = rectAt(p.px, p.py, MINERAL);
    const c = centreOf(rect);
    const ok = inMap(rect, sz.width, sz.height) && this.api.query.placement(MINERAL_FIELDS[0], c.x, c.y)?.problem === null;
    this.ghost = { boxes: [{ rect, kind: "mineral", ok, image: 0 }], from: null, to: null };
  }

  /* ── placing ── */

  private placeStarts(p: MapPointer) {
    const sz = this.size();
    if (!sz) return;
    const hall = rectAt(p.px, p.py, HALL);
    const rects = rectImages(hall, this.images(), this.toward());
    const n = rects.length;
    const result = this.api.document.edit(`Place ${n} start location${n === 1 ? "" : "s"}`, (tx) => {
      if (this.settings.replaceStarts) {
        const old = tx.scenario.units.map((u, i) => (u.unitId === START_LOCATION && u.owner < n ? i : -1)).filter((i) => i >= 0);
        if (old.length) tx.removeUnits(old);
      }
      rects.forEach((rect, image) => {
        if (!inMap(rect, sz.width, sz.height)) { tx.note(`${this.api.names.player(image)}'s start location would be off the map`); return; }
        const c = centreOf(rect);
        tx.placeUnit(START_LOCATION, image, c.x, c.y);
      });
    });
    this.say(result.changed ? `placed <b>${result.units}</b> start location${result.units === 1 ? "" : "s"}${result.notes.length ? ` <span class="bad">· ${result.notes.join(" · ")}</span>` : ""}` : "nothing placed");
  }

  /** Place a laid-out base and its images; returns what was placed. */
  placeBases(bases: BaseUnits[], label: string): { placed: number; skipped: number; notes: string[] } {
    const sz = this.size();
    const out = { placed: 0, skipped: 0, notes: [] as string[] };
    if (!sz) return out;
    const result = this.api.document.edit(label, (tx) => {
      for (const b of bases) {
        for (const r of b.resources) {
          const c = centreOf(r.rect);
          if (!inMap(r.rect, sz.width, sz.height)) { out.skipped++; continue; }
          if (this.settings.skipRefused && !tx.canPlaceUnit(r.unitId, c.x, c.y)) { out.skipped++; continue; }
          const index = tx.placeUnit(r.unitId, NEUTRAL, c.x, c.y);
          setAmount(tx, index, r.amount);
          out.placed++;
        }
      }
      if (out.skipped) tx.note(`${out.skipped} skipped: off the map, or the ground or another unit refused them`);
    });
    out.notes = result.notes;
    return out;
  }

  private placeBase() {
    if (!this.press || !this.ghost?.to) return;
    const dir = Math.atan2(this.ghost.to.y - this.ghost.from!.y, this.ghost.to.x - this.ghost.from!.x);
    const sz = this.size()!;
    const c = centreOf(this.press.hall);
    const direction = Math.hypot(this.ghost.to.x - c.x, this.ghost.to.y - c.y) < TILE ? outwardDirection(c.x, c.y, sz.width, sz.height) : this.settings.snap45 ? snapAngle(dir) : dir;
    const images = this.settings.mirror ? this.images() : this.images().slice(0, 1);
    const bases = baseImages(this.press.hall, this.spec(direction), this.values(), images, this.toward());
    const n = images.length;
    const r = this.placeBases(bases, `Add base${n > 1 ? ` for ${n} players` : ""}`);
    this.sayPlaced(r, bases, n);
  }

  private sayPlaced(r: { placed: number; skipped: number }, bases: BaseUnits[], n: number) {
    const short = bases.reduce((sum, b) => sum + b.layout.short.minerals + b.layout.short.geysers, 0);
    const parts = [`placed <b>${r.placed}</b> resource${r.placed === 1 ? "" : "s"}${n > 1 ? ` over ${n} bases` : ""}`];
    if (r.skipped) parts.push(`<span class="bad">${r.skipped} skipped (off the map, or the ground or another unit refused them)</span>`);
    if (short) parts.push(`<span class="bad">the ring had no room for ${short}</span>`);
    this.say(parts.join(" · "));
  }

  private placeBlock(p: MapPointer) {
    const sz = this.size();
    if (!sz) return;
    const rect = rectAt(p.px, p.py, MINERAL);
    if (!inMap(rect, sz.width, sz.height)) return;
    const c = centreOf(rect);
    const result = this.api.document.edit(`Blocking patch (${this.settings.blockValue})`, (tx) => {
      if (this.settings.skipRefused && !tx.canPlaceUnit(MINERAL_FIELDS[0], c.x, c.y)) { tx.note("the spot is refused"); return; }
      const index = tx.placeUnit(MINERAL_FIELDS[0], NEUTRAL, c.x, c.y);
      setAmount(tx, index, this.settings.blockValue);
    });
    this.say(result.units ? `blocking patch of <b>${this.settings.blockValue}</b> at ${rect.x}, ${rect.y}` : `<span class="bad">nothing placed: ${result.notes.join(", ") || "refused"}</span>`);
  }

  /** Bases at every start location the map has: mirrored from the first when the starts follow the symmetry, laid out one by one otherwise. */
  basesAtStarts() {
    const sz = this.size();
    if (!sz) { this.say("open a map first"); return; }
    const starts = this.api.query.startLocations().sort((a, b) => a.owner - b.owner);
    if (!starts.length) { this.say("<span class=\"bad\">the map has no start locations</span>"); return; }
    const images = this.images();
    const symmetric = this.mode() !== "none" && starts.length === images.length && images.every((f, k) => {
      const q = f({ x: starts[0].x, y: starts[0].y });
      return Math.abs(q.x - starts[k].x) <= TILE && Math.abs(q.y - starts[k].y) <= TILE;
    });
    let bases: BaseUnits[] = [];
    if (symmetric) {
      const hall = rectAt(starts[0].x, starts[0].y, HALL);
      bases = baseImages(hall, this.spec(outwardDirection(starts[0].x, starts[0].y, sz.width, sz.height)), this.values(), images, this.toward());
    } else {
      starts.forEach((s, i) => {
        const hall = rectAt(s.x, s.y, HALL);
        bases.push(...baseImages(hall, this.spec(outwardDirection(s.x, s.y, sz.width, sz.height)), this.values(), [(p) => p]).map((b) => ({ ...b, image: i })));
      });
    }
    const r = this.placeBases(bases, `Bases at ${starts.length} start location${starts.length === 1 ? "" : "s"}`);
    this.sayPlaced(r, bases, starts.length);
    if (!symmetric && this.mode() !== "none") this.say(`${this.status} · <span class="bad">the start locations do not follow the chosen symmetry, so each base was laid out on its own</span>`);
  }

  /* ── extras ── */

  private placed(): Placed[] {
    const scn = this.api.document.scenario();
    if (!scn) return [];
    return scn.units.map((u, index) => ({ index, unitId: u.unitId, owner: u.owner, x: u.x, y: u.y }));
  }

  mirrorSelection() {
    const sel = this.api.selection.units();
    if (!sel.length) { this.say("<span class=\"bad\">select some units first (on the Units layer)</span>"); return; }
    const images = this.images();
    if (images.length < 2) { this.say("<span class=\"bad\">choose a symmetry first</span>"); return; }
    const all = this.placed();
    const chosen = all.filter((u) => sel.includes(u.index));
    const missing = symmetryGaps(chosen.map((u) => ({ ...u })), images, (o, k) => this.ownerImage(o, k), (u, k) => this.tolerance(u.unitId, k, "mirror")).filter((g) => {
      // Only images not already on the map, judged against every unit rather than just the selection.
      const u = all[g.index];
      const p = images[g.image]({ x: u.x, y: u.y });
      const owner = u.unitId === START_LOCATION ? g.image : this.ownerImage(u.owner, g.image);
      const tol = this.tolerance(u.unitId, g.image, "mirror");
      return !all.some((v) => sameKind(v.unitId, u.unitId) && (u.unitId === START_LOCATION || v.owner === owner) && Math.abs(v.x - p.x) <= tol && Math.abs(v.y - p.y) <= tol);
    });
    if (!missing.length) { this.say("every selected unit already has its images"); return; }
    const scn = this.api.document.scenario()!;
    const sz = this.size()!;
    let placed = 0;
    let skipped = 0;
    this.api.document.edit(`Mirror ${sel.length} unit${sel.length === 1 ? "" : "s"}`, (tx) => {
      for (const g of missing) {
        const u = scn.units[g.index];
        const p = images[g.image]({ x: u.x, y: u.y });
        const size = this.api.palette.unitSize(u.unitId);
        // A building's box snaps back to the grid; anything else lands exactly where the image says.
        const at = size.building ? centreOf(rectAt(p.x, p.y, { w: Math.max(1, Math.round(size.width / TILE)), h: Math.max(1, Math.round(size.height / TILE)) }, this.toward())) : p;
        if (at.x < 0 || at.y < 0 || at.x > sz.W || at.y > sz.H) { skipped++; continue; }
        if (this.settings.skipRefused && !tx.canPlaceUnit(u.unitId, at.x, at.y)) { skipped++; continue; }
        const owner = u.unitId === START_LOCATION ? g.image : this.ownerImage(u.owner, g.image);
        const index = tx.placeUnit(u.unitId, owner, at.x, at.y);
        tx.updateUnits([index], () => ({
          hitPointsPercent: u.hitPointsPercent, shieldPercent: u.shieldPercent, energyPercent: u.energyPercent, resourceAmount: u.resourceAmount,
          hangarUnits: u.hangarUnits, stateFlags: u.stateFlags, validProperties: u.validProperties, validStates: u.validStates,
        }));
        placed++;
      }
      if (skipped) tx.note(`${skipped} skipped`);
    });
    this.say(`mirrored <b>${placed}</b> unit${placed === 1 ? "" : "s"}${skipped ? ` <span class="bad">· ${skipped} skipped (off the map or refused)</span>` : ""}`);
  }

  checkSymmetry() {
    const images = this.images();
    if (images.length < 2) { this.say("<span class=\"bad\">choose a symmetry first</span>"); return; }
    const all = this.placed();
    this.gaps = symmetryGaps(all, images, (o, k) => this.ownerImage(o, k), (u, k) => this.tolerance(u.unitId, k));
    const indices = [...new Set(this.gaps.map((g) => g.index))];
    this.api.selection.setUnits(indices);
    if (!indices.length) this.say(`every unit has its images under <b>${symmetryInfo(this.mode()).label}</b>`);
    else this.say(`<span class="bad">${indices.length} unit${indices.length === 1 ? "" : "s"} without a counterpart</span> — selected on the map, listed below`);
  }

  summary(): string {
    const scn = this.api.document.scenario();
    if (!scn) return "";
    const all = this.placed();
    const rows = summarizeBases(all, (i) => scn.units[i].resourceAmount);
    if (!rows.length) return "no start locations";
    return rows.sort((a, b) => a.owner - b.owner).map((r) => `${this.api.names.player(r.owner)}: ${r.patches} patch${r.patches === 1 ? "" : "es"} (${r.mineralTotal}), ${r.geysers} geyser${r.geysers === 1 ? "" : "s"}`).join("<br>");
  }

  /* ── drawing ── */

  draw(ctx: CanvasRenderingContext2D, view: MapView) {
    const sz = this.size();
    if (!sz) return;
    ctx.lineWidth = 1;
    if (this.settings.showAxes) {
      const mode = this.mode();
      ctx.strokeStyle = "rgba(230,185,92,.7)";
      ctx.setLineDash([8, 6]);
      for (const [a, b] of symmetryAxes(mode, sz.W, sz.H)) {
        ctx.beginPath();
        ctx.moveTo(view.x(a.x), view.y(a.y));
        ctx.lineTo(view.x(b.x), view.y(b.y));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (mode !== "none") {
        // The centre of rotation.
        const cx = view.x(sz.W / 2);
        const cy = view.y(sz.H / 2);
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const g = this.ghost;
    if (!g) return;
    const tp = view.tilePx;
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const b of g.boxes) {
      const x = view.x(b.rect.x * TILE);
      const y = view.y(b.rect.y * TILE);
      const w = b.rect.w * tp;
      const hh = b.rect.h * tp;
      const colour = !b.ok ? "#ff5a4a" : b.kind === "hall" || b.kind === "start" ? "#e6b95c" : b.kind === "geyser" ? "#7fe07a" : "#4fd1c5";
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour.replace(")", "").startsWith("#") ? hexAlpha(colour, b.image === 0 ? 0.28 : 0.16) : colour;
      ctx.setLineDash(b.image === 0 ? [] : [4, 3]);
      ctx.lineWidth = b.kind === "hall" || b.kind === "start" ? 2 : 1;
      ctx.fillRect(x, y, w, hh);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
      if (b.label && tp >= 6) {
        ctx.fillStyle = "rgba(0,0,0,.7)";
        const tw = ctx.measureText(b.label).width + 8;
        ctx.fillRect(x + w / 2 - tw / 2, y + hh / 2 - 8, tw, 16);
        ctx.fillStyle = colour;
        ctx.fillText(b.label, x + w / 2, y + hh / 2);
      }
    }
    ctx.setLineDash([]);
    if (g.from && g.to) {
      // The direction being dragged, from the hall's centre.
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(view.x(g.from.x), view.y(g.from.y));
      ctx.lineTo(view.x(g.to.x), view.y(g.to.y));
      ctx.stroke();
      const a = Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x);
      const deg = Math.round(((angleDiff(a, 0) * 180) / Math.PI + 360) % 360);
      const text = Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y) < TILE ? "away from the centre" : `${deg}°`;
      ctx.fillStyle = "rgba(0,0,0,.7)";
      const tw = ctx.measureText(text).width + 8;
      ctx.fillRect(view.x(g.to.x) - tw / 2, view.y(g.to.y) - 22, tw, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, view.x(g.to.x), view.y(g.to.y) - 14);
    }
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** UNIT `validStates` bit for "resources set". */
const USED_RESOURCES = 16;

function setAmount(tx: EditTransaction, index: number, amount: number) {
  if (index < 0) return;
  tx.updateUnits([index], (u) => ({ resourceAmount: amount, validStates: u.validStates | USED_RESOURCES }));
}

/* ── The panel ──────────────────────────────────────────── */

function mountPanel(session: Session, body: HTMLElement): () => void {
  const api = session.api;
  const s = session.settings;
  const W = api.ui.widgets;
  body.append(h("style", null, STYLE));
  const root = h("div", { className: "mlw" });
  body.append(root);

  const row = (label: string, ...children: Child[]) => h("div", { className: "mlw-row" }, h("label", null, label), h("div", { className: "mlw-in" }, ...children));
  const unit = (text: string) => h("span", { className: "mlw-unit" }, text);
  const num = (key: keyof Settings, min: number, max: number, after?: () => void) => W.number({
    value: s[key] as number, min, max, step: 1,
    onChange: (v) => { (s as unknown as Record<string, unknown>)[key] = Math.min(max, Math.max(min, Math.round(v))); session.save(); after?.(); session.tool?.redraw(); },
  });
  const section = (title: string, open: boolean, ...children: Child[]) => {
    const det = h("details", { open }) as HTMLDetailsElement;
    det.append(h("summary", null, title), h("div", { className: "mlw-body" }, ...children));
    return det;
  };

  /* Symmetry */
  const symSel = W.select(SYMMETRIES.map((m) => ({ value: m.id, label: m.label })), { value: s.symmetry, onChange: (v) => { s.symmetry = v as SymmetryMode; session.save(); render(); session.tool?.redraw(); } });
  const symNote = h("div", { className: "mlw-keys" });
  root.append(section("Symmetry", true,
    row("Layout", symSel),
    symNote,
    W.checkbox("Draw the axes on the map while a tool runs", { value: s.showAxes, onChange: (v) => { s.showAxes = v; session.save(); session.tool?.redraw(); } }),
  ));

  /* Tools */
  const tools: { id: ToolId; label: string; glyph: string }[] = [
    { id: "starts", label: "Start locations", glyph: "⌂" },
    { id: "base", label: "Add base (drag)", glyph: "◈" },
  ];
  const toolBtns = new Map<ToolId, HTMLButtonElement>();
  const toolGrid = h("div", { className: "mlw-tools" });
  for (const t of tools) {
    const btn = h("button", { className: "mlw-tool", type: "button", onClick: () => session.start(t.id) }, h("span", { className: "mlw-glyph" }, t.glyph), t.label);
    toolBtns.set(t.id, btn);
    toolGrid.append(btn);
  }
  const allBtn = W.button("Bases at every start location", { primary: true, title: "One mineral line and geyser per start location the map already has", onClick: () => session.basesAtStarts() });
  root.append(toolGrid, allBtn);

  /* Base */
  const presetSel = W.select(PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: s.preset, onChange: (v) => {
    s.preset = v as Preset;
    const p = PRESETS.find((x) => x.id === s.preset)!;
    if (p.id !== "custom") { s.minerals = p.minerals; s.geysers = p.geysers; }
    session.save();
    mineralsIn.value = String(s.minerals);
    geysersIn.value = String(s.geysers);
    session.tool?.redraw();
  } });
  const custom = () => { s.preset = "custom"; presetSel.value = "custom"; session.save(); };
  const mineralsIn = num("minerals", 0, 24, custom);
  const geysersIn = num("geysers", 0, 2, custom);
  const sideSel = W.select([{ value: "auto", label: "Nearer end" }, { value: "left", label: "Left end" }, { value: "right", label: "Right end" }], { value: s.geyserSide, onChange: (v) => { s.geyserSide = v as GeyserSide; session.save(); session.tool?.redraw(); } });
  root.append(section("Base", true,
    row("Preset", presetSel),
    row("Patches", mineralsIn, unit("mineral fields")),
    row("Geysers", geysersIn, sideSel),
    row("Gap", num("gap", 1, 8), unit("tiles to the hall (3 mines fastest)")),
    row("Geyser gap", num("geyserGap", 1, 8), unit("tiles to the hall")),
    row("Spacing", num("geyserSpacing", 0, 4), unit("tiles between geyser and patches")),
    W.checkbox("Place for every player (the symmetry's images)", { value: s.mirror, onChange: (v) => { s.mirror = v; session.save(); session.tool?.redraw(); } }),
    W.checkbox("Snap the direction to 45° (Shift does too)", { value: s.snap45, onChange: (v) => { s.snap45 = v; session.save(); } }),
    W.checkbox("Skip spots the ground or another unit refuses", { value: s.skipRefused, onChange: (v) => { s.skipRefused = v; session.save(); } }),
  ));

  /* Resources */
  const endIn = W.number({ value: s.endPatches ?? 0, min: 0, max: 50000, step: 1, onChange: (v) => { s.endPatches = endTick.input.checked ? Math.max(0, Math.round(v)) : null; session.save(); } });
  const endTick = W.checkbox("End patches", { value: s.endPatches !== null, onChange: (v) => { s.endPatches = v ? Math.max(0, Math.round(Number(endIn.value) || 750)) : null; endIn.disabled = !v; if (v) endIn.value = String(s.endPatches); session.save(); } });
  endIn.disabled = s.endPatches === null;
  const lookSel = W.select([{ value: "mixed", label: "Mixed (types 1, 2, 3 in turn)" }, { value: 0, label: "Type 1" }, { value: 1, label: "Type 2" }, { value: 2, label: "Type 3" }], { value: s.look, onChange: (v) => { s.look = v === "mixed" ? "mixed" : (Number(v) as 0 | 1 | 2); session.save(); } });
  root.append(section("Resources", false,
    row("Minerals", num("mineralValue", 0, 50000), unit("per patch")),
    row("Gas", num("gasValue", 0, 50000), unit("per geyser")),
    h("div", { className: "mlw-row" }, endTick, h("div", { className: "mlw-in" }, endIn, unit("for the outermost patch at each end"))),
    row("Look", lookSel),
  ));

  /* Extras */
  const blockBtn = h("button", { className: "mlw-tool", type: "button", onClick: () => session.start("block") }, h("span", { className: "mlw-glyph" }, "▬"), "Blocking patch (click)");
  toolBtns.set("block", blockBtn);
  const startsTick = W.checkbox("Placing start locations replaces the players' old ones", { value: s.replaceStarts, onChange: (v) => { s.replaceStarts = v; session.save(); } });
  const gapList = h("div", { className: "mlw-list" });
  const summaryBox = h("div", { className: "mlw-status" });
  root.append(section("More", false,
    h("div", { className: "mlw-btns" },
      W.button("Mirror selected units", { title: "Add the symmetry's images of the selected units, for the matching players", onClick: () => session.mirrorSelection() }),
      W.button("Check symmetry", { title: "Select every unit that has no counterpart under the symmetry", onClick: () => { session.checkSymmetry(); render(); } }),
      W.button("Resource summary", { onClick: () => { summaryBox.innerHTML = session.summary(); } }),
    ),
    gapList,
    summaryBox,
    h("div", { className: "mlw-tools" }, blockBtn),
    row("Amount", num("blockValue", 0, 50000), unit("minerals in a blocking patch")),
    startsTick,
  ));

  const status = h("div", { className: "mlw-status mlw-main" });
  root.append(status);
  root.append(h("div", { className: "mlw-keys" },
    h("b", null, "Start locations"), ": click where Player 1 starts and the rest follow the symmetry. ",
    h("b", null, "Add base"), ": press on the hall spot, drag towards the minerals (a click points them away from the map's centre); red boxes are spots the map refuses. ",
    h("kbd", null, "Esc"), " or a right-click drops a drag, then leaves the tool.",
  ));

  function render() {
    const sz = session.size();
    const info = symmetryInfo(s.symmetry);
    const usable = sz ? symmetryAvailable(s.symmetry, sz.width, sz.height) : true;
    symNote.textContent = usable
      ? `${info.players} player${info.players === 1 ? "" : "s"}. Player 1 is what you place; the others are its images.`
      : `${info.label} needs a square map; this one is ${sz!.width} × ${sz!.height}, so it acts as none.`;
    for (const [id, btn] of toolBtns) btn.classList.toggle("on", session.active && session.toolId === id);
    status.innerHTML = session.status || (api.document.isOpen() ? "Ready." : "Open a map first.");
    gapList.replaceChildren();
    if (session.gaps.length) {
      const scn = api.document.scenario();
      const seen = new Set<number>();
      for (const g of session.gaps) {
        if (seen.has(g.index) || !scn) continue;
        seen.add(g.index);
        const u = scn.units[g.index];
        gapList.append(h("div", { className: "mlw-item", title: "Click to go there", onClick: () => api.view.goTo({ kind: "unit", index: g.index }) },
          h("span", { className: "mlw-grow" }, `${api.palette.unitName(u.unitId)} at ${Math.floor(u.x / TILE)}, ${Math.floor(u.y / TILE)}`),
          h("span", { className: "mlw-dim" }, `${api.names.player(u.owner)} · no image ${g.image + 1}`),
        ));
      }
    }
  }

  session.refresh.push(render);
  render();
  return () => { session.refresh = session.refresh.filter((r) => r !== render); };
}

/* ── activate ───────────────────────────────────────────── */

export default function activate(api: PluginApi) {
  const session = new Session(api);

  const openPanel = () => {
    if (session.panel?.isOpen()) return;
    session.panel = api.ui.panel({
      title: "Melee Wizard",
      width: 320,
      mount: (body) => mountPanel(session, body),
      onClose: () => { session.panel = null; session.stop(); },
    });
  };

  api.commands.register({ id: "open", title: "Melee Wizard…", enabled: () => api.document.isOpen(), run: openPanel });
  api.commands.register({ id: "starts", title: "Place symmetric start locations", enabled: () => api.document.isOpen(), run: () => { openPanel(); session.start("starts"); } });
  api.commands.register({ id: "base", title: "Add a base", enabled: () => api.document.isOpen(), run: () => { openPanel(); session.start("base"); } });
  api.commands.register({ id: "bases-at-starts", title: "Bases at every start location", enabled: () => api.document.isOpen(), run: () => { openPanel(); session.basesAtStarts(); } });
  api.commands.register({ id: "mirror-selection", title: "Mirror selected units", enabled: () => api.document.isOpen(), run: () => session.mirrorSelection() });
  api.commands.register({ id: "check-symmetry", title: "Check symmetry", enabled: () => api.document.isOpen(), run: () => { openPanel(); session.checkSymmetry(); } });

  api.menu.add("Tools", { label: "Melee Wizard…", enabled: () => api.document.isOpen(), command: "open" });
  api.menu.add("Tools", { label: "Bases at Every Start Location", enabled: () => api.document.isOpen(), command: "bases-at-starts" });
  api.contextMenu.add("viewport", { label: "Melee Wizard…", command: "open" });
  api.contextMenu.add("viewport", { label: "Add Base Here…", command: "base" });
  api.hotkeys.add("Ctrl+Shift+M", { command: "open" });

  api.events.on("document", () => { session.gaps = []; session.status = ""; session.notify(); });
  api.events.on("units", () => session.notify());
  api.events.on("selection", () => session.notify());
}
