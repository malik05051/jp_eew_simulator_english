# Quake Simulator (desktop)

A desktop rewrite of the simulator: a dark, Kyoshin-monitor-style viewer with a real map, packaged as a Linux AppImage. The simulation runs in plain JavaScript; Scratch is no longer involved.

## Run it

Download or build `QuakeSimulator-<version>-x86_64.AppImage`, then:

```
chmod +x QuakeSimulator-*.AppImage
./QuakeSimulator-*.AppImage
```

AppImages need FUSE. If yours doesn't have it, run the file with `--appimage-extract-and-run`.

## Views

Like the original app, the map has three views, switched with the buttons at the top left or the keys 1, 2 and 3. It also switches automatically when alerts arrive (you can turn that off in Settings):

- **Earthquake information:** reported intensities, coloured by area with an intensity square on each station.
- **Real-time:** Earthquake Early Warnings with forecast colours, live station shaking, and the P and S waves.
- **Tsunami:** tsunami bulletins with coloured coastlines, heights and expected arrival times.

## Using it

- **New quake:** click the map to place the epicenter, or pick a preset (2011 Tohoku, 2024 Noto, 2016 Kumamoto, 1995 Hanshin, 2018 Iburi, a Nankai Trough scenario and others). Set magnitude and depth, then press **Start simulation**.
- **Playback:** play or pause with Space, change speed (1×, 2×, 5×, 10×), drag the timeline to scrub, and use ← / → to jump 5 seconds. **N** opens a new quake.
- **History:** the sidebar keeps your simulated quakes. Click one to see its final intensity map, or replay it.
- **Layers** (right toolbar): stations with live shaking, P and S wave fronts, intensity by area, and tsunami coasts.
- **Settings:** volume, spoken announcements (English, off by default), automatic view switching, power saver and **alert sounds**.
- **Sounds:** the built-in alert sounds are the ones bundled with the original Scratch project, played for the same events (first EEW, intensity 3 or more, warning, update, final report, intensity flash, hypocenter and earthquake information, each tsunami level, and a tone at each new level of detected shaking). You can replace any of them with your own audio file; files are stored locally.
- **Power use:** the app draws nothing while paused or idle and nothing while the window is hidden. During playback the map updates 10 times a second, or 4 in power-saver mode, and only data that changed is sent to the GPU.

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
- Alert sounds (`src/sounds/`): taken unchanged from the original Scratch project's assets. Their licensing follows that project. Some may imitate broadcast alert chimes, so check before redistributing builds publicly.
