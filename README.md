# Nusantara Flight Monitor ✈️🇮🇩
**by M. Naufal Zamani**

Dashboard HTML pemantauan penerbangan domestik Indonesia (adaptasi layout Aurum Jet).
Stack: HTML + CSS + JavaScript murni, dengan Leaflet (peta), Chart.js (grafik), PapaParse (CSV) via CDN.

## Struktur folder
```
nusantara-flight-dashboard/
├── index.html          ← tata letak halaman
├── style.css           ← tema terang & gelap (ATC)
├── app.js              ← logika: load CSV, KPI, peta, grafik
├── generate_data.py    ← pembuat data simulasi (dengan efek musim Lebaran, Nataru, libur sekolah)
├── analysis/
│   ├── delay_risk_model.ipynb    ← model ML Delay Risk (Logistic Regression + Random Forest)
│   ├── statistical_models.ipynb  ← SARIMA (ADF, ACF/PACF, Ljung–Box, backtest) + distribusi Gamma (MLE)
│   ├── sarima_lite.py            ← implementasi SARIMA/ADF/ACF/PACF/Ljung–Box (NumPy/SciPy)
│   └── requirements.txt
├── assets/logos/       ← taruh logo maskapai di sini (GA.png, JT.svg, …) — lihat BACA-SAYA.txt
├── assets/hero.jpg     ← (opsional) foto latar judul. Tanpa file ini dipakai foto Terminal 3 Soekarno-Hatta dari Unsplash (Edwin Petrus, Unsplash License)
└── data/
    ├── airlines.csv    ← Dim_Airlines
    ├── airports.csv    ← Dim_Airports
    ├── flights.csv     ← Fact_Flights
    ├── delay_risk.csv          ← hasil notebook (skor risiko maskapai × jam)
    ├── feature_importance.csv  ← hasil notebook
    ├── model_metrics.json      ← hasil notebook
    ├── forecast.csv, forecast_history.csv, stat_models.json ← hasil statistical_models.ipynb
```

## Cara menjalankan di VS Code
1. Buka folder ini di VS Code (File → Open Folder).
2. Pasang extension **Live Server** (Ritwick Dey).
3. Klik kanan `index.html` → **Open with Live Server**.

Kalau `index.html` dibuka dengan dobel-klik, browser memblokir pembacaan CSV lokal. Dashboard akan menampilkan tombol untuk memilih 3 file CSV secara manual.
Perlu koneksi internet (font, library, dan peta dasar diambil online). Peta dasar memakai Esri (tanpa API key) dan otomatis pindah ke OpenStreetMap kalau Esri gagal dimuat.

## Format data (ganti dengan data aslimu)
Kolom bertanda * wajib. Nama kolom alternatif juga dikenali otomatis, misalnya `latitude/longitude`, `origin_airport`, `destination_airport`, `departure_delay_minutes`, `passenger_count`, `delay_reason`, dan nama maskapai di kolom `airline`. Tanggal boleh `YYYY-MM-DD` atau `DD/MM/YYYY`.

**airlines.csv**
| kolom | contoh | keterangan |
|---|---|---|
| airline_code* | GA | kode IATA maskapai |
| airline_name* | Garuda Indonesia | |
| type* | Full Service / LCC / Regional | |
| fleet_active* | 72 | jumlah armada aktif |
| group | Garuda Indonesia Group | opsional |
| color | #0b4f8a | opsional, warna badge |

**airports.csv**
| kolom | contoh |
|---|---|
| iata* | CGK |
| airport_name* | Soekarno-Hatta |
| city* | Jakarta |
| province* | Banten |
| lat*, lon* | -6.1256, 106.6559 |
| is_hub | true / false |

**flights.csv** (1 baris = 1 penerbangan)
| kolom | contoh | keterangan |
|---|---|---|
| date* | 2026-09-14 | format YYYY-MM-DD |
| airline_code* | JT | harus ada di airlines.csv |
| origin*, destination* | CGK, DPS | harus ada di airports.csv |
| sched_dep* | 06:30 | jam jadwal |
| delay_min* | 22 | menit keterlambatan (kosong jika batal) |
| pax* | 187 | jumlah penumpang |
| status* | On-Time / Delayed / Cancelled | |
| actual_dep, flight_no, flight_id | | opsional |
| delay_cause | Cuaca | opsional, untuk grafik penyebab |
| seats | 180 | opsional, kapasitas kursi → load factor |
| season | Lebaran / Nataru / Libur Sekolah / Reguler | opsional → filter & analisis musim |

