/*
 * store.js - State aplikasi: data gerai, filter, sort, paginasi, dan operasi CRUD.
 *
 * Bagian dari : fitur pendataan gerai (tabel, dashboard, pembayaran bulanan).
 * Dependensi  : App.storage, App.utils, App.config (harus dimuat sebelum file ini; mereka
 *               didestrukturisasi saat file dimuat, jadi urutan <script> menentukan).
 * Diekspos    : `App.store` = { state, init, all, find, add, update, remove, addMany, replaceAll,
 *               isDuplicate, filtered, view, stats, expiringList, paymentStats, years, yearPayments }.
 *
 * Bentuk record: { id, kodeInduk, po, namaGerai, alamat, akhirSewa('YYYY-MM-DD'|''), status, idPelanggan,
 *   vendor, remark, catatan, payments: { '2025': [12 angka|null], ... } }.
 *
 * TROUBLESHOOT: perubahan tidak bertahan setelah reload -> operasi tulis me-return hasil
 * storage.save ({ok:false,error}); pastikan pemanggil (UI) memeriksa `ok` dan menampilkan pesannya. Bila simpan
 * gagal, applyChange() otomatis membatalkan perubahan di memori (tabel tidak menampilkan data yang tidak tersimpan).
 * Key localStorage ada di App.config.storageKey.
 */
