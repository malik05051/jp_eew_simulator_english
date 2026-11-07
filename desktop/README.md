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

- **New quake:** click the map to place the epicenter, or pick a preset (2011 Tohoku, 2024 Noto, 2016 Kumamoto, 1995 Hanshin, 2018 Iburi, a Nankai Trough scenario and others). Set magnitude (3 to 50) and depth (0 to 1,000 km) with the sliders or type exact values, then press **Start simulation**. Above M9.6, larger than any recorded quake, results are fictional.
- **Playback:** play or pause with Space, change speed (1×, 2×, 5×, 10×), drag the timeline to scrub, and use ← / → to jump 5 seconds. **N** opens a new quake.
- **History:** the sidebar keeps your simulated quakes. Click one to see its final intensity map, or replay it.
- **Layers** (right toolbar): stations with live shaking, P and S wave fronts, intensity by area, and tsunami coasts.
- **Settings:** volume, spoken announcements (English, off by default), automatic view switching, power saver and **alert sounds**.
- **Sounds:** the built-in alert sounds are the ones bundled with the original Scratch project, played for the same events (first EEW, intensity 3 or more, warning, update, final report, intensity flash, hypocenter and earthquake information, each tsunami level, and a tone at each new level of detected shaking). You can replace any of them with your own audio file; files are stored locally.
- **Power use:** the app draws nothing while paused or idle and nothing while the window is hidden. During playback the map updates 10 times a second, or 4 in power-saver mode, and only data that changed is sent to the GPU.

## What it simulates

- P and S wave fronts (6.2 and 3.6 km/s) from the hypocenter.
- Shaking at about 1,750 land stations (K-NET/KiK-net sites with their site amplification) and 150 S-net seafloor stations (see *Intensity model* below).
- Earthquake Early Warning reports: the first report soon after the P wave reaches the first stations, then numbered updates. The magnitude estimate grows (and saturates near M8.1 for great quakes), the epicenter estimate converges, intensities are forecast per area, and warning areas are added once a forecast reaches 5 lower.
- JMA-style reports: Seismic Intensity Flash, Hypocenter Information, Earthquake Information and long-period ground motion.
- Tsunami bulletins from a physical tsunami model (see below): major warning, warning, advisory or forecast for each of JMA's 66 coastal areas, with estimated heights in metres, arrival times and simulated tide-gauge observations.

This is a simplified model for education and entertainment. It is not a forecast tool and must not be used for disaster-prevention decisions.

## Intensity model

1. **Fault.** The rupture is a rectangle sized from the moment magnitude (Blaser et al. 2010), oriented along the trench or the depth contours (presets use the real fault orientation), dipping 15° for plate-boundary quakes, 45° in the slab and 60° in the crust. Crustal quakes break upward from the hypocentre.
2. **Ground motion.** Peak ground velocity on bedrock follows Si & Midorikawa (1999) using the shortest distance to that fault, so a great quake shakes a whole coast instead of a circle. It is converted to Vs 400 m/s (×1.31) and multiplied by each station's site amplification, with random scatter (σ = 0.15 in log units).
3. **Paths.** Waves crossing the hot mantle wedge to the Sea of Japan side fade faster. For deep quakes, waves running up the cold slab barely fade, which gives the *abnormal intensity distribution* (異常震域): a 680 km deep quake under the Bonin Islands is felt at 4 in Kanto and hardly at all right above it.
4. **Intensity.** JMA instrumental intensity from PGV follows Fujimoto & Midorikawa (2005).

Checked against real quakes (highest intensity, model vs observed): Kumamoto 2016, Hanshin 1995 and Noto 2024 give 7 (observed 7); Tohoku 2011 gives 6+ over Miyagi, Fukushima and Ibaraki (observed 7 at one site, 6+ widely); Fukushima-oki 2021 gives 6- (6+); the 2015 Bonin deep quake gives 4 across Kanto (4, with 5- in one spot). Moderate quakes on very soft ground (Iburi 2018, observed 7) come out about one class low.

## Tsunami model

Tsunami heights are calculated, not looked up.

1. **Source.** Fault length, width and slip come from the magnitude (Blaser et al. 2010 scaling for reverse faults). The fault is oriented along the local depth contours of the seafloor, i.e. along the trench. Seafloor uplift is about 45 % of the slip, less for deep and non-thrust quakes, and only the part of the rupture under the sea counts. Slip tapers toward the ends of the fault.
2. **Travel times.** The wave travels over an ocean-depth grid (about 0.1°, built from Natural Earth bathymetry) at the shallow-water speed √(g·depth). It cannot cross land, so it goes around Japan or through straits, and the Sea of Japan and the Pacific coasts get very different arrival times.
3. **Heights.** The open-sea height decreases with distance (more off the ends of the fault than broadside). Waves that had to bend around land lose energy, and so do waves squeezed through a narrow strait into a larger basin. Green's law then gives the height at the coast. Heights are shown in metres per coastal area and correspond to tide-gauge level, not run-up, which can be several times higher.
4. **Observations.** Tide-gauge records are simulated for each area: first wave at the arrival time, then a measured maximum 10–25 minutes later, varying around the estimate.

Checked against real events (estimated coast height, model vs. observed):

| Event | Model | Observed |
| --- | --- | --- |
| 2011 Tohoku, Mw 9.0 | Miyagi 18 m, Iwate 16 m, Ibaraki 7.7 m, Tokyo Bay 0.9 m, Hokkaido 3.0 m | about 9–15 m+, 4–7 m, 1.5 m, 3 m |
| 2024 Noto, Mw 7.5 | Noto 2.3 m, Toyama 0.5 m, Niigata 1.2 m | over 1.2 m (gauge saturated), about 0.8 m, about 0.4 m |
| 2003 Tokachi-oki, Mw 8.0 | Hokkaido central Pacific 3.8 m | 2–4 m |
| 2016 off Fukushima, Mw 6.9 | Fukushima 0.6 m | about 0.9 m (1.4 m in Sendai port) |

It's a fast estimate (about 0.1 s per quake), not a full tsunami solver: harbour and bay resonance, detailed coastal shapes and run-up aren't modelled, and smaller quakes tend to come out somewhat low.

## Develop

```
npm install
npm start        # run in Electron
npm test         # engine tests
npm run dist     # build the AppImage into dist/
```

`tools/prepare_data.py` rebuilds `src/data/` from the Scratch project in this repository and from JMA GIS data simplified with mapshaper.

## Data and credits

- Ocean depths: Natural Earth 10m bathymetry (public domain), rasterised by `tools/build_depth_grid.py`.
- Area boundaries: Japan Meteorological Agency GIS data (seismic intensity subregions, prefectures, tsunami forecast areas), simplified.
- Land outside Japan: Natural Earth (public domain).
- Stations, epicenter-region polygons and site factors come from the original Scratch project ([walbcglgh/jp_eew_simulator](https://github.com/walbcglgh/jp_eew_simulator), MPL-2.0).
- Map rendering: MapLibre GL JS (BSD-3-Clause).
- Alert sounds (`src/sounds/`): taken unchanged from the original Scratch project's assets. Their licensing follows that project. Some may imitate broadcast alert chimes, so check before redistributing builds publicly.
