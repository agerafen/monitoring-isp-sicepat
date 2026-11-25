/*
 * config.js - Konfigurasi & konstanta aplikasi. Semua modul memakai namespace global `App`.
 *
 * Bagian dari : fondasi aplikasi (dipakai semua fitur: pendataan gerai, jaringan, import/export).
 * Dependensi  : tidak ada (file ini membuat `window.App` bila belum ada).
 * Diekspos    : `App.config` (objek konstanta, hanya dibaca oleh modul lain).
 *
 * TROUBLESHOOT: file ini HARUS dimuat paling awal di index.html. Bila muncul error
 * "Cannot read properties of undefined (reading 'config')" atau "App is not defined",
 * periksa urutan tag <script> di index.html.
 */
window.App = window.App || {};

// Namespace penyimpanan opsional lewat URL: index.html?ns=nama -> semua key localStorage diberi akhiran ".nama".
// Dipakai tes otomatis dan "sandbox" tim agar tidak menyentuh data/akun asli. Tanpa ?ns= nilainya kosong
// (perilaku normal). Hanya huruf/angka/_/- (maks 20 karakter) yang diterima.
const STORAGE_NS = (function () {
  try {
    const v = new URLSearchParams(window.location.search).get('ns');
    return v && /^[a-z0-9_-]{1,20}$/i.test(v) ? '.' + v : '';
  } catch (e) {
    return '';
  }
})();

App.config = {
  // Key localStorage data gerai. Mengubah nilai ini membuat data lama "hilang" (tersimpan di key lama).
  // TROUBLESHOOT: data tiba-tiba kosong -> cek apakah key ini berubah; lihat DevTools > Application > Local Storage.
  storageKey: 'isp-pendataan-v1' + STORAGE_NS,
  // Key lain yang memakai namespace yang sama: akun, sesi, penghitung percobaan login, dan penanda data awal.
  authKeys: { account: 'isp-auth-v1' + STORAGE_NS, session: 'isp-session-v1' + STORAGE_NS, lock: 'isp-auth-lock' + STORAGE_NS },
  seedFlagKey: 'isp-seeded-v1' + STORAGE_NS,
  // Daftar vendor yang valid (dipakai dropdown, validasi, dan statistik per vendor).
  // Vendor di luar daftar ini tetap tersimpan, tetapi tidak muncul di agregat byVendor bawaan.
  vendors: ['Satu ID', 'Astinet', 'HSI', 'ATS', 'Moratel', 'HSP', 'Fiberstart'],
  // Nilai status gerai yang diizinkan (selain ini akan dinormalisasi jadi 'Active').
  statuses: ['Active', 'Inactive'],
  // Nilai remark yang diizinkan (selain ini akan dinormalisasi jadi 'Existing').
  remarks: ['Existing', 'Takeout'],
  // Nama bulan singkat; urutan index 0-11 = Januari-Desember (sama dengan index array payments).
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
  // Nama bulan lengkap, urutan sama dengan `months`.
  monthsLong: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
  // Key localStorage untuk data jaringan (fitur terpisah dari data gerai).
  netStorageKey: 'isp-network-v1' + STORAGE_NS,
  // Pilihan fungsi perangkat jaringan.
  netFunctions: ['LM', 'LM + FM'],
  // Pilihan rasio (mis. rasio splitter/bandwidth).
  netRatios: ['1:1', '1:2', '1:4', '1:8'],
  // Status gerai pada Data Network (urutan = urutan di dropdown). Nilai pertama adalah bawaan untuk data baru/lama
  // yang belum punya status. Nilai lain di luar daftar ditolak saat validasi/impor.
  netStatuses: ['Aktif', 'Terminated', 'Merger'],
  // Opsi jumlah baris per halaman; elemen pertama jadi default paginasi.
  pageSizes: [10, 25, 50, 100],
  // Batas hari: sisa sewa <= angka ini dianggap "segera berakhir" (peringatan di dashboard).
  expiryWarnDays: 30,
  // Batas panjang teks per kolom. Dipakai normalize() di store/net-store (memotong teks berlebih dari impor
  // atau data rusak) dan menjadi acuan atribut maxlength di index.html. Ubah keduanya bersamaan.
  limits: { kode: 50, nama: 150, alamat: 500, catatan: 200, teks: 80, ip: 50 },
  // Batas keamanan impor: file lebih besar / baris lebih banyak dari ini ditolak dengan pesan jelas
  // (mencegah browser membeku atau penyimpanan lokal penuh akibat file tak sengaja terlalu besar).
  maxImportBytes: 10 * 1024 * 1024,
  maxImportRows: 20000
};
