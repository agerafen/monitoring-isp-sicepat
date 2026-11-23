/* Titik masuk: menghubungkan state, tampilan, dan event. */
/*
 * app.js
 * Tujuan   : perekat aplikasi: mengikat event DOM ke store, merender ulang semua tampilan, impor/ekspor,
 *            hapus data, dan memuat data awal. Dimuat PALING AKHIR (setelah semua modul App.*).
 * Dependensi: App.store, config, utils, table, summary, form, csv, toast, sample (di-destructure di bawah,
 *            jadi harus sudah ada saat file ini dieksekusi), serta App.charts, nav, network, theme, excel,
 *            authUi, seedData (diakses saat dipakai).
 * Diekspos : tidak ada (IIFE tanpa return); satu-satunya efek: mendaftarkan DOMContentLoaded -> authUi.gate(start).
 *
 * Alur start: DOMContentLoaded -> App.authUi.gate(start) -> (login/sesi valid) -> start(): isi opsi statis,
 *   store.init, form.init, tooltip grafik, network/nav/theme init, bindEvents, syncControls, render, auto-seed.
 *
 * TROUBLESHOOT: halaman kosong / tidak ada yang terjadi -> buka console. "App.xxx is undefined" atau
 *   "Cannot destructure" = urutan <script> di index.html salah (modul yang dipakai belum dimuat, atau
 *   data-awal.js/app.js tidak paling akhir). Layar login tidak muncul -> lihat ui-auth.js (gate). Login berhasil
 *   tetapi aplikasi kosong -> error di dalam start() (id elemen hilang) menghentikan sisa inisialisasi.
 *   Data tidak berubah setelah aksi -> pastikan perubahan state diikuti render().
 */
