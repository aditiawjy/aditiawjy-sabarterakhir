# H/A Odds Movement Pre-Goal Design

## Objective
- Rekam pergerakan odds Home/Away (FT 1X2) secara berkala.
- Tandai arah perubahan (`▲`, `▼`, `=`) pada setiap interval.
- Hubungkan pola pergerakan sebelum gol untuk melihat indikasi pre-goal movement.

## Scope
- Sumber odds: **FT 1X2**.
- Interval analisis: **30 detik bucket**.
- Jendela pre-goal default: **90 detik** (3 bucket terakhir).
- Output: tabel analisis popup + export CSV.

## Data Model

### Runtime state baru (background)
- `haHistoryByKey`: histori bucket H/A per `eventIdKey`.
- `goalPreHaPatternByKey`: ringkasan pola H/A ketika gol terdeteksi.

### Struktur bucket
- `bucketAtMs`
- `minute`
- `homeOdds`
- `awayOdds`
- `homeDir` (`▲`/`▼`/`=`)
- `awayDir` (`▲`/`▼`/`=`)

### Struktur ringkasan pre-goal
- `goalAt`
- `goalMinute`
- `windowSeconds`
- `homeUpCount`
- `homeDownCount`
- `awayUpCount`
- `awayDownCount`
- `homeTrend90s`
- `awayTrend90s`
- `preGoalPattern`

## Architecture

### Extraction layer (content script)
- Dari event live, ambil market FT 1X2.
- Mapping ke `homeOdds` dan `awayOdds` berdasarkan urutan tim (home = teams[0], away = teams[1]).
- Kirim field ini bersama snapshot agar background tidak perlu re-parse market mentah.

### Aggregation layer (background)
- Setiap update snapshot, masukkan ke bucket 30 detik.
- Hitung arah perubahan terhadap bucket sebelumnya per sisi H/A.
- Simpan histori terbatas (rolling window) untuk efisiensi.

### Goal correlation layer
- Saat gol terdeteksi, ambil bucket dalam 90 detik terakhir.
- Hitung dominansi up/down untuk home dan away.
- Bentuk label pola sederhana, contoh:
  - `H▼ dominant pre-goal`
  - `A▲ dominant pre-goal`
  - `Mixed / No clear trend`

### Presentation layer (popup + export)
- Tambah kolom di FT O/U analysis:
  - `H Trend(90s)`
  - `A Trend(90s)`
  - `PreGoal Pattern`
- Tambah field CSV untuk analisis offline.

## Rules and Fallbacks
- Jika H/A odds tidak valid: tampilkan `-`.
- Jika belum ada gol: pola pre-goal `-`.
- Jika data kurang dari 2 bucket: trend `insufficient`.
- Jika jumlah up/down seimbang: `mixed`.

## Risks
- Mapping H/A bisa salah jika urutan market berubah: mitigasi dengan validasi urutan tim dan fallback no-data.
- Noise tinggi pada perubahan kecil: mitigasi dengan bucket 30 detik dan ringkasan dominansi, bukan tick-level.

## Validation Plan
- Simulasikan update odds berurutan dan satu event gol.
- Verifikasi:
  - Arah `▲/▼/=` terbentuk benar.
  - Ringkasan 90 detik terhitung saat gol.
  - Kolom popup dan CSV menampilkan nilai konsisten.
