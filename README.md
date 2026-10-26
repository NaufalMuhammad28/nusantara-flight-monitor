# ✈️ Nusantara Flight Monitor (NFM)
**Network Operations Center & Decision Support System (DSS)**  
*Author: M. Naufal Zamani (Magister Statistika ITS)*

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active%20Portfolio-success?style=for-the-badge" alt="Status">
  <img src="https://img.shields.io/badge/Stack-Python%20%7C%20JavaScript%20%7C%20Leaflet-blue?style=for-the-badge" alt="Tech Stack">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License">
</p>

<p align="center">
  <b>Dashboard analitik & decision support pemantauan penerbangan domestik Indonesia.</b><br>
  Memadukan visualisasi geospasial real-time, peramalan time-series SARIMA, pemodelan durasi delay Gamma, dan simulasi kebijakan operasional (What-If Engine).
</p>

---

## 🌐 Live Demo
🔗 **Coba Web Dashboard Secara Langsung:**  
👉 [https://NaufalMuhammad28.github.io/nusantara-flight-monitor/](https://NaufalMuhammad28.github.io/nusantara-flight-monitor/)

---

## 📊 Ringkasan Fitur Utama
* **Peta Rute Nusantara:** Visualisasi koridor udara dua arah dengan kurva Bézier geospasial dan animasi posisi pesawat terbang interaktif.
* **Profil Maskapai:** Evaluasi performa OTP (On-Time Performance) lengkap dengan badge logo resmi maskapai nasional (Garuda, Lion, Citilink, Batik, dll.).
* **Dekomposisi Analitik Delay:** Analisis sebaran durasi keterlambatan, perbandingan maskapai, matriks heatmap hari $\times$ jam, hingga korelasi trafik bandara.
* **Kalkulator Biaya Delay (Cost of Delay):** Estimasi kerugian operasional langsung dipadu dengan simulasi liabilitas kompensasi penumpang mengacu pada **Permenhub PM 89/2015**.
* **Laboratorium Simulasi Kebijakan (What-If):** Alat bantu keputusan (*Decision Support System*) untuk menguji redistribusi slot jam sibuk dan penambahan *buffer turnaround* LCC.
* **Papan Keberangkatan Terminal (FIDS):** Simulasi layar informasi penerbangan bandara secara real-time.
* **Brief Eksekutif (PDF/Print):** Fitur cetak laporan ringkas satu halaman standar direksi.
* **Model Statistik & ML:** Dokumentasi lengkap pemodelan SARIMA musiman, fitting distribusi Gamma (MLE), regresi logistik biner, dan *permutation feature importance*.

---

## 🗂️ Struktur Direktori Proyek
```text
nusantara-flight-dashboard/
├── index.html                  ← Antarmuka utama aplikasi web
├── style.css                   ← Desain sistem "Apron Sunset & ATC Dark Mode"
├── app.js                      ← Engine interaktif, parser PapaParse, & Chart.js
├── generate_data.py            ← Generator data simulasi terkalibrasi musiman
├── README.md                   ← Dokumentasi resmi portofolio
│
├── analysis/                   
│   ├── delay_risk_model.ipynb    ← Model Machine Learning (Scikit-Learn)
│   ├── statistical_models.ipynb  ← Peramalan SARIMA & Distribusi Gamma (SciPy)
│   ├── sarima_lite.py            ← Modul matematika pendukung
│   └── requirements.txt          ← Kebutuhan pustaka Python
│
├── assets/
│   ├── hero.jpg                ← Foto latar latar belakang judul
│   └── logos/                  ← Aset logo resmi maskapai (GA, JT, QG, ID, dll.)
│
└── data/                       
    ├── airlines.csv            ← Master data maskapai (Dim_Airlines)
    ├── airports.csv            ← Master data bandara & koordinat (Dim_Airports)
    ├── flights.csv             ← Transaksi penerbangan (Fact_Flights)
    ├── delay_risk.csv          ← Hasil skor risiko maskapai × jam
    ├── feature_importance.csv  ← Hasil permutation importance ML
    ├── model_metrics.json      ← Evaluasi metrik ROC-AUC / PR-AUC
    └── forecast.csv            ← Hasil peramalan penumpang SARIMA 14 hari
