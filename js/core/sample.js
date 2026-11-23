/*
 * sample.js - Data contoh (opsional) agar pengguna bisa langsung mencoba fitur.
 *
 * Bagian dari : tombol "muat data contoh" (UI memanggil build() lalu store.addMany/replaceAll).
 * Dependensi  : App.utils (emptyPayments, addDays), App.config (daftar vendor).
 * Diekspos    : `App.sample` = { build } -> array record mentah (tanpa id; id dibuat oleh store).
 *
 * TROUBLESHOOT: tanggal akhir sewa & pembayaran dihitung relatif terhadap HARI INI, jadi isi
 * contoh berubah tiap hari/bulan (itu disengaja). Contoh yang vendor-nya tidak ada di
 * config.vendors otomatis dibuang oleh filter di akhir build().
 */
App.sample = (function () {
  const { utils, config } = App;

  // Buat objek payments { [tahun]: array 12 slot } dari daftar nominal mulai Januari (index 0).
  // Slot setelah panjang `amounts` tetap null.
  function pay(year, amounts) {
    const arr = utils.emptyPayments();
    amounts.forEach((v, i) => { arr[i] = v; });
    return { [year]: arr };
  }

  // Bangun 7 gerai contoh yang mencakup tiap vendor dan kondisi sewa. Variasi akhirSewa
  // (addDays): +240/+300 = aman, +120/+75 = menengah, +18 = segera berakhir, 0 = berakhir hari ini,
  // -12 = sudah lewat. Pembayaran diisi dari Januari sampai bulan berjalan pada tahun berjalan.
  function build() {
    const y = String(new Date().getFullYear());
    const m = new Date().getMonth(); // bulan berjalan (0-11)
    // Array nominal sama (amount) sepanjang Januari..bulan berjalan (m + 1 elemen, karena m berindeks 0).
    const upTo = (amount) => new Array(m + 1).fill(amount);
    // Gerai Medan sengaja Inactive/Takeout dan pembayarannya berhenti 2 bulan lebih awal (slice).
    return [
      { kodeInduk: 'KI-001', po: 'PO-2026-0101', namaGerai: 'Gerai Jakarta Kemang', alamat: 'Jl. Kemang Raya No. 12, Jakarta Selatan', akhirSewa: utils.addDays(240), status: 'Active', idPelanggan: '1200345001', vendor: 'Satu ID', remark: 'Existing', payments: pay(y, upTo(1250000)) },
      { kodeInduk: 'KI-001', po: 'PO-2026-0102', namaGerai: 'Gerai Bandung Dago', alamat: 'Jl. Ir. H. Juanda No. 88, Bandung', akhirSewa: utils.addDays(18), status: 'Active', idPelanggan: '1200345002', vendor: 'Astinet', remark: 'Existing', payments: pay(y, upTo(3400000)) },
      { kodeInduk: 'KI-002', po: 'PO-2026-0115', namaGerai: 'Gerai Surabaya Tunjungan', alamat: 'Jl. Tunjungan No. 5, Surabaya', akhirSewa: utils.addDays(120), status: 'Active', idPelanggan: 'HSI-778812', vendor: 'HSI', remark: 'Existing', payments: pay(y, upTo(850000)) },
      { kodeInduk: 'KI-002', po: 'PO-2025-0877', namaGerai: 'Gerai Medan Sudirman', alamat: 'Jl. Sudirman No. 31, Medan', akhirSewa: utils.addDays(-12), status: 'Inactive', idPelanggan: 'ATS-33410', vendor: 'ATS', remark: 'Takeout', payments: pay(y, upTo(990000).slice(0, Math.max(1, m - 2))) },
      { kodeInduk: 'KI-003', po: 'PO-2026-0230', namaGerai: 'Gerai Makassar Panakkukang', alamat: 'Jl. Boulevard No. 21, Makassar', akhirSewa: utils.addDays(75), status: 'Active', idPelanggan: 'MRT-50021', vendor: 'Moratel', remark: 'Existing', payments: pay(y, upTo(1750000)) },
      { kodeInduk: 'KI-003', po: 'PO-2026-0231', namaGerai: 'Gerai Semarang Simpang Lima', alamat: 'Jl. Pandanaran No. 9, Semarang', akhirSewa: utils.addDays(300), status: 'Active', idPelanggan: 'HSP-90017', vendor: 'HSP', remark: 'Existing', payments: pay(y, upTo(700000)) },
      { kodeInduk: 'KI-004', po: 'PO-2026-0302', namaGerai: 'Gerai Denpasar Teuku Umar', alamat: 'Jl. Teuku Umar No. 140, Denpasar', akhirSewa: utils.addDays(0), status: 'Active', idPelanggan: 'FS-44120', vendor: 'Fiberstart', remark: 'Takeout', payments: pay(y, upTo(650000)) }
    ].filter((r) => config.vendors.includes(r.vendor));
  }

  // API publik App.sample.
  return { build };
})();
