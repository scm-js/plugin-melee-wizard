# Melee Wizard

A plugin for [scmJS](https://github.com/jeany55/scm-js), the browser-based StarCraft 1 /
Brood War map editor. It places the parts of a ladder-style map that are geometry
rather than art, one action each:

- **Start locations** for 2, 4 or 8 players. Click where Player 1 starts; the others
  land on its images under the symmetry you chose (mirror, rotation, both diagonals).
- **A base's resources.** Press on the town hall spot, drag towards where the minerals
  should go, and let go: the mineral line is laid out on the ring exactly three tiles
  from the hall — the closest the game allows and the distance it mines fastest from —
  wrapping round the hall's corner when you point at one, with the geyser just past
  the end of the line, and the same base for every player. Spots the ground or
  another unit would refuse show in red while you drag and are left out.
- **Bases at every start location** the map already has, minerals against the back
  of each base, in one go.

And around those: a blocking-patch tool (a mineral field of 8, or whatever you set),
*Mirror selected units* (the images of whatever you have selected, for the matching
players), *Check symmetry* (selects every unit that has no counterpart) and a
per-player resource summary. Every placement is one undo step.

## Install

In scmJS: **Plugins ▸ Manage Plugins…**, paste

```
https://github.com/scm-js/plugin-melee-wizard
```

and press **Add**. It is normally already in that list, marked *default* and switched off:
tick it to turn it on. To pin a version, add a ref: `github:scm-js/plugin-melee-wizard@v1.0.0`.

## Use

**Tools ▸ Melee Wizard…** (also `Ctrl+Shift+M`, or *Melee Wizard…* on the map's
right-click menu) opens the panel. It floats over the map and does not block it.

1. **Symmetry.** Pick the layout: mirror left ↔ right, top ↔ bottom, rotate 180° (two
   players); rotate 90°, mirror both ways (four); mirror both ways and both diagonals
   (eight). The rotations and diagonals need a square map. Player 1 is what you place;
   the other players are its images. The axes are drawn on the map while a tool runs.
2. **Start locations.** Press the tool, then click the map where Player 1 starts. The
   hall footprint and its images are shown under the pointer, each with its player.
3. **Add base.** Press the tool, then press on the hall spot — inside an existing start
   location's footprint snaps to it — and drag towards the minerals. The line follows
   the drag; a plain click points it away from the map's centre, which is where a
   main's minerals usually go; Shift (or the option) snaps the direction to 45°. Let
   go to place it, mirrored to every player unless you untick *Place for every player*.
4. **Bases at every start location** does step 3 for each start location on the map at
   once. When the start locations follow the chosen symmetry, the first base is laid
   out and mirrored, so the bases are exact images of each other; otherwise each is
   laid out on its own.

The **Base** section sets what a base is: a preset (main 8 + 1, natural 7 + 1, third
6 + 1) or your own counts, up to two geysers, which end of the line the geyser takes,
the gap to the hall (3 is the game's minimum and the fastest mining; more is allowed,
slower), the geyser's own gap and how many tiles it keeps from the patches.
**Resources** sets the amounts (1500 and 5000 by default), an optional different
amount for the outermost patch at each end, and whether the three mineral field types
are mixed for looks or one is used throughout. **More** holds the blocking patch tool,
the mirror and symmetry checks, and the summary.

## Layout

| | |
| --- | --- |
| `plugin.json` | the manifest the editor reads (name, version, `entry`, `icon`, the API version it needs) |
| `plugin.ts` | `activate(api)`: the panel, the three map tools with their previews, the transactions |
| `layout.ts` | the pure geometry: the resource ring, the mineral line and geyser, the symmetries and their images, the symmetry check, the base summary |
| `dist/plugin.js` | the bundle the editor loads; `npm run build` writes it, CI commits it |
| `tests/` | vitest over `layout.ts` |

Types come from [`@scm-js/plugin-api`](https://github.com/scm-js/plugin-api), a devDependency
generated from the editor's own `src/plugins/api.ts`; `npm update @scm-js/plugin-api` takes the
newest contract.

## How the line is laid out

The game refuses a resource depot within three tiles of a mineral field or geyser,
measuring the gap as the larger of the empty columns and the empty rows between the two
footprints, and workers mine fastest when the gap is exactly that. So the positions a
patch can take are a rectangular ring round the 4 × 3 hall footprint. The line starts at
the ring position nearest the direction you point and grows to either side along the
ring, always taking the side that keeps the line centred on the direction; along the
hall's top and bottom the positions step by a patch width, along its sides by a row, so
pointing at a corner wraps the line round it, as the lines on Blizzard's own maps do.
The geyser is a 4 × 2 box on its own ring, the nearest clear position past the end of
the line on the chosen side, keeping the set spacing from every patch.

Under a mirror or a rotation by 180° every image lands exactly on the tile grid. Under
a rotation by 90° a 2 × 1 patch's image is half a tile off the grid; the editor snaps
it, so those bases are a half-tile from perfect, as on real four-player rotational maps.

## Development

```sh
npm install
npm run typecheck
npm test
```

`dist/plugin.js` is what the editor loads (`build` in the manifest): `npm run build` writes
it with esbuild, and CI commits it on every push to `main` and checks at a tag that it is
what the source builds to. Run `npm run dev` while you work so the bundle follows your
edits. To try local changes, serve this directory with CORS enabled (`npx serve --cors .`)
and add `http://localhost:3000/` in Manage Plugins, then use **Reload** after each edit.

A plugin runs with the editor's own privileges. There is no sandbox.

See [`docs/plugins.md`](https://github.com/jeany55/scm-js/blob/main/docs/plugins.md) in the editor
for the API tour; this plugin is the worked example for `placeUnit` / `canPlaceUnit` /
`updateUnits` inside one `document.edit`, and for a map tool whose drag is previewed
with `draw`.

## Licence

MIT — see [LICENSE](LICENSE).
