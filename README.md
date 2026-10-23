# Kyoshin Monitor-style Earthquake Simulation (English edition)

An English translation of [walbcglgh/jp_eew_simulator](https://github.com/walbcglgh/jp_eew_simulator), a Japan earthquake and Earthquake Early Warning (EEW) simulator that runs in the browser. It was built with TurboWarp (Scratch) and looks like the NIED Kyoshin Monitor and JMA's EEW displays. You can change the epicenter, magnitude, depth and start time, then watch P and S waves spread, the seismic intensity map, EEW alerts and tsunami warnings.

> The simulation is simplified and does not match real earthquakes. Do not use it for disaster-prevention decisions.

---

## Controls

| Input | Action |
| --- | --- |
| ← / → | Magnitude (M1 to M12) |
| ↑ / ↓ | Focal depth (0 to 1000 km) |
| Q / W | Start time (0 to 300 s) |
| A | Align the start of the earthquake event with the arrival of the main shock |
| Space / Start button | Start or pause the simulation |
| Mouse wheel | Zoom the map |
| R | Reset the camera |

### Settings panel shortcuts

| Key | Action |
| --- | --- |
| Enter | Restart (trigger the earthquake) |
| C | Open or close the settings panel |
| 1 / 2 / 3 | Earthquake info / EEW / Tsunami tabs |
| ? | Show the help screen |
| Esc | Close the help screen |

- The help screen opens automatically on first launch. The "?" button in the settings panel opens it again.
- **Export** in the settings panel saves magnitude, depth and timing to JSON, and **Import** restores them.
- **Preset** applies the magnitude and depth of a well-known earthquake: 2011 Tohoku, 2016 Kumamoto, 2018 Hokkaido Iburi-East, 2024 Noto Peninsula and 1995 Great Hanshin.
- **Share** copies a link that includes your settings. If you picked an epicenter, the latitude and longitude are included too. A link like `?m=7.0&d=10&t=0&lat=38.1&lon=142.9` applies them directly.
- The **Volume** slider and **Mute** button control sound effects and speech. The browser remembers the setting.
- The language selector (English / 日本語 / 繁體中文) switches the settings panel and the help screen. English is the default in this edition.

### Touch controls (phones and tablets)

- Drag the sliders at the bottom left to adjust magnitude, depth and start time.
- **Settings** at the bottom left opens the settings panel, and **×** at the top right closes it.
- Buttons start (restart), pause or resume, and stop the simulation.
- Drag on the map to zoom.

## Screen layout

- The screen shows the map and observation stations, an information panel, and the EEW panel at the top left.
- The settings panel at the bottom left sets magnitude, depth and timing.
  - It hides when the simulation starts.
  - Press **Settings** at the bottom left to bring it back, and **×** at the top right to close it.
  - The top of the panel shows the epicenter and the elapsed seconds.
- While an EEW is active, the estimated epicenter name appears in the EEW panel at the top left.
- Stopping the simulation brings the settings panel back.

## Features

- Real-time adjustment of magnitude, depth and start time (M1 to M12, 0 to 1000 km, 0 to 300 s)
- P-wave and S-wave propagation and arrival times
- Estimated seismic intensity at each observation station and an intensity map
- EEW estimated hypocenter and predicted maximum intensity
- Tsunami warning and advisory simulation
- Spoken announcements and sound effects

## What was translated

- **Interface:** the launch screen, settings panel, help screen and toast messages are in English. English is the default language.
- **On-screen labels in the simulation:** the baked-in Japanese labels of the Scratch project were redrawn as English text. That covers the EEW status panels, the "Est. Int." intensity boxes, the Start, Set epicenter and Advance time buttons, and the option toggles.
- **Place names:** all roughly 330 JMA epicenter region names, the prefecture and warning-area names, and the 66 tsunami forecast regions are in English.
- **Speech:** the announcements now use English wording and the English text-to-speech voice. Intensity 5 and 6 are read as "5 lower / 5 upper" and "6 lower / 6 upper", which correspond to JMA's 5弱/5強 and 6弱/6強.
- **Abbreviations:** "Est. Int." on the map means estimated intensity, and "LPGM" means long-period ground motion class.

### What was left as it is

- Internal names such as sprite, variable, list and sound names are still Japanese. The Scratch logic uses them as identifiers, so renaming them would break the project.
- The second stage backdrop is a screenshot with Japanese text. It is covered by the map while the simulation runs.
- The `ja` and `zh` entries of the language selector are unchanged.
- English place names are my own concise renderings, not JMA's official English names.

## Deploying

### Cloudflare Pages

1. Fork or clone this repository.
2. In Cloudflare Pages choose "Create a project", then "Connect to Git", and select this repository.
3. Build settings:
   - Build command: none
   - Build output directory: `/`
   - Environment variables: none
4. Press "Save and Deploy".

### Running locally

Opening `index.html` directly blocks `fetch`, so the project data (`quake-sim-data.bin`) cannot load. Serve it over HTTP instead:

```
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser. Speech needs an internet connection, because it uses Scratch's speech service.

## Files

| File | Contents |
| --- | --- |
| `index.html` | Launch screen, loader and control panel (the HTML side of the UI) |
| `quake-sim-data.bin` | The project loaded at run time (a zip with `project.json` and the assets) |
| `project.json` | A standalone copy of the project (the runtime uses `quake-sim-data.bin`) |
| `fonts/` | Zen Maru Gothic subset fonts (400 / 500 / 700) and `OFL.txt` |
| `LICENSE` | Mozilla Public License 2.0, which applies to this project's modifications |

## Notes

- The earthquake and tsunami calculations are simplified and differ from real phenomena.
- The project includes sound. Check your volume first.
- Some features may be limited depending on your browser settings.

## License

- Modifications in this project (`index.html`, `quake-sim-data.bin`, `project.json`, `fonts/`): Mozilla Public License 2.0 (full text in `LICENSE`)
- TurboWarp Packager: Mozilla Public License 2.0
- Scratch: MIT License
- Zen Maru Gothic (font): SIL Open Font License 1.1 (subset in `fonts/`, full text in `fonts/OFL.txt`)
- Fonts are hosted locally with no external CDN, so the page looks the same offline.

## References

- TurboWarp: https://turbowarp.org
- Original project: https://turbowarp.org/1220818872
- Scratch: https://scratch.mit.edu
- Cloudflare Pages: https://developers.cloudflare.com/pages/

## Credits

- Original project author: TurboWarp / Scratch community
- UI adjustments and modifications: walbcglgh (upstream repository)
- English translation: this fork
- Font: Zen Maru Gothic (Yoshimichi Ohira)
