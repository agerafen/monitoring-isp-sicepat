/*
 * utils.js - Fungsi bantu murni (tanpa akses DOM / storage).
 *
 * Bagian dari : fondasi aplikasi (format angka/rupiah, tanggal, parsing nominal, debounce).
 * Dependensi  : tidak ada modul App lain (hanya `window.App` dari config.js harus sudah ada).
 * Diekspos    : `App.utils` = { formatCompact, formatPercent, escapeHtml, formatNumber,
 *               formatRupiah, uid, parseDate, toIsoDate, daysRemaining, addDays,
 *               emptyPayments, parseAmount, sumPayments, normalizeText, debounce }.
 *
 * TROUBLESHOOT: "App.utils.xxx is not a function" -> nama fungsi belum masuk objek return di
 * akhir IIFE, atau utils.js dimuat setelah file yang memakainya (cek urutan <script> di index.html).
 */
App.utils = (function () {
  // Formatter angka locale Indonesia: pemisah ribuan titik (1.250.000).
  const rupiahFmt = new Intl.NumberFormat('id-ID');

  // ---------- Format tampilan ----------

  // Escape karakter HTML agar aman disisipkan lewat innerHTML (cegah XSS / tampilan rusak).
  // null/undefined menjadi string kosong. Wajib dipakai untuk semua teks input pengguna.
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Angka dengan pemisah ribuan titik, tanpa awalan "Rp".
  function formatNumber(n) {
    return rupiahFmt.format(n);
  }

  // Angka dengan awalan "Rp " (mis. "Rp 1.250.000").
  function formatRupiah(n) {
    return 'Rp ' + rupiahFmt.format(n);
  }

  /**
   * 356113452 -> "356,1 jt"; 1768816827 -> "1,77 M" (miliar).
   * Ambang: >=1e9 miliar (M, 2 desimal), >=1e6 juta (jt, 1 desimal), >=1e3 ribu (rb, 0 desimal).
   */
  function formatCompact(n) {
    const abs = Math.abs(n);
    // fmt: bulatkan ke d desimal; tanda plus (+) membuang nol di belakang, lalu titik jadi koma ID.
    const fmt = (v, d) => String(+v.toFixed(d)).replace('.', ',');
    if (abs >= 1e9) return fmt(n / 1e9, 2) + ' M';
    if (abs >= 1e6) return fmt(n / 1e6, 1) + ' jt';
    if (abs >= 1e3) return fmt(n / 1e3, 0) + ' rb';
    return String(Math.round(n));
  }

  /** 0.3456 (rasio) -> "34,6%". */
  function formatPercent(ratio) {
    return (ratio * 100).toFixed(1).replace('.', ',') + '%';
  }

  // ---------- ID unik ----------

  // ID record baru: awalan 'r' + timestamp base36 + 6 karakter acak. Cukup unik untuk skala lokal.
  function uid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Tanggal ----------

  /**
   * Parse 'YYYY-MM-DD' ke Date lokal (tengah malam). Return null bila tidak valid.
   * Pemeriksaan "valid" membandingkan ulang tahun/bulan/hari, karena Date menggulung
   * tanggal mustahil (mis. 2025-02-31 jadi Maret) tanpa error.
   * TROUBLESHOOT: akhirSewa dianggap kosong / sisa hari "-" -> pastikan format persis YYYY-MM-DD.
   */
  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const valid = d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
    return valid ? d : null;
  }

  // Date -> 'YYYY-MM-DD' memakai komponen LOKAL (bukan toISOString yang UTC, bisa mundur sehari).
  function toIsoDate(date) {
    const p = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
  }

  /**
   * Selisih hari dari hari ini ke tanggal akhir sewa. Null bila tanggal kosong/tidak valid.
   * Negatif = sudah lewat (expired). 86400000 = jumlah milidetik per hari;
   * Math.round meredam selisih jam akibat perubahan DST.
   */
  function daysRemaining(isoDate) {
    const end = parseDate(isoDate);
    if (!end) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((end - today) / 86400000);
  }

  // Tanggal hari ini + `days` hari (boleh negatif) dalam format 'YYYY-MM-DD'.
  function addDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return toIsoDate(d);
  }

  // ---------- Pembayaran & teks ----------

  // Array pembayaran setahun: 12 slot (Jan-Des), null = belum ada data bayar.
  function emptyPayments() {
    return new Array(12).fill(null);
  }

  /**
   * Ubah input bebas menjadi angka >= 0 atau null (kosong). NaN -> undefined (tidak valid).
   * Tiga hasil berbeda: null = kosong (sah), undefined = tidak valid, number = nominal.
   * Pemanggil harus membedakan null dan undefined (jangan pakai `!value`).
   */
  function parseAmount(value) {
    if (value === null || value === undefined) return null;
    // Buang "Rp" (huruf R/p, tak peduli besar-kecil) dan semua spasi.
    const s = String(value).trim().replace(/[Rp\s]/gi, '');
    if (s === '') return null;
    // Regex: pola ribuan ID (1-3 digit lalu kelompok ".ddd", opsional ",desimal") -> hapus titik, koma jadi titik.
    // Selain itu koma dianggap desimal. TROUBLESHOOT: "1.500" dibaca 1500 (titik = ribuan), sedangkan "1.5" dibaca 1,5 (desimal).
    // "1.250.000" (format ID) atau "1250000" atau "1250000.50"
    const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  // Jumlahkan array pembayaran; hanya elemen bertipe number yang dihitung (null/teks diabaikan).
  function sumPayments(arr) {
    return (arr || []).reduce((t, v) => t + (typeof v === 'number' && isFinite(v) ? v : 0), 0);
  }

  // True hanya untuk objek biasa ({...}); false untuk null, angka, teks, boolean, dan array.
  // Dipakai memfilter isi penyimpanan yang rusak/tidak sesuai sebelum dinormalisasi.
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // Nilai apa pun -> string ter-trim; null/undefined jadi ''.
  function normalizeText(v) {
    return String(v == null ? '' : v).trim();
  }

  // ---------- Kontrol event ----------

  // Tunda pemanggilan fn sampai `ms` ms tanpa panggilan baru (dipakai mis. kotak pencarian).
  // Hanya panggilan terakhir yang dieksekusi; nilai return fn tidak diteruskan.
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  // API publik App.utils; fungsi baru harus didaftarkan di sini agar bisa dipakai modul lain.
  return { isPlainObject, formatCompact, formatPercent, escapeHtml, formatNumber, formatRupiah, uid, parseDate, toIsoDate, daysRemaining, addDays, emptyPayments, parseAmount, sumPayments, normalizeText, debounce };
})();