(function () {
  const { store, config, utils, table, summary, form, csv, toast, sample } = App;
  const $ = (id) => document.getElementById(id);
  // Id gerai yang menunggu konfirmasi hapus di dialog #deleteDialog (null = tidak ada).
  let pendingDeleteId = null;

  // ---------- Pengaman error ----------

  // Waktu (ms) pesan error terakhir ditampilkan; dipakai membatasi toast agar tidak membanjiri layar.
  let lastErrorAt = 0;

  /** Tampilkan pesan error ke pengguna (maksimal sekali tiap 4 detik) dan catat detailnya di console. */
  function notifyError(message) {
    const now = Date.now();
    if (now - lastErrorAt < 4000) return;
    lastErrorAt = now;
    toast.error(message + ' Muat ulang halaman bila tampilan tidak normal; data Anda tidak terhapus.');
  }

  // Jaring pengaman terakhir: error yang lolos dari semua try/catch tidak lagi diam-diam; pengguna diberi tahu.
  // TROUBLESHOOT: sering muncul toast ini -> buka Console (F12) untuk melihat error aslinya (nama file + baris).
  window.addEventListener('error', (e) => { notifyError('Terjadi kesalahan: ' + (e.message || 'tidak diketahui') + '.'); });
  window.addEventListener('unhandledrejection', (e) => {
    notifyError('Terjadi kesalahan: ' + ((e.reason && e.reason.message) || e.reason || 'tidak diketahui') + '.');
  });

  // ---------- Render & sinkronisasi kontrol ----------

  /**
   * Menjalankan satu bagian tampilan secara terisolasi: bila melempar error, bagian lain tetap dirender
   * (tidak blank/crash total) dan pengguna diberi tahu bagian mana yang gagal.
   */
  function safeRun(name, fn) {
    try { fn(); } catch (err) {
      console.error('[render:' + name + ']', err);
      notifyError('Bagian "' + name + '" gagal ditampilkan (' + err.message + ').');
    }
  }

  /** Merender ulang semua tampilan dari state store (dashboard, tabel, rekap, lencana jumlah di menu). */
  function render() {
    safeRun('Ringkasan', () => summary.render());
    safeRun('Data Gerai', () => table.render());
    safeRun('Grafik & Rekap', () => App.charts.render());
    safeRun('Menu', () => App.nav.setCount(store.all().length));
  }

  /** Menyamakan nilai kontrol filter/pencarian/ukuran halaman/tahun di DOM dengan store.state (setelah state diubah lewat kode). */
  function syncControls() {
    const s = store.state;
    $('searchInput').value = s.query;
    $('filterStatus').value = s.status;
    $('filterRemark').value = s.remark;
    $('filterVendor').value = s.vendor;
    $('pageSize').value = String(s.pageSize);
    renderYearOptions();
  }

  /** Mengisi dropdown #yearSelect dari store.years() dan memilih tahun aktif (state.year). */
  function renderYearOptions() {
    $('yearSelect').innerHTML = store.years().map((y) => '<option value="' + y + '"' + (y === store.state.year ? ' selected' : '') + '>' + y + '</option>').join('');
  }

  /** Mengisi opsi dropdown yang tetap (status, remark, vendor, ukuran halaman) dari App.config. Dipanggil sekali di start(). */
  function fillStaticOptions() {
    const opt = (list, first) => '<option value="">' + first + '</option>' + list.map((v) => '<option value="' + utils.escapeHtml(v) + '">' + utils.escapeHtml(v) + '</option>').join('');
    $('filterStatus').innerHTML = opt(config.statuses, 'Semua status');
    $('filterRemark').innerHTML = opt(config.remarks, 'Semua remark');
    $('filterVendor').innerHTML = opt(config.vendors, 'Semua vendor');
    $('pageSize').innerHTML = config.pageSizes.map((n) => '<option value="' + n + '">' + n + ' / halaman</option>').join('');
  }

  // ---------- Filter ----------

  /** Menetapkan satu filter di state (query/status/remark/vendor), kembali ke halaman 1, lalu render. */
  function setFilter(key, value) {
    store.state[key] = value;
    store.state.page = 1;
    render();
  }

  /** Mengosongkan semua filter (tahun & urutan tidak ikut direset), sinkronkan kontrol, render. */
  function resetFilters() {
    Object.assign(store.state, { query: '', vendor: '', status: '', remark: '', page: 1 });
    syncControls();
    render();
  }

  // ---------- Data awal & data contoh ----------

  /** Menampilkan toast error bila hasil penyimpanan store gagal ({ok:false,error}); mengembalikan res.ok. */
  function reportSave(res) {
    if (!res.ok) toast.error(res.error);
    return res.ok;
  }

  // localStorage key penanda data awal sudah pernah dimuat (agar tidak dimuat ulang setelah pengguna mengosongkan data).
  const SEED_FLAG = config.seedFlagKey;

  /**
   * Muat data awal dari Internet.xlsx (js/data/data-awal.js). Otomatis hanya sekali, saat data masih kosong.
   * auto=true: diam bila seed tidak ada; auto=false (tombol manual): tampilkan toast error. Efek samping:
   * menambah record ke store, set SEED_FLAG, mengganti tahun aktif ke seed.year, render.
   * TROUBLESHOOT: data awal tidak muncul -> App.seedData kosong (js/data/data-awal.js belum dimuat/dibuat via
   *   tools\convert-xlsx.ps1), atau key 'isp-seeded-v1' sudah ada (hapus dari localStorage lalu muat ulang).
   */
  function loadSeed(auto) {
    const seed = App.seedData;
    if (!seed || !Array.isArray(seed.records) || !seed.records.length) {
      if (!auto) toast.error('Data awal tidak ditemukan. Jalankan tools\\convert-xlsx.ps1 atau gunakan Impor Excel.');
      return;
    }
    if (reportSave(store.addMany(seed.records))) {
      try { window.localStorage.setItem(SEED_FLAG, '1'); } catch (e) { /* abaikan */ }
      store.state.year = seed.year || store.state.year;
      toast.success(seed.records.length + ' gerai dimuat dari ' + seed.source + ' (pembayaran tahun ' + store.state.year + ').');
      syncControls();
      render();
    }
  }

  /** True bila data masih kosong dan seed belum pernah dimuat (SEED_FLAG belum ada). Storage terblokir -> false. */
  function shouldAutoSeed() {
    if (store.all().length > 0) return false;
    try { return !window.localStorage.getItem(SEED_FLAG); } catch (e) { return false; }
  }

  /** Menambahkan data contoh buatan sample.build() (tombol "data contoh" di tabel kosong). */
  function loadSample() {
    if (reportSave(store.addMany(sample.build()))) {
      toast.success('Data contoh dimuat.');
      syncControls();
      render();
    }
  }

  // ---------- Hapus, impor, ekspor ----------

  /** Membuka dialog konfirmasi hapus untuk gerai id; penghapusan sebenarnya di handler #deleteConfirm (bindEvents). */
  function confirmDelete(id) {
    const rec = store.find(id);
    if (!rec) { toast.error('Data tidak ditemukan.'); return; }
    pendingDeleteId = id;
    $('deleteName').textContent = rec.namaGerai + ' (' + rec.vendor + ' – ' + rec.idPelanggan + ')';
    $('deleteDialog').showModal();
  }

  /**
   * Impor file .xlsx/.xls (via App.excel, butuh pustaka SheetJS dari CDN) atau .csv/.txt (via csv.importText)
   * ke tahun yang sedang dipilih. Baris valid ditambahkan; error validasi ditampilkan (maks 4 baris + ringkasan).
   * TROUBLESHOOT: impor Excel gagal -> skrip SheetJS (cdnjs) tidak termuat (offline/diblokir); gunakan CSV.
   */
  function handleImport(file) {
    if (!file) return;
    const isExcel = /\.xlsx?$/i.test(file.name);
    if (!isExcel && !/\.(csv|txt)$/i.test(file.name)) { toast.error('Format file harus .xlsx, .xls, atau .csv'); return; }
    if (file.size > config.maxImportBytes) { toast.error('File terlalu besar (' + Math.round(file.size / 1048576) + ' MB). Maksimal ' + Math.round(config.maxImportBytes / 1048576) + ' MB.'); return; }
    const reader = new FileReader();
    reader.onerror = () => toast.error('File tidak dapat dibaca.');
    reader.onload = () => {
      let result;
      try {
        result = isExcel ? App.excel.importBuffer(reader.result, store.state.year) : csv.importText(String(reader.result), store.state.year);
      } catch (err) {
        toast.error('Gagal membaca file: ' + err.message);
        return;
      }
      const { records, errors } = result;
      if (records.length && reportSave(store.addMany(records))) {
        toast.success(records.length + ' baris berhasil diimpor ke tahun ' + store.state.year + '.');
        syncControls();
        render();
      }
      if (errors.length) {
        toast.error(errors.slice(0, 4).join('\n') + (errors.length > 4 ? '\n…dan ' + (errors.length - 4) + ' masalah lain.' : ''));
      }
      if (!records.length && !errors.length) toast.info('Tidak ada data yang diimpor.');
    };
    if (isExcel) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  }

  /**
   * Ekspor data hasil filter (atau template kosong bila templateOnly) sebagai 'xlsx' atau CSV (format lain -> CSV).
   * Nama file: template-pendataan-isp atau pendataan-isp-<tahun>.
   */
  function exportFile(templateOnly, format) {
    const rows = templateOnly ? [] : store.filtered();
    if (!templateOnly && !rows.length) { toast.info('Tidak ada data untuk diekspor.'); return; }
    const base = templateOnly ? 'template-pendataan-isp' : 'pendataan-isp-' + store.state.year;
    try {
      if (format === 'xlsx') App.excel.download(base + '.xlsx', csv.toRows(rows, store.state.year), 'Pendataan ' + store.state.year);
      else csv.download(base + '.csv', csv.toCsv(rows, store.state.year));
    } catch (err) {
      toast.error(err.message);
    }
  }

  // ---------- Pengikatan event ----------

  /**
   * Memasang semua listener DOM sekali (dipanggil dari start()). Memakai delegasi event untuk chip vendor,
   * header tabel (data-sort), dan isi tabel (data-action: edit/delete/add/sample/seed/reset).
   * TROUBLESHOOT: tombol/filter tidak bereaksi -> id elemen di index.html tidak cocok dengan yang dipakai di sini,
   *   atau ada error di satu getElementById sehingga listener setelahnya tidak terpasang.
   */
  function bindEvents() {
    // Pencarian di topbar berlaku global: hasilnya selalu ditampilkan di halaman Data Gerai.
    // Di halaman Data Network pencarian memfilter Data Network; di halaman lain memfilter Data Gerai.
    $('searchInput').addEventListener('input', utils.debounce((e) => {
      const q = e.target.value.trim();
      if (App.nav.current() === 'network') { App.network.setQuery(q); return; }
      if (q && App.nav.current() !== 'data') App.nav.go('data');
      setFilter('query', q);
    }, 200));
    $('filterStatus').addEventListener('change', (e) => setFilter('status', e.target.value));
    $('filterRemark').addEventListener('change', (e) => setFilter('remark', e.target.value));
    $('filterVendor').addEventListener('change', (e) => { setFilter('vendor', e.target.value); });
    $('yearSelect').addEventListener('change', (e) => { store.state.year = e.target.value; render(); });
    $('pageSize').addEventListener('change', (e) => { store.state.pageSize = Number(e.target.value); store.state.page = 1; render(); });
    $('pagePrev').addEventListener('click', () => { store.state.page--; render(); });
    $('pageNext').addEventListener('click', () => { store.state.page++; render(); });

    $('vendorChips').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-vendor]');
      if (!btn) return;
      $('filterVendor').value = btn.dataset.vendor;
      setFilter('vendor', btn.dataset.vendor);
    });

    window.addEventListener('resize', utils.debounce(() => { if (App.nav.current() === 'rekap') App.charts.render(); }, 200));
    $('btnAdd').addEventListener('click', () => form.open(null));
    document.querySelectorAll('[data-file]').forEach((btn) => {
      btn.addEventListener('click', () => {
        exportFile(btn.dataset.file === 'template', btn.dataset.format);
        App.nav.closeMenu();
      });
    });
    $('btnImport').addEventListener('click', () => { App.nav.closeMenu(); $('importFile').click(); });
    $('importFile').addEventListener('change', (e) => { handleImport(e.target.files[0]); e.target.value = ''; });

    $('tableHead').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sort]');
      if (!btn) return;
      const key = btn.dataset.sort;
      const s = store.state.sort;
      store.state.sort = { key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' };
      render();
    });

    $('tableBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === 'edit') form.open(id);
      else if (action === 'delete') confirmDelete(id);
      else if (action === 'add') form.open(null);
      else if (action === 'sample') loadSample();
      else if (action === 'seed') loadSeed(false);
      else if (action === 'reset') resetFilters();
    });

    $('deleteCancel').addEventListener('click', () => $('deleteDialog').close());
    $('deleteConfirm').addEventListener('click', () => {
      if (pendingDeleteId && reportSave(store.remove(pendingDeleteId))) {
        toast.success('Data gerai dihapus.');
        render();
        renderYearOptions();
      }
      pendingDeleteId = null;
      $('deleteDialog').close();
    });

    // Tutup dialog saat klik area backdrop.
    document.querySelectorAll('dialog').forEach((dlg) => {
      dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) dlg.close(); });
    });
  }

  // ---------- Start ----------

  /**
   * Inisialisasi aplikasi; dipanggil sekali oleh gate() setelah login. Urutan penting: opsi statis -> store.init
   * -> form -> tooltip grafik -> network -> nav -> theme -> event -> sinkron kontrol -> render -> auto-seed.
   * Browser tanpa <dialog> mendapat pesan "terlalu lama" dan berhenti.
   */
  function start() {
    if (typeof HTMLDialogElement === 'undefined') {
      document.body.innerHTML = '<p style="padding:2rem">Browser Anda terlalu lama. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru.</p>';
      return;
    }
    fillStaticOptions();
    const res = store.init();
    if (!res.ok) toast.error(res.error);
    form.init(() => { renderYearOptions(); render(); });
    App.charts.bindTooltip();
    App.network.init();
    App.nav.init();
    App.theme.init();
    bindEvents();
    syncControls();
    render();
    if (shouldAutoSeed()) loadSeed(true);
  }

  // Aplikasi baru dijalankan setelah login berhasil (atau sesi masih berlaku).
  document.addEventListener('DOMContentLoaded', () => App.authUi.gate(start));
})();
