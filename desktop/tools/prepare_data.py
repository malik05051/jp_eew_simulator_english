#!/usr/bin/env python3
"""Build the app's data files.

Inputs:
  - ../project.json (the English Scratch project) and the original Japanese
    project from git (commit da3f97c), for stations, epicenter regions and names
  - a folder of simplified GeoJSON made with mapshaper from JMA's GIS data
    (subregions.json, prefectures.json, tsunami.json) and Natural Earth land (land.json)

Usage: python3 tools/prepare_data.py <geojson-folder>
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
REPO = os.path.dirname(APP)
OUT = os.path.join(APP, 'src', 'data')
GEO = sys.argv[1]

cur = json.load(open(os.path.join(REPO, 'project.json'), encoding='utf-8'))
orig = json.loads(subprocess.check_output(['git', '-C', REPO, 'show', 'da3f97c:project.json']))


def lst(p, name):
    for t in p['targets']:
        for _, (n, v) in t['lists'].items():
            if n == name:
                return [str(x) for x in v]
    raise KeyError(name)


# ---------------------------------------------------------------- names
codes = lst(cur, '5-震央コード')
names_en = lst(cur, '5-震央地名')
names_ja = lst(orig, '5-震央地名')
code_en = dict(zip(codes, names_en))
ja_en = dict(zip(names_ja, names_en))
full_ja, full_en = lst(orig, 'd 地名-コード全集'), lst(cur, 'd 地名-コード全集')
for i in range(1, len(full_ja), 8):
    if full_ja[i]:
        ja_en.setdefault(full_ja[i], full_en[i])

PREF_EN = ['Hokkaido', 'Aomori', 'Iwate', 'Miyagi', 'Akita', 'Yamagata', 'Fukushima', 'Ibaraki',
           'Tochigi', 'Gunma', 'Saitama', 'Chiba', 'Tokyo', 'Kanagawa', 'Niigata', 'Toyama',
           'Ishikawa', 'Fukui', 'Yamanashi', 'Nagano', 'Gifu', 'Shizuoka', 'Aichi', 'Mie', 'Shiga',
           'Kyoto', 'Osaka', 'Hyogo', 'Nara', 'Wakayama', 'Tottori', 'Shimane', 'Okayama',
           'Hiroshima', 'Yamaguchi', 'Tokushima', 'Kagawa', 'Ehime', 'Kochi', 'Fukuoka', 'Saga',
           'Nagasaki', 'Kumamoto', 'Oita', 'Miyazaki', 'Kagoshima', 'Okinawa']

TSUNAMI_EN = {
    '100': 'Hokkaido Pacific coast, east', '101': 'Hokkaido Pacific coast, central',
    '102': 'Hokkaido Pacific coast, west', '110': 'Hokkaido Sea of Japan coast, north',
    '111': 'Hokkaido Sea of Japan coast, south', '120': 'Sea of Okhotsk coast',
    '200': 'Aomori Sea of Japan coast', '201': 'Aomori Pacific coast', '202': 'Mutsu Bay',
    '210': 'Iwate', '220': 'Miyagi', '230': 'Akita', '240': 'Yamagata', '250': 'Fukushima',
    '300': 'Ibaraki', '310': 'Chiba, Kujukuri and Sotobo', '311': 'Chiba, Uchibo',
    '312': 'Tokyo Bay (inner bay)', '320': 'Izu Islands', '321': 'Ogasawara Islands',
    '330': 'Sagami Bay and Miura Peninsula', '340': 'Niigata, Joetsu, Chuetsu and Kaetsu',
    '341': 'Sado', '350': 'Toyama', '360': 'Ishikawa, Noto', '361': 'Ishikawa, Kaga',
    '370': 'Fukui', '380': 'Shizuoka', '390': 'Aichi, outer sea', '391': 'Ise Bay and Mikawa Bay',
    '400': 'Mie, South', '500': 'Kyoto', '510': 'Osaka', '520': 'Hyogo, North',
    '521': 'Hyogo, Seto Inland Sea coast', '522': 'Awaji Island, South', '530': 'Wakayama',
    '540': 'Tottori', '550': 'Shimane, Izumo and Iwami', '551': 'Oki', '560': 'Okayama',
    '570': 'Hiroshima', '580': 'Tokushima', '590': 'Kagawa', '600': 'Ehime, Uwa Sea coast',
    '601': 'Ehime, Seto Inland Sea coast', '610': 'Kochi', '700': 'Yamaguchi, Sea of Japan coast',
    '701': 'Yamaguchi, Seto Inland Sea coast', '710': 'Fukuoka, Seto Inland Sea coast',
    '711': 'Fukuoka, Sea of Japan coast', '712': 'Ariake Sea and Yatsushiro Sea',
    '720': 'Saga, North', '730': 'Nagasaki, West', '731': 'Iki and Tsushima',
    '740': 'Kumamoto, Amakusa-nada coast', '750': 'Oita, Seto Inland Sea coast',
    '751': 'Oita, Bungo Channel coast', '760': 'Miyazaki', '770': 'Kagoshima, East',
    '771': 'Tanegashima and Yakushima area', '772': 'Amami Islands and Tokara Islands',
    '773': 'Kagoshima, West', '800': 'Okinawa Main Island area', '801': 'Daito Islands area',
    '802': 'Miyako and Yaeyama area',
}


def load(name):
    return json.load(open(os.path.join(GEO, name), encoding='utf-8'))


def centroid(geom):
    """Area-weighted centroid of the largest polygon (good enough for label placement)."""
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    best, best_a = None, -1
    for poly in polys:
        ring = poly[0]
        a = cx = cy = 0.0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            f = x1 * y2 - x2 * y1
            a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
        if abs(a) > best_a and a != 0:
            best_a, best = abs(a), (cx / (3 * a), cy / (3 * a))
    return [round(best[0], 4), round(best[1], 4)]


os.makedirs(OUT, exist_ok=True)

sub = load('subregions.json')
feats = []
for f in sub['features']:
    pr = f['properties']
    ja = pr['name']
    en = code_en.get(pr['code']) or ja_en.get(ja) or ja
    if pr['code'] == '':
        continue  # two tiny unassigned islets
    f['properties'] = {'code': pr['code'], 'ja': ja, 'en': en, 'c': centroid(f['geometry'])}
    feats.append(f)
sub['features'] = feats
json.dump(sub, open(os.path.join(OUT, 'subregions.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
missing = [f['properties']['ja'] for f in feats if f['properties']['en'] == f['properties']['ja']]
print('subregions', len(feats), 'untranslated', missing)

pref = load('prefectures.json')
for f in pref['features']:
    pr = f['properties']
    f['properties'] = {'code': pr['code'], 'ja': pr['name'], 'en': PREF_EN[int(pr['code']) - 1]}
json.dump(pref, open(os.path.join(OUT, 'prefectures.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

tsu = load('tsunami.json')
tsu['features'] = [f for f in tsu['features'] if f['properties']['code'] in TSUNAMI_EN]
for f in tsu['features']:
    pr = f['properties']
    f['properties'] = {'code': pr['code'], 'ja': pr['name'], 'en': TSUNAMI_EN[pr['code']]}
json.dump(tsu, open(os.path.join(OUT, 'tsunami.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('tsunami areas', len(tsu['features']))

land = load('land.json')
json.dump(land, open(os.path.join(OUT, 'land.json'), 'w'), separators=(',', ':'))

# ---------------------------------------------------------------- stations
# The region numbers stored with the stations in the Scratch project are not JMA area
# codes, so each land station is assigned to the JMA subregion polygon that contains it.
def polys_of(geom):
    return geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]


AREAS = []
for f in feats:
    ps = polys_of(f['geometry'])
    xs = [x for p in ps for x, _ in p[0]]
    ys = [y for p in ps for _, y in p[0]]
    AREAS.append((f['properties']['code'], (min(xs), min(ys), max(xs), max(ys)), ps, f['properties']['c']))


def inside(x, y, ring):
    res = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            res = not res
        j = i
    return res


def region_of(lat, lon):
    for code, (x1, y1, x2, y2), ps, _ in AREAS:
        if x1 <= lon <= x2 and y1 <= lat <= y2:
            for p in ps:
                if inside(lon, lat, p[0]) and not any(inside(lon, lat, h) for h in p[1:]):
                    return code
    # small islands and coastal sites dropped by simplification: nearest area centre
    code, c = min(((a[0], a[3]) for a in AREAS), key=lambda a: (a[1][0] - lon) ** 2 + (a[1][1] - lat) ** 2)
    return code


lon = lst(cur, '5-NIED観測点経度'); lat = lst(cur, '5-NIED観測点緯度')
arv = lst(cur, '(5-arv')
st = []
for i in range(len(lon)):
    la, lo = float(lat[i]), float(lon[i])
    st.append([round(la, 4), round(lo, 4), region_of(la, lo), round(float(arv[i]), 3), 0])
slon = lst(cur, '5-Snet観測点経度'); slat = lst(cur, '5-Snet観測点緯度')
for i in range(len(slon)):
    st.append([round(float(slat[i]), 4), round(float(slon[i]), 4), '', 1.0, 1])
json.dump({'fields': ['lat', 'lon', 'region', 'amp', 'seafloor'], 'stations': st},
          open(os.path.join(OUT, 'stations.json'), 'w'), separators=(',', ':'))
print('stations', len(st))

# ---------------------------------------------------------------- epicenter regions
L = lst(cur, '判定用の線たち')
regions = []
i = 0
while i < len(L):
    tok = L[i]
    if tok.startswith('c') and tok[1:].isdigit():
        code = tok[1:]
        assert L[i + 1] == 'bbox'
        bbox = [float(x) for x in L[i + 2:i + 6]]
        i += 6
        lines = []
        while i < len(L) and not (L[i].startswith('c') and L[i][1:].isdigit()):
            if L[i] == 'L':
                i += 1
                pts = []
                while i + 1 < len(L) and L[i] not in ('L', 'feature') and not L[i].startswith('c'):
                    try:
                        pts += [float(L[i]), float(L[i + 1])]
                    except ValueError:
                        break
                    i += 2
                lines.append(pts)
            else:
                i += 1
        regions.append({'code': code, 'en': code_en.get(code, ''), 'bbox': bbox, 'lines': lines})
    else:
        i += 1
json.dump(regions, open(os.path.join(OUT, 'epicenters.json'), 'w'), separators=(',', ':'))
print('epicenter regions', len(regions), 'without name', [r['code'] for r in regions if not r['en']])