Data agregat (mis. total penumpang per bandara per bulan dari BPS) tidak berbentuk per penerbangan, jadi perlu disesuaikan dulu ke format di atas, atau dashboard-nya yang disesuaikan.

## Isi dashboard
- **Insight Utama & Rekomendasi** — 8 temuan kunci + rekomendasi operasional, dihitung otomatis sesuai filter.
- **Peta Rute Nusantara** — rute lengkung, pesawat beranimasi di 14 rute teratas, mode Peta/Satelit.
- **Profil Maskapai** — gauge OTP, statistik, rute terbanyak, OTP 7-hari vs nasional.
- **Analitik Delay** — sebaran durasi, peringkat OTP (dengan garis nasional), penyebab, tren harian + target.
- **Pola Waktu & Bandara** — jam sibuk vs tingkat delay, heatmap hari × jam, gelembung trafik vs OTP (dengan korelasi Pearson).
- **Estimasi biaya delay** (KPI) — biaya operasional per menit (asumsi, bisa diubah) + kompensasi penumpang sesuai kategori PM 89/2015 (hanya untuk penyebab manajemen maskapai).
- **Simulasi kebijakan** — slider redistribusi slot jam sibuk, perbaikan faktor internal, dan buffer turnaround LCC → OTP, delay yang dihindari, dan penghematan.
- **Utilisasi gate terminal CGK** — kebutuhan gate jam puncak vs gate tersedia (pemetaan & kapasitas = asumsi di objek `CGK`, app.js).
- **Papan keberangkatan (FIDS)** — simulasi papan bandara berdasarkan jadwal di data untuk hari yang sama.
- **Brief eksekutif** — tombol cetak/PDF satu halaman A4 (di dialog cetak pilih *Save as PDF*).
- **Model statistik** — rumus SARIMA, Gamma, dan regresi logistik lengkap dengan parameter hasil estimasi + grafik ramalan 14 hari.
- Setiap grafik punya kotak **Interpretasi** yang teksnya berubah mengikuti data & filter.

## Notebook machine learning
```
cd analysis
pip install -r requirements.txt
jupyter notebook delay_risk_model.ipynb
```
Ada dua notebook. `statistical_models.ipynb` berjalan hanya dengan NumPy/SciPy (statsmodels opsional untuk validasi silang). `delay_risk_model.ipynb` memakai scikit-learn. Notebook risiko melatih model pada data 2025 dan mengujinya pada Jan–Sep 2026, lalu menyimpan skor risiko ke `data/`. Panel **Delay Risk Scoring** di dashboard membaca file tersebut otomatis. Jalankan ulang notebook setiap kali `flights.csv` diganti.

## Deploy online gratis (GitHub Pages)
1. Buat akun di github.com, lalu **New repository** → nama mis. `nusantara-flight-monitor` → **Public** → Create.
2. Upload seluruh isi folder ini (drag & drop di halaman repo → **Commit changes**), atau lewat terminal VS Code:
   ```
   git init
   git add .
   git commit -m "Nusantara Flight Monitor"
   git branch -M main
   git remote add origin https://github.com/USERNAME/nusantara-flight-monitor.git
   git push -u origin main
   ```
3. Di repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. Tunggu 1–2 menit. Dashboard tayang di `https://USERNAME.github.io/nusantara-flight-monitor/`.
5. Tempel link itu di CV, LinkedIn (Featured), dan README repo. Notebook-nya otomatis bisa dibaca langsung di GitHub.

## Definisi metrik
- **OTP** = penerbangan berangkat ≤ 15 menit dari jadwal ÷ penerbangan yang terbang (batal tidak dihitung). Ubah batasnya di `CFG.otpLimit` (app.js).
- **Rata-rata keterlambatan** = rata-rata menit delay pada penerbangan yang terlambat (> 15 menit).
- **Pergerakan penumpang** = total `pax` penerbangan yang tidak batal.
- **Tingkat delay** = penerbangan terlambat > 15 menit ÷ penerbangan yang terbang.
- Target OTP (default 85%) bisa diubah di `CFG.otpTarget` (app.js).

## Membuat ulang data simulasi
```
python generate_data.py
```
Ubah periode (`START`, `END`) atau volume (`FLIGHTS_PER_DAY`) di bagian atas file.

> Catatan: semua angka di folder `data/` adalah simulasi untuk portofolio, bukan data resmi.
