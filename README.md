# FLEET.IO V2 — Captain's Legacy

A top-down retro pixel-art naval adventure built with **Phaser 4**, **TypeScript** and **Vite**.

## Scripts

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm install`       | Install dependencies                           |
| `npm run dev`       | Dev server at http://localhost:8080 (hot reload) |
| `npm run typecheck` | TypeScript check only                          |
| `npm run build`     | Typecheck + production build into `dist/`      |
| `npm run preview`   | Serve the production build at http://localhost:8081 |

## Structure

```
src/
  main.ts                  entry: boots the game into #game-container
  game/
    createGame.ts          creates the Phaser.Game
    config/
      constants.ts         title, 640x360 (16:9) resolution, PIXEL_SCALE, scene keys
      gameConfig.ts        Phaser config (pixelArt, Scale.FIT, scene list)
      palette.ts           master colour palette
    gfx/
      pixelCanvas.ts       pixel-plotting helpers, ASCII-art sprites, seeded RNG
      pixelFont.ts         original 5x7 pixel font baked into bitmap fonts
      textures.ts          procedural placeholder art (ocean, sloop, island, palm, dock, UI)
      OceanBackdrop.ts     animated tiled ocean with waves & sparkles
      ShipSprite.ts        bobbing ship visual with foam wake
    scenes/
      BootScene.ts         bakes fonts + textures, then starts the menu
      MenuScene.ts         start screen (title + PLAY)
      OceanScene.ts        ocean gameplay placeholder (Milestone 1)
    ui/
      PixelButton.ts       wooden plank button
```

All art is generated in code at boot — the project ships no third-party art.
To swap in hand-made sprites later, load them in `BootScene.preload()` using the same `TextureKeys`.
