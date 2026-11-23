# Monitoring ISP Sicepat

> **Keamanan data:** repositori ini ditujukan untuk **Public**, jadi **tidak boleh** memuat data internal asli
> (nama/alamat gerai, ID pelanggan, pembayaran). Data hanya ada di komputer pemakai (folder `data/` diabaikan Git,
> dan `js/data/data-awal.js` di repositori berupa template kosong). Hook pre-commit menolak commit yang berisi data.
> Setelah meng-clone repositori, jalankan sekali: `git config core.hooksPath .githooks`

Aplikasi web statis (HTML + CSS + JavaScript murni, tanpa build/instalasi) untuk mendata gerai, vendor ISP,
masa sewa, pembayaran bulanan, dan konfigurasi jaringan (Data Network). Data tersimpan di browser (localStorage).

## Menjalankan

| Cara | Langkah |
|---|---|
| VS Code (tanpa ekstensi) | `Ctrl+Shift+B` → task **Jalankan Website** → buka `http://localhost:5500` |
| VS Code + Live Server | klik kanan `index.html` → *Open with Live Server* |
| Terminal | `powershell -ExecutionPolicy Bypass -File serve.ps1` (opsi `-Port 5600`, `-NoBrowser`) |

> Harus lewat `http://localhost` (atau https). Login memakai `crypto.subtle` yang hanya aktif di konteks aman;
> alamat `http://192.168.x.x` atau membuka file langsung (`file://`) membuat login tidak berfungsi.

Login pertama kali: aplikasi meminta membuat akun admin. Login ini hanya "gerbang tampilan" (tanpa server),
bukan pengganti keamanan server.

## Struktur proyek

```
ISP/
├─ index.html              Satu-satunya halaman (semua "halaman" aplikasi = bagian [data-page])
├─ serve.ps1               Server lokal untuk pengembangan (tanpa cache, tanpa dependensi)
├─ README.md  .editorconfig  .gitignore  .gitattributes  .githooks/ (pre-commit pencegah data bocor)
├─ .vscode/                tasks.json (jalankan server / tes), settings, ekstensi yang disarankan
├─ assets/img/             Gambar (logo)
├─ data/                   Taruh Internet.xlsx di sini SECARA LOKAL (folder diabaikan Git; jangan di-commit)
├─ css/
│  ├─ style.css            Token tema (gelap/terang) + komponen dasar (tombol, form, tabel, dialog, toast)
│  └─ dashboard.css        Tata letak (menu kiri, topbar), halaman, grafik, layar login, perbaikan responsif
├─ js/
│  ├─ config/config.js     SEMUA konstanta & konfigurasi (vendor, status, batas, key penyimpanan, namespace ?ns=)
│  ├─ core/                Logika tanpa DOM: utils, storage, store (gerai), net-store (Data Network),
│  │                       validation, csv, excel, auth, sample
│  ├─ ui/                  Tampilan & interaksi (ui-*.js): summary, table, charts, form, network, nav, theme, toast, auth
│  ├─ data/data-awal.js    Template data awal KOSONG (dihasilkan tools/convert-xlsx.ps1 bila dijalankan lokal)
│  └─ app.js               Titik masuk: merangkai modul, event global, pengaman error
├─ tools/convert-xlsx.ps1  Excel → js/data/data-awal.js
└─ tests/                  Tes otomatis (buka http://localhost:5500/tests/)
```

**Aturan arsitektur:** `core/` tidak boleh menyentuh DOM; `ui/` boleh memakai `core/` tetapi tidak sebaliknya.
Semua modul berbagi namespace global `App` (script klasik, bukan ES module, agar tetap berjalan tanpa server khusus).
Urutan `<script>` di `index.html` penting (dijaga oleh tes "Struktur proyek").

## Menambah fitur (ringkas)

