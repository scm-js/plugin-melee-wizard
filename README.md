# Melee Wizard

A plugin for [scmJS](https://github.com/scm-js/scm-js), the browser-based StarCraft 1 /
Brood War map editor. It places the measured parts of a ladder-style map: start locations
under a symmetry, and mineral lines with their geysers. Each placement is one undo step.

## Install

In scmJS, open Plugins ▸ **Browse Plugins…** and press **Install** on the Melee Wizard
row. You can also open Plugins ▸ **Manage Plugins…**, paste

```
https://github.com/scm-js/plugin-melee-wizard
```

and press **Add**. To pin a version, add a tag: `github:scm-js/plugin-melee-wizard@v1.1.0`.

## What it does

- Places start locations for 2, 4 or 8 players. You click where Player 1 starts, and the
  others are placed under the symmetry you chose.
- Lays out a base's resources. You drag from the town hall spot towards the minerals. The
  mineral line goes three tiles from the hall, which is the closest the game allows and
  the fastest to mine. The geyser goes just past the end of the line. Every player gets
  the same base.
- Adds a base at every start location the map already has, in one go.
- Places blocking mineral patches (8 minerals by default).
- Mirrors the selected units to the matching players.
- Checks the symmetry, and selects every unit that has no counterpart.
- Shows a resource summary per player.

## Use

Open the panel with Tools ▸ **Melee Wizard…**, Ctrl+Shift+M, or **Melee Wizard…** in the
map's right-click menu. The panel floats over the map and does not block it.

1. Under **Symmetry**, choose the layout. There are mirrors, rotations by 180° and 90°,
   and diagonal mirrors, for 2, 4 or 8 players. The rotations by 90° and the diagonals
   need a square map. The axes are drawn on the map while a tool runs.
2. Press **Start locations**, then click where Player 1 starts. The hall footprints are
   shown under the pointer before you click. By default this replaces the players' old
   start locations.
3. Press **Add base (drag)**, then press on the hall spot and drag towards the minerals. Pressing
   inside an existing start location snaps to it. The line follows the drag. A plain click
   points the minerals away from the map's centre. Shift snaps the direction to 45°. Spots
   the ground or another unit would refuse show in red and are left out. Let go to place
   the base for every player, unless you untick **Place for every player**.
4. **Bases at every start location** does step 3 for each start location on the map. If
   the start locations follow the chosen symmetry, the bases are exact images of each
   other. Otherwise each is laid out on its own. It is also in the Tools menu.

**Add Base Here…** in the map's right-click menu starts step 3 directly.

The panel has three more sections:

- **Base** sets the counts: a preset (main 8 + 1, natural 7 + 1, third 6 + 1) or your own,
  with up to two geysers. It also sets which end of the line the geyser takes, the gap to
  the hall, the geyser's gap, and how many tiles the geyser keeps from the patches. A gap
  of 3 is the game's minimum and mines fastest. More is allowed, but mining is slower.
- **Resources** sets the amounts (1500 minerals and 5000 gas by default) and an optional
  different amount for the outermost patch at each end. It also sets whether the three
  mineral field types are mixed or one type is used throughout.
- **More** has the blocking patch tool, **Mirror selected units**, **Check symmetry** and
  the resource summary.

## How the line is laid out

The game will not place a town hall within three tiles of a mineral field or geyser. So
the spots a patch can take form a rectangular ring around the hall. The line starts at the
ring spot nearest the direction you point and grows to both sides, staying centred. If you
point at a corner, the line wraps around it, as on Blizzard's own maps. The geyser takes
the nearest clear spot past the end of the line.

Under a mirror or a 180° rotation, every image lands exactly on the tile grid. Under a 90°
rotation, a mineral patch's image is half a tile off the grid and the editor snaps it. Those
bases are half a tile from perfect, as on real four-player rotational maps.

## Files

| File | What it is |
| --- | --- |
| `plugin.json` | The manifest the editor reads. |
| `plugin.ts` | The panel, the three map tools and their previews, and the edits to the map. |
| `layout.ts` | The geometry: the resource ring, the mineral line and geyser, the symmetries, the symmetry check and the summary. |
| `i18n.ts`, `ko.ts` | The plugin's words in the editor's language, and the Korean. |
| `dist/plugin.js` | The bundle the editor loads. `npm run build` writes it and CI commits it. |
| `tests/` | Tests of `layout.ts`, and a check that `ko.ts` is complete. |

## Development

```sh
npm install
npm run typecheck
npm test
npm run dev
```

`npm run dev` rebuilds `dist/plugin.js` on every change. To try your changes in the editor,
serve this folder with `npx serve --cors .`, add `http://localhost:3000/` in Plugins ▸
**Manage Plugins…**, and press **Reload** on the plugin's row after each edit.

The types come from [`@scm-js/plugin-api`](https://github.com/scm-js/plugin-api). The
[plugin guide](https://docs.scmjs.dev/plugins/writing-a-plugin/) covers the API. This
plugin is the worked example for placing units with `placeUnit`, `canPlaceUnit` and
`updateUnits` inside one `document.edit`, and for a map tool that previews its drag with
`draw`.

A plugin runs with the editor's own privileges. There is no sandbox.

## Licence

MIT. See [LICENSE](LICENSE).
