# Quake Simulator (desktop)

A desktop rewrite of the simulator: a dark, Kyoshin-monitor-style viewer with a real map, packaged as a Linux AppImage. The simulation runs in plain JavaScript; Scratch is no longer involved.

## Run it

Download or build `QuakeSimulator-<version>-x86_64.AppImage`, then:

```
chmod +x QuakeSimulator-*.AppImage
./QuakeSimulator-*.AppImage
```

AppImages need FUSE. If yours doesn't have it, run the file with `--appimage-extract-and-run`.

## Using it

- **New quake:** click the map to place the epicenter, or pick a preset (2011 Tohoku, 2024 Noto, 2016 Kumamoto, 1995 Hanshin, 2018 Iburi, a Nankai Trough scenario and others). Set magnitude and depth, then press **Start simulation**.
- **Playback:** play or pause with Space, change speed (1×, 2×, 5×, 10×), drag the timeline to scrub, and use ← / → to jump 5 seconds. **N** opens a new quake.
- **History:** the sidebar keeps your simulated quakes. Click one to see its final intensity map, or replay it.
- **Layers** (right toolbar): stations with live shaking, P and S wave fronts, intensity by area, and tsunami coasts.
- **Settings:** volume, spoken announcements (English), and **custom alert sounds**. You can choose your own audio file for each alert type; files are stored locally.

## What it simulates

- P and S wave fronts (6.2 and 3.6 km/s) from the hypocenter.
- Shaking at about 1,750 land stations (K-NET/KiK-net sites with their site amplification) and 150 S-net seafloor stations. Peak ground velocity follows Si & Midorikawa (1999), intensity follows Fujimoto & Midorikawa (2005), and each station gets random scatter.
- Earthquake Early Warning reports: the first report soon after the P wave reaches the first stations, then numbered updates. The magnitude estimate grows (and saturates near M8.1 for great quakes), the epicenter estimate converges, intensities are forecast per area, and warning areas are added once a forecast reaches 5 lower.
- JMA-style reports: Seismic Intensity Flash, Hypocenter Information, Earthquake Information and long-period ground motion.
- Tsunami bulletins for shallow offshore or coastal quakes of M6.5 and above: major warning, warning, advisory or forecast for each of JMA's 66 coastal areas.

This is a simplified model for education and entertainment. It is not a forecast tool and must not be used for disaster-prevention decisions.

## Develop

```
npm install
npm start        # run in Electron
npm test         # engine tests
npm run dist     # build the AppImage into dist/
```

`tools/prepare_data.py` rebuilds `src/data/` from the Scratch project in this repository and from JMA GIS data simplified with mapshaper.

## Data and credits

- Area boundaries: Japan Meteorological Agency GIS data (seismic intensity subregions, prefectures, tsunami forecast areas), simplified.
- Land outside Japan: Natural Earth (public domain).
- Stations, epicenter-region polygons and site factors come from the original Scratch project ([walbcglgh/jp_eew_simulator](https://github.com/walbcglgh/jp_eew_simulator), MPL-2.0).
- Map rendering: MapLibre GL JS (BSD-3-Clause).