1. **Konstanta/opsi baru** → `js/config/config.js`.
2. **Logika data** → `js/core/` (lengkapi tes di `tests/unit.js`).
3. **Tampilan** → `js/ui/ui-<nama>.js`, daftarkan `<script>` di `index.html` (sebelum `app.js`), panggil `init()` dari `app.js`.
4. **Halaman baru** → tambah bagian `data-page="..."` di `index.html`, item menu `data-nav`, dan entri `PAGES` di `js/ui/ui-nav.js`.
5. Teks dari pengguna yang dimasukkan lewat `innerHTML` **wajib** melewati `App.utils.escapeHtml`.
6. Jalankan tes sebelum menyerahkan perubahan.

## Penyimpanan & ketahanan data

- Key localStorage: lihat `config.js` (`storageKey`, `netStorageKey`, `authKeys`). Tambahkan `?ns=nama` pada URL
  untuk memakai ruang penyimpanan terpisah (dipakai tes agar data asli tidak tersentuh).
- Data rusak di penyimpanan **tidak menimpa data lama diam-diam**: salinannya disimpan di key `<key>.rusak-<waktu>`.
- Simpan gagal (kuota penuh/diblokir) → perubahan **dibatalkan**, pengguna diberi pesan; tabel tidak menampilkan data yang tidak tersimpan.
- Batas aman: ±10.000 gerai per browser (kuota localStorage ±5 juta karakter; 5.000 gerai ≈ 1,9 juta karakter). Teks dipangkas ke `config.limits`.
- Impor dibatasi `config.maxImportBytes` (10 MB) dan `config.maxImportRows` (20.000 baris).
- Ekspor Excel secara berkala = cadangan data.

## Tes otomatis

Buka `http://localhost:5500/tests/` (server dari langkah di atas). Isinya:

- **Unit:** fungsi bantu, storage, store gerai & Data Network, validasi (IP/DNS/tanggal/nominal), impor CSV/Excel salah-input,
  login (kunci setelah 5 gagal, sesi kedaluwarsa, data akun rusak), data besar (5.000–20.000 baris), simpan gagal/kuota penuh.
- **UI (aplikasi asli di iframe):** keadaan kosong, data rusak, payload XSS, data besar (3.000 gerai), form & impor salah,
  12 lebar layar (320–1920 px) × 4 halaman + dialog + tema terang, layar login, urutan script.
- **Kontrol negatif:** membuktikan pendeteksi overflow & XSS memang bisa mendeteksi.

Hasil terakhir: Chrome 158 dan Edge 158 → 80/80 lulus. **Firefox belum diuji otomatis** (tidak terpasang di mesin pengembang);
jalankan halaman tes di Firefox dan pastikan ringkasan menunjukkan `Gagal 0`.

## Dukungan browser

Dirancang untuk Chrome/Edge 111+ dan Firefox 113+ (memakai `<dialog>`, `crypto.subtle`, localStorage; `color-mix()` punya warna cadangan sehingga versi sedikit lebih lama tetap tampil wajar).
Tampilan di ponsel: halaman tidak melebar; tabel lebar digeser di dalam kartunya.

## Pemecahan masalah singkat

| Gejala | Periksa |
|---|---|
| Layar login/aplikasi tidak muncul | Console (F12); urutan `<script>`; buka lewat `http://localhost` |
| Data hilang | DevTools → Application → Local Storage: key `.rusak-` berisi salinan data rusak |
| `App.xxx is undefined` | File gagal dimuat / urutan script salah (jalankan tes "Struktur proyek") |
| Data awal Excel tidak terisi | Repositori hanya berisi template kosong. Letakkan `data/Internet.xlsx` lokal lalu jalankan `tools/convert-xlsx.ps1` (hasilnya JANGAN di-commit), atau pakai tombol Impor Excel/CSV |
| Impor Excel gagal | Pustaka SheetJS dimuat dari CDN: perlu internet; gunakan CSV bila offline |

Cari catatan `TROUBLESHOOT:` di kode (Ctrl+Shift+F) untuk petunjuk per modul.