App.store = (function () {
  const { storage, utils, config } = App;

  // ---------- State ----------

  // Seluruh record di memori (sumber kebenaran selama sesi; disalin ke localStorage lewat commit()).
  let records = [];
  // State tampilan: filter, urutan, halaman, dan tahun pembayaran aktif.
  // `year` berupa string (key objek payments); `page` otomatis dikoreksi di view().
  const state = {
    query: '',
    vendor: '',
    status: '',
    remark: '',
    year: String(new Date().getFullYear()),
    sort: { key: 'namaGerai', dir: 'asc' },
    page: 1,
    pageSize: config.pageSizes[0]
  };

  // ---------- Normalisasi & persistensi ----------

  /**
   * Rapikan satu record (dari storage / import) agar bentuknya selalu konsisten.
   * Aturan: teks di-trim; akhirSewa tidak valid -> ''; status/remark di luar daftar config -> default
   * 'Active'/'Existing'; id kosong -> dibuat baru; payments disaring jadi 12 slot angka >= 0 atau null.
   * TROUBLESHOOT: nilai import "hilang" atau berubah ke default -> kemungkinan ejaan status/remark
   * tidak persis sama dengan config (case-sensitive) atau tanggal bukan format YYYY-MM-DD.
   */
  function normalize(r) {
    // Hanya tahun yang ada di data asli yang dibawa; tiap tahun dipaksa menjadi array 12 slot.
    const payments = {};
    const L = config.limits;
    // Teks dipangkas ke batas panjang kolom (lihat config.limits) agar data aneh tidak menggembungkan tampilan/penyimpanan.
    const clip = (v, n) => utils.normalizeText(v).slice(0, n);
    if (r && r.payments && typeof r.payments === 'object') {
      Object.keys(r.payments).forEach((year) => {
        // Hanya kunci tahun 4 digit yang diterima; kunci lain (mis. '__proto__') diabaikan demi keamanan.
        if (!/^\d{4}$/.test(year)) return;
        const arr = Array.isArray(r.payments[year]) ? r.payments[year] : [];
        payments[year] = utils.emptyPayments().map((_, i) => {
          const v = arr[i];
          return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
        });
      });
    }
    return {
      id: r && r.id ? String(r.id) : utils.uid(),
      kodeInduk: clip(r && r.kodeInduk, L.kode),
      po: clip(r && r.po, L.kode),
      namaGerai: clip(r && r.namaGerai, L.nama),
      alamat: clip(r && r.alamat, L.alamat),
      akhirSewa: utils.parseDate(r && r.akhirSewa) ? utils.normalizeText(r.akhirSewa) : '',
      status: config.statuses.includes(r && r.status) ? r.status : 'Active',
      idPelanggan: clip(r && r.idPelanggan, L.kode),
      vendor: clip(r && r.vendor, L.teks),
      remark: config.remarks.includes(r && r.remark) ? r.remark : 'Existing',
      catatan: clip(r && r.catatan, L.catatan),
      payments
    };
  }

  // Muat data dari localStorage ke memori (dipanggil sekali saat aplikasi mulai).
  // Mengembalikan hasil storage.load apa adanya agar UI bisa menampilkan error baca.
  function init() {
    const res = storage.load();
    // Elemen yang bukan objek (null, angka, teks, array) dibuang: data rusak tidak boleh jadi baris kosong di tabel.
    records = res.data.filter(utils.isPlainObject).map(normalize);
    return res;
  }

  // Tulis seluruh record ke localStorage. Dipanggil setelah setiap perubahan data.
  // Return { ok, error? } dari storage.save.
  function commit() {
    return storage.save(records);
  }

  // Terapkan perubahan data secara atomik: `next` menjadi data aktif, lalu disimpan. Jika penyimpanan GAGAL
  // (kuota penuh / storage diblokir) data dikembalikan ke kondisi sebelumnya, sehingga tampilan tidak pernah
  // menampilkan data yang sebenarnya tidak tersimpan. Semua operasi tulis di bawah wajib lewat fungsi ini
  // dan tidak boleh mengubah array `records` di tempat (push/splice), agar rollback tetap benar.
  function applyChange(next) {
    const prev = records;
    records = next;
    const res = commit();
    if (!res.ok) records = prev;
    return res;
  }

  // ---------- Akses data ----------

  // Salinan dangkal array record (mengubah array hasil tidak memengaruhi store; objek record tetap sama).
  function all() { return records.slice(); }
  // Cari record berdasarkan id; null bila tidak ada.
  function find(id) { return records.find((r) => r.id === id) || null; }
  // Array 12 pembayaran untuk tahun tertentu; bila tahun belum ada, array kosong baru (tidak disimpan).
  function yearPayments(r, year) { return (r.payments && r.payments[year]) || utils.emptyPayments(); }

  // ---------- CRUD (semua me-return hasil commit: {ok, error?}) ----------

  // Tambah satu record baru; id selalu dibuat baru (id dari input diabaikan).
  function add(data) {
    const rec = normalize(Object.assign({}, data, { id: utils.uid() }));
    return applyChange(records.concat([rec]));
  }

  // Ganti seluruh isi record ber-id tertentu dengan `data` (bukan merge; field yang hilang jadi default).
  // Id tidak ditemukan -> { ok:false, error } tanpa menyimpan.
  function update(id, data) {
    const i = records.findIndex((r) => r.id === id);
    if (i < 0) return { ok: false, error: 'Data tidak ditemukan.' };
    const next = records.slice();
    next[i] = normalize(Object.assign({}, data, { id }));
    return applyChange(next);
  }

  // Hapus record ber-id tertentu; id tidak ditemukan -> { ok:false, error }.
  function remove(id) {
    const next = records.filter((r) => r.id !== id);
    if (next.length === records.length) return { ok: false, error: 'Data tidak ditemukan.' };
    return applyChange(next);
  }

  // Tambahkan banyak record sekaligus (mode import "gabung"); id baru dibuat untuk setiap baris,
  // lalu satu kali commit. Tidak memeriksa duplikat (lakukan sebelumnya via isDuplicate).
  function addMany(list) {
    return applyChange(records.concat(list.map((r) => normalize(Object.assign({}, r, { id: utils.uid() })))));
  }

  // Ganti SELURUH data dengan `list` (mode import "timpa" / restore backup). Id lama dipertahankan
  // bila ada. Data sebelumnya hilang permanen setelah commit berhasil.
  function replaceAll(list) {
    return applyChange(list.map(normalize));
  }

  // ---------- Duplikat ----------

  /**
   * True bila kombinasi vendor + ID pelanggan + nama gerai sudah ada di record lain.
   * Aturan duplikat: ketiganya dibandingkan tanpa peduli besar-kecil huruf. `ignoreId` = id record
   * yang sedang diedit (agar tidak bentrok dengan dirinya sendiri). Argumen harus string (bukan null).
   */
  function isDuplicate(vendor, idPelanggan, namaGerai, ignoreId) {
    const v = vendor.toLowerCase();
    const p = idPelanggan.toLowerCase();
    const n = namaGerai.toLowerCase();
    return records.some((r) => r.id !== ignoreId && r.vendor.toLowerCase() === v && r.idPelanggan.toLowerCase() === p && r.namaGerai.toLowerCase() === n);
  }

  /**
   * Indeks duplikat untuk impor massal: dibangun SEKALI (O(n)) lalu has()/add() berjalan O(1).
   * Memakai isDuplicate per baris membuat impor ribuan baris menjadi O(n^2) dan terasa membeku.
   * Aturan kuncinya sama dengan isDuplicate (vendor + ID pelanggan + nama gerai, tanpa peduli huruf besar-kecil).
   */
  function duplicateIndex() {
    const key = (v, p, n) => (v + '|' + p + '|' + n).toLowerCase();
    const set = new Set(records.map((r) => key(r.vendor, r.idPelanggan, r.namaGerai)));
    return {
      has: (v, p, n) => set.has(key(v, p, n)),
      add: (v, p, n) => { set.add(key(v, p, n)); }
    };
  }

  // ---------- Filter, sort, paginasi ----------

  // Nilai pembanding untuk sort. 'sisa' = sisa hari sewa (tanpa tanggal -> Infinity, selalu di ujung
  // saat asc); 'total' = jumlah pembayaran tahun terpilih; lainnya = teks huruf kecil dari field.
  // Key kolom baru di tabel harus cocok dengan nama field record atau ditambahkan di sini.
  function sortValue(r, key) {
    switch (key) {
      case 'sisa': {
        const d = utils.daysRemaining(r.akhirSewa);
        return d === null ? Infinity : d;
      }
      case 'total': return utils.sumPayments(yearPayments(r, state.year));
      default: return String(r[key] || '').toLowerCase();
    }
  }

  // Daftar record setelah filter (vendor, status, remark, pencarian teks) dan sort (state.sort).
  // Pencarian = substring tanpa peduli huruf pada gabungan 7 field teks. Seluruh hasil (belum dipaginasi).
  function filtered() {
    const q = state.query.toLowerCase();
    const list = records.filter((r) => {
      if (state.vendor && r.vendor !== state.vendor) return false;
      if (state.status && r.status !== state.status) return false;
      if (state.remark && r.remark !== state.remark) return false;
      if (!q) return true;
      return [r.kodeInduk, r.po, r.namaGerai, r.alamat, r.idPelanggan, r.vendor, r.catatan].join(' ').toLowerCase().includes(q);
    });
    const { key, dir } = state.sort;
    const mul = dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = sortValue(a, key);
      const y = sortValue(b, key);
      if (x === y) return 0;
      return (x > y ? 1 : -1) * mul;
    });
  }

  /**
   * Data halaman aktif + metadata paginasi.
   * Efek samping: state.page dikoreksi ke rentang 1..pages (mis. setelah filter mengecilkan hasil).
   * Return: { rows, total (hasil filter), totalAll (semua), page, pages, start (offset 0-based) }.
   */
  function view() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / state.pageSize));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;
    const start = (state.page - 1) * state.pageSize;
    return { rows: list.slice(start, start + state.pageSize), total: list.length, totalAll: records.length, page: state.page, pages, start };
  }

  // ---------- Statistik (dashboard) ----------

  /**
   * Ringkasan untuk kartu dashboard. Hitung status/remark semua record; sebaran masa sewa hanya
   * untuk gerai Active: noDate (tanpa tanggal), expired (<0 hari), soon (0..expiryWarnDays),
   * mid (sampai 90 hari), long (>90 hari). `expiring` = Active dengan sisa <= batas (termasuk expired).
   * `payment` = total bayar tahun state.year; byVendor menghitung jumlah gerai per vendor.
   * TROUBLESHOOT: angka kartu tidak cocok dengan tabel -> tabel memakai filter, stats() memakai semua record.
   */
  function stats() {
    const warn = config.expiryWarnDays;
    const s = { total: records.length, active: 0, inactive: 0, existing: 0, takeout: 0, expiring: 0, expired: 0, soon: 0, mid: 0, long: 0, noDate: 0, payment: 0, byVendor: {} };
    config.vendors.forEach((v) => { s.byVendor[v] = 0; });
    records.forEach((r) => {
      if (r.status === 'Active') s.active++; else s.inactive++;
      if (r.remark === 'Takeout') s.takeout++; else s.existing++;
      const d = utils.daysRemaining(r.akhirSewa);
      if (r.status === 'Active') {
        // Sebaran masa sewa gerai Active
        if (d === null) s.noDate++;
        else if (d < 0) s.expired++;
        else if (d <= warn) s.soon++;
        // 90 = batas hari (angka tetap) untuk kategori "menengah"; tidak diambil dari config.
        else if (d <= 90) s.mid++;
        else s.long++;
      }
      if (r.status === 'Active' && d !== null && d <= warn) s.expiring++;
      s.payment += utils.sumPayments(yearPayments(r, state.year));
      s.byVendor[r.vendor] = (s.byVendor[r.vendor] || 0) + 1;
    });
    return s;
  }

  /**
   * Gerai Active dengan sisa sewa <= batas peringatan, urut dari yang paling mendesak.
   * Return { total (semua yang cocok), items (dipotong `limit`, tiap item { rec, days }) }.
   */
  function expiringList(limit) {
    const items = records
      .filter((r) => r.status === 'Active')
      .map((r) => ({ rec: r, days: utils.daysRemaining(r.akhirSewa) }))
      .filter((x) => x.days !== null && x.days <= config.expiryWarnDays)
      .sort((a, b) => a.days - b.days);
    return { total: items.length, items: items.slice(0, limit) };
  }

  /**
   * Agregat pembayaran tahun terpilih: per vendor per bulan, total bulanan, dan gerai Active yang sudah bayar.
   * Semua array berindeks bulan 0-11. Vendor di luar config.vendors tetap masuk monthTotals/grandTotal
   * tetapi tidak muncul di byVendor/vendorTotals. "Sudah bayar" = nominal > 0 pada gerai Active.
   */
  function paymentStats() {
    const byVendor = {};
    config.vendors.forEach((v) => { byVendor[v] = utils.emptyPayments().map(() => 0); });
    const monthTotals = utils.emptyPayments().map(() => 0);
    const paidActive = utils.emptyPayments().map(() => 0);
    let activeCount = 0;
    records.forEach((r) => {
      const isActive = r.status === 'Active';
      if (isActive) activeCount++;
      yearPayments(r, state.year).forEach((v, i) => {
        if (typeof v !== 'number') return;
        if (byVendor[r.vendor]) byVendor[r.vendor][i] += v;
        monthTotals[i] += v;
        if (isActive && v > 0) paidActive[i]++;
      });
    });
    const vendorTotals = config.vendors.map((v) => ({ vendor: v, total: utils.sumPayments(byVendor[v]) }));
    return { byVendor, vendorTotals, monthTotals, grandTotal: utils.sumPayments(monthTotals), paidActive, activeCount };
  }

  /**
   * Daftar tahun untuk dropdown: tahun berjalan ±2 ditambah tahun yang ada di data.
   * Hanya key payments berformat 4 digit yang dipakai. Return array string terurut naik.
   */
  function years() {
    const cur = new Date().getFullYear();
    const set = new Set([cur - 2, cur - 1, cur, cur + 1, cur + 2]);
    records.forEach((r) => Object.keys(r.payments).forEach((y) => { if (/^\d{4}$/.test(y)) set.add(Number(y)); }));
    return Array.from(set).sort((a, b) => a - b).map(String);
  }

  // API publik App.store.
  return { state, init, all, find, add, update, remove, addMany, replaceAll, isDuplicate, duplicateIndex, filtered, view, stats, expiringList, paymentStats, years, yearPayments };
})();
