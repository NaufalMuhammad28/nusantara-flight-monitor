"""
Generator DATA SIMULASI penerbangan domestik Indonesia
------------------------------------------------------
Jalankan:  python generate_data.py
Hasil   :  data/airlines.csv, data/airports.csv, data/flights.csv

Semua angka (armada, delay, penumpang) adalah SIMULASI untuk keperluan
portofolio, termasuk efek musim nasional: mudik Lebaran (H-7 s.d. H+7),
Natal & Tahun Baru, libur sekolah, Ramadan, musim hujan, dan pertumbuhan tren.
Ganti file CSV di folder data/ dengan data aslimu kapan saja,
selama nama kolomnya sama (lihat README.md).
"""
import csv
import math
import os
import random
from datetime import date, timedelta

random.seed(2026)
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "data")
os.makedirs(OUT, exist_ok=True)

START, END = date(2025, 1, 1), date(2026, 9, 30)
FLIGHTS_PER_DAY = 200  # sampel harian dasar (sebelum efek musim & tren); naikkan kalau mau volume lebih besar
GROWTH_PER_YEAR = 0.06  # pertumbuhan trafik tahunan

# ---- Kalender musim nasional ----
# Perkiraan 1 Syawal (Idulfitri). Sesuaikan bila tanggal resmi berbeda.
LEBARAN = [date(2025, 3, 31), date(2026, 3, 21)]
MUDIK_DEST = {"SUB", "KNO", "YIA", "SRG", "PDG", "PLM", "UPG", "TKG", "DJB", "PKU", "BTJ", "BDJ", "PNK"}
WISATA = {"DPS", "LOP", "YIA", "KOE", "MDC", "SOQ"}


def season_of(day):
    """Kembalikan (nama musim, hari relatif ke Lebaran atau None)."""
    for L in LEBARAN:
        k = (day - L).days
        if -7 <= k <= 7:
            return "Lebaran", k
    if (day.month == 12 and day.day >= 18) or (day.month == 1 and day.day <= 4):
        return "Nataru", None
    if (day.month == 6 and day.day >= 21) or (day.month == 7 and day.day <= 13):
        return "Libur Sekolah", None
    return "Reguler", None


def is_ramadan(day):
    return any(-37 <= (day - L).days < -7 for L in LEBARAN)

# code, name, group, type, fleet_active (simulasi), seats, base delay prob, market share, color
AIRLINES = [
    ("GA", "Garuda Indonesia", "Garuda Indonesia Group", "Full Service", 72, [162, 162, 174, 301], 0.11, 0.13, "#0b4f8a"),
    ("QG", "Citilink", "Garuda Indonesia Group", "LCC", 54, [180, 180, 186], 0.17, 0.14, "#2bb3a3"),
    ("ID", "Batik Air", "Lion Air Group", "Full Service", 80, [156, 180, 180], 0.16, 0.15, "#8a1c3c"),
    ("JT", "Lion Air", "Lion Air Group", "LCC", 110, [189, 215, 215], 0.27, 0.22, "#d64545"),
    ("IU", "Super Air Jet", "Lion Air Group", "LCC", 60, [180, 180], 0.23, 0.13, "#e8a317"),
    ("IW", "Wings Air", "Lion Air Group", "Regional", 50, [72, 72, 68], 0.21, 0.09, "#5b6bd6"),
    ("IP", "Pelita Air", "Pelita Air Service", "Medium Service", 14, [180, 174], 0.09, 0.06, "#14866d"),
    ("QZ", "Indonesia AirAsia", "AirAsia Group", "LCC", 20, [180], 0.15, 0.08, "#c2185b"),
]
AL = {a[0]: a for a in AIRLINES}

