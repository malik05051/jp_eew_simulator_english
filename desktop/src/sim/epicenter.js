// JMA epicenter-region lookup (the region polygons come from the original Scratch project).
import { insideLines, distanceKm } from './geo.js';

export class EpicenterLookup {
  constructor(regions) {
    this.regions = regions;
  }

  // Returns { code, name } for the region containing the point, or the nearest one.
  find(lat, lon) {
    for (const r of this.regions) {
      const [x1, y1, x2, y2] = r.bbox;
      if (lon < x1 || lon > x2 || lat < y1 || lat > y2) continue;
      if (insideLines(lon, lat, r.lines)) return { code: r.code, name: r.en };
    }
    // Outside every polygon: use the closest bbox centre (distant/overseas quakes).
    let best = null;
    let bestD = Infinity;
    for (const r of this.regions) {
      const [x1, y1, x2, y2] = r.bbox;
      const d = distanceKm(lat, lon, (y1 + y2) / 2, (x1 + x2) / 2);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (best && bestD < 600) return { code: best.code, name: best.en };
    return { code: '999', name: 'Distant quake' };
  }
}