# iata, airport_name, city, province, lat, lon, is_hub
AIRPORTS = [
    ("CGK", "Soekarno-Hatta", "Jakarta", "Banten", -6.1256, 106.6559, True),
    ("SUB", "Juanda", "Surabaya", "Jawa Timur", -7.3798, 112.7868, True),
    ("DPS", "I Gusti Ngurah Rai", "Denpasar", "Bali", -8.7482, 115.1672, True),
    ("UPG", "Sultan Hasanuddin", "Makassar", "Sulawesi Selatan", -5.0616, 119.5540, True),
    ("KNO", "Kualanamu", "Medan", "Sumatera Utara", 3.6422, 98.8853, True),
    ("BPN", "Sultan Aji Muhammad Sulaiman Sepinggan", "Balikpapan", "Kalimantan Timur", -1.2683, 116.8945, True),
    ("YIA", "Yogyakarta International", "Yogyakarta", "DI Yogyakarta", -7.9007, 110.0573, False),
    ("SRG", "Jenderal Ahmad Yani", "Semarang", "Jawa Tengah", -6.9727, 110.3750, False),
    ("PLM", "Sultan Mahmud Badaruddin II", "Palembang", "Sumatera Selatan", -2.8983, 104.6999, False),
    ("PDG", "Minangkabau", "Padang", "Sumatera Barat", -0.7869, 100.2809, False),
    ("PKU", "Sultan Syarif Kasim II", "Pekanbaru", "Riau", 0.4608, 101.4445, False),
    ("BTH", "Hang Nadim", "Batam", "Kepulauan Riau", 1.1210, 104.1190, False),
    ("BTJ", "Sultan Iskandar Muda", "Banda Aceh", "Aceh", 5.5229, 95.4206, False),
    ("TKG", "Radin Inten II", "Bandar Lampung", "Lampung", -5.2406, 105.1756, False),
    ("DJB", "Sultan Thaha", "Jambi", "Jambi", -1.6380, 103.6440, False),
    ("PNK", "Supadio", "Pontianak", "Kalimantan Barat", -0.1507, 109.4039, False),
    ("BDJ", "Syamsudin Noor", "Banjarmasin", "Kalimantan Selatan", -3.4424, 114.7625, False),
    ("MDC", "Sam Ratulangi", "Manado", "Sulawesi Utara", 1.5493, 124.9259, False),
    ("PLW", "Mutiara SIS Al-Jufri", "Palu", "Sulawesi Tengah", -0.9185, 119.9095, False),
    ("LOP", "Zainuddin Abdul Madjid", "Lombok", "Nusa Tenggara Barat", -8.7573, 116.2767, False),
    ("KOE", "El Tari", "Kupang", "Nusa Tenggara Timur", -10.1716, 123.6711, False),
    ("AMQ", "Pattimura", "Ambon", "Maluku", -3.7103, 128.0891, False),
    ("SOQ", "Domine Eduard Osok", "Sorong", "Papua Barat Daya", -0.8941, 131.2870, False),
    ("TIM", "Mozes Kilangin", "Timika", "Papua Tengah", -4.5283, 136.8873, False),
    ("DJJ", "Sentani", "Jayapura", "Papua", -2.5770, 140.5160, False),
]
AP = {a[0]: a for a in AIRPORTS}

# rute (undirected) + bobot frekuensi
ROUTES = [
    ("CGK", "DPS", 34), ("CGK", "SUB", 30), ("CGK", "KNO", 26), ("CGK", "UPG", 24),
    ("CGK", "BPN", 16), ("CGK", "YIA", 14), ("CGK", "BTH", 14), ("CGK", "PLM", 12),
    ("CGK", "PDG", 12), ("CGK", "PKU", 12), ("CGK", "SRG", 12), ("CGK", "PNK", 10),
    ("CGK", "BDJ", 10), ("CGK", "MDC", 8), ("CGK", "LOP", 8), ("CGK", "DJB", 7),
    ("CGK", "KOE", 6), ("CGK", "TKG", 6), ("CGK", "BTJ", 6), ("CGK", "AMQ", 5),
    ("CGK", "DJJ", 5), ("CGK", "PLW", 4), ("CGK", "TIM", 3), ("CGK", "SOQ", 2),
    ("SUB", "UPG", 14), ("SUB", "BPN", 12), ("SUB", "DPS", 10), ("SUB", "BDJ", 10),
    ("SUB", "LOP", 6), ("SUB", "BTH", 5), ("SUB", "KOE", 4), ("SUB", "PNK", 4), ("SUB", "KNO", 4),
    ("UPG", "SOQ", 14), ("UPG", "DJJ", 8), ("UPG", "MDC", 7), ("UPG", "AMQ", 7),
    ("UPG", "BPN", 6), ("UPG", "PLW", 6), ("UPG", "DPS", 6), ("UPG", "KOE", 5), ("UPG", "TIM", 5),
    ("DPS", "LOP", 7), ("DPS", "KOE", 6), ("DPS", "YIA", 4),
    ("KNO", "BTJ", 7), ("KNO", "BTH", 6), ("KNO", "PDG", 3), ("KNO", "PKU", 3),
    ("BTH", "PDG", 3), ("BTH", "PNK", 3), ("BPN", "BDJ", 3),
    ("DJJ", "TIM", 4), ("SOQ", "DJJ", 3), ("AMQ", "SOQ", 3), ("MDC", "SOQ", 2),
]

CAUSES = ["Operasional Maskapai", "Rotasi & Teknis Pesawat", "Cuaca", "Bandara & ATC", "Lainnya"]
CAUSE_W = {
    "LCC": [34, 26, 16, 14, 10], "Regional": [28, 26, 24, 12, 10],
    "Full Service": [24, 22, 22, 20, 12], "Medium Service": [24, 22, 22, 20, 12],
}
HOURS = list(range(5, 22))
HOUR_W = [3, 8, 9, 8, 7, 6, 6, 6, 7, 7, 8, 8, 7, 6, 5, 4, 2]


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (AP[a][4], AP[a][5], AP[b][4], AP[b][5]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def eligible(a, b, w):
    d = km(a, b)
    out = {}
    for code, *_rest in AIRLINES:
        share = AL[code][7]
        if code == "IW":
            if d > 750:
                continue
            share *= 4 if d < 500 else 1.5
        if code == "IP" and not ("CGK" in (a, b) and w >= 10):
            continue
        if code == "QZ" and not (w >= 14 or "DPS" in (a, b)):
            continue
        out[code] = share
    return out


def region(lon):
    return "barat" if lon < 110 else ("tengah" if lon < 125 else "timur")


elig = [eligible(*r) for r in ROUTES]
flight_no_map, counters = {}, {c[0]: 100 for c in AIRLINES}


def route_weights(season):
    w = []
    for a, b, base in ROUTES:
        m = 1.0
        if season == "Lebaran" and "CGK" in (a, b) and ({a, b} & MUDIK_DEST):
            m = 1.7   # arus mudik dari Jabodetabek
        elif season == "Nataru" and ({a, b} & WISATA):
            m = 1.7   # rute wisata akhir tahun
        elif season == "Libur Sekolah" and ({a, b} & WISATA):
            m = 1.3
        w.append(base * m)
    return w


RW = {s_: route_weights(s_) for s_ in ("Reguler", "Lebaran", "Nataru", "Libur Sekolah")}

rows, fid = [], 0
day = START
while day <= END:
    dow = day.weekday()
    season, k = season_of(day)
    day_f = {4: 1.10, 6: 1.12, 5: 0.95, 1: 0.92, 2: 0.92}.get(dow, 1.0)
    if season == "Lebaran":
        vol_f = 1.65 if -4 <= k <= -1 else 1.55 if 2 <= k <= 5 else 1.35   # puncak arus mudik & balik
        delay_f = 1.45
    elif season == "Nataru":
        vol_f, delay_f = 1.25, 1.25
    elif season == "Libur Sekolah":
        vol_f, delay_f = 1.10, 1.10
    else:
        vol_f, delay_f = (0.88 if is_ramadan(day) else 1.0), 1.0
    growth = 1 + GROWTH_PER_YEAR * (day - START).days / 365
    rainy = day.month in (11, 12, 1, 2, 3)   # musim hujan → lebih sering cuaca buruk
    storm = {r: (random.random() < (0.18 if rainy else 0.08)) for r in ("barat", "tengah", "timur")}
    n = int(FLIGHTS_PER_DAY * day_f * vol_f * growth * random.uniform(0.96, 1.04))
    rw = RW[season]

    for _ in range(n):
        fid += 1
        i = random.choices(range(len(ROUTES)), weights=rw)[0]
        a, b, _w = ROUTES[i]
        o, d = (a, b) if random.random() < 0.5 else (b, a)
        codes = list(elig[i].keys())
        code = random.choices(codes, weights=list(elig[i].values()))[0]
        _, name, group, typ, fleet, seat_opts, base_p, share, color = AL[code]

        hour = random.choices(HOURS, weights=HOUR_W)[0]
        minute = random.choice(range(0, 60, 5))
        key = (code, o, d, hour)
        if key not in flight_no_map:
            counters[code] += random.randint(1, 7)
            flight_no_map[key] = f"{code}-{counters[code]}"

        is_storm = storm[region(AP[o][5])] or storm[region(AP[d][5])]
        p = base_p * (0.75 + 0.045 * (hour - 5))
        p *= 1.15 if "CGK" in (o, d) else 1.0
        p *= 1.7 if is_storm else 1.0
        p *= 1.08 if dow in (4, 6) else 1.0
        p *= delay_f * (1.1 if season == "Lebaran" and ({o, d} & {"CGK", "SUB"}) else 1.0)  # antrean runway saat mudik
        p *= 0.62  # kalibrasi: OTP nasional reguler ~85%
        p = min(p, 0.85)

        cancel_p = 0.008 * (3 if is_storm else 1)
        sched = f"{hour:02d}:{minute:02d}"
        cw = list(CAUSE_W[typ])
        if is_storm:
            cw[2] *= 3
        if season in ("Lebaran", "Nataru"):
            cw[3] *= 1.8   # kepadatan bandara & ATC naik saat peak season
        seats = random.choice(seat_opts)

        if random.random() < cancel_p:
            status, delay, actual, pax = "Cancelled", "", "", 0
            cause = random.choices(CAUSES, weights=cw)[0]
        else:
            if random.random() < p:
                status = "Delayed"
                delay = min(420, 16 + int(random.expovariate(1 / 40)))
                cause = random.choices(CAUSES, weights=cw)[0]
            else:
                status = "On-Time"
                delay = min(15, int(random.expovariate(1 / 4)))
                cause = ""
            t = (hour * 60 + minute + delay) % (24 * 60)
            actual = f"{t // 60:02d}:{t % 60:02d}"
            if season == "Lebaran":
                lf = random.uniform(0.88, 0.995)
            elif season == "Nataru":
                lf = random.uniform(0.82, 0.98)
            else:
                lf = min(0.98, random.uniform(0.66, 0.93) + (0.03 if dow >= 4 else 0))
            pax = round(seats * lf)

        rows.append([
            f"{day:%Y%m%d}-{fid:06d}", day.isoformat(), code, flight_no_map[key], o, d,
            sched, actual, delay, pax, seats, status, cause, season,
        ])
    day += timedelta(days=1)

with open(os.path.join(OUT, "airlines.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["airline_code", "airline_name", "group", "type", "fleet_active", "color"])
    for a in AIRLINES:
        w.writerow([a[0], a[1], a[2], a[3], a[4], a[8]])

with open(os.path.join(OUT, "airports.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["iata", "airport_name", "city", "province", "lat", "lon", "is_hub"])
    for a in AIRPORTS:
        w.writerow([*a[:6], str(a[6]).lower()])

with open(os.path.join(OUT, "flights.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["flight_id", "date", "airline_code", "flight_no", "origin", "destination",
                "sched_dep", "actual_dep", "delay_min", "pax", "seats", "status", "delay_cause", "season"])
    w.writerows(rows)

print(f"Selesai: {len(rows):,} penerbangan, {len(AIRLINES)} maskapai, {len(AIRPORTS)} bandara -> {OUT}")
