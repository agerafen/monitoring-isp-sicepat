/* Data Network: state, CRUD, filter/sort/paginasi, dan validasi (terpisah dari data gerai/pembayaran).
 *
 * Fitur      : halaman "Data Network" (lapisan data; tampilan ada di ui-network.js).
 * Dependensi : App.storage (load/save localStorage), App.utils (normalizeText, uid),
 *              App.config (netStorageKey, pageSizes, netRatios, vendors).
 * Diekspos   : { FIELDS, state, init, all, find, add, update, remove, addMany, validate,
 *              normalize, normFungsi, normRasio, filtered, view, stats }.
 * Catatan    : semua data ada di variabel `records` (memori) dan disimpan penuh ke localStorage
 *              pada setiap perubahan lewat commit().
 *
 * TROUBLESHOOT: data hilang/tidak tersimpan -> cek key localStorage di config.netStorageKey dan
 * nilai balik { ok, error } dari storage.save (mis. kuota penuh / mode privat).
 */
App.netStore = (function () {
  const { storage, utils, config } = App;
  const KEY = config.netStorageKey;

  /**
   * Kolom Data Network: satu sumber kebenaran untuk tabel, form, ekspor, dan impor.
   * Urutan array = urutan kolom di tabel, file ekspor, dan template; `label` = judul kolom/header Excel.
   * TROUBLESHOOT: menambah/mengubah kolom harus sinkron dengan normalize() di bawah, FORM_IDS & rowHtml()
   * & HEADER_ALIASES di ui-network.js, serta input form di index.html. Jika ada yang terlewat, kolom
   * kosong/bergeser di tabel atau ekspor, atau nilainya tidak terimpor.
   */
  const FIELDS = [
    { key: 'codeAnalytic', label: 'Code Analytic' },
    { key: 'namaGerai', label: 'Nama Gerai' },
    { key: 'fungsi', label: 'Function' },
    { key: 'alamat', label: 'Alamat' },
    { key: 'vendor', label: 'Nama ISP' },
    { key: 'rasio', label: 'Rasio' },
    { key: 'bandwidth', label: 'Bandwidth' },
    { key: 'ssid', label: 'SSID' },
    { key: 'ipGateway', label: 'IP Gateway' },
    { key: 'ipAddress', label: 'IP Address' },
    { key: 'dns', label: 'DNS' },
    { key: 'mikrotikType', label: 'Mikrotik Type' },
    { key: 'snMikrotik', label: 'SN Mikrotik' }
  ];

  // Daftar rekaman Data Network di memori (sumber data tampilan). Diganti utuh oleh remove()/addMany().
  let records = [];
  // State tampilan: kata kunci, filter dropdown, urutan, halaman aktif, dan ukuran halaman.
  // Dibaca/ditulis oleh ui-network.js; page di-clamp otomatis di view().
  const state = { query: '', vendor: '', fungsi: '', rasio: '', sort: { key: 'namaGerai', dir: 'asc' }, page: 1, pageSize: config.pageSizes[0] };

  // ---------- normalisasi ----------
  // Normalisasi Function: hanya dua nilai baku, 'LM' atau 'LM + FM'.
  // Spasi dibuang dan huruf dikecilkan dulu, jadi "lm + fm", "LMFM", "LM&FM" semuanya menjadi 'LM + FM'.
  // Nilai lain -> '' (dianggap belum dipilih; validate() akan menolaknya).
  function normFungsi(v) {
    const s = utils.normalizeText(v).toLowerCase().replace(/\s+/g, '');
    if (s === 'lm') return 'LM';
    if (s === 'lm+fm' || s === 'lmfm' || s === 'lm&fm') return 'LM + FM';
    return '';
  }

  // Normalisasi Rasio: spasi dibuang, "/" dan ";" diganti ":" (mis. "1/4" -> "1:4"), lalu harus
  // ada di config.netRatios. Di luar daftar -> '' (ditolak validate()).
  function normRasio(v) {
    const s = utils.normalizeText(v).replace(/\s+/g, '').replace(/[\/;]/g, ':');
    return config.netRatios.includes(s) ? s : '';
  }

  // Normalisasi DNS: pisah berdasarkan spasi/koma/titik-koma, lalu gabung ulang dengan ", ".
  // validate() memecahnya lagi lewat split(', '), jadi pemisah ini harus tetap konsisten.
  function normDns(v) {
    return utils.normalizeText(v).split(/[\s,;]+/).filter(Boolean).join(', ');
  }

  // Mengubah objek mentah (form/impor/localStorage lama) menjadi rekaman bersih dengan semua kolom FIELDS.
  // Memberi id baru (utils.uid) bila belum ada; field yang hilang menjadi ''. Aman dipanggil dengan null.
  function normalize(r) {
    const L = config.limits;
    // t(k, n): teks field k di-trim lalu dipangkas ke n karakter (batas ada di config.limits).
    const t = (k, n) => utils.normalizeText(r && r[k]).slice(0, n || L.teks);
    return {
      id: r && r.id ? String(r.id) : utils.uid(),
      codeAnalytic: t('codeAnalytic', L.kode),
      namaGerai: t('namaGerai', L.nama),
      fungsi: normFungsi(r && r.fungsi),
      alamat: t('alamat', L.alamat),
      vendor: t('vendor', L.teks),
      rasio: normRasio(r && r.rasio),
      bandwidth: t('bandwidth'),
      ssid: t('ssid'),
      ipGateway: t('ipGateway', L.ip),
      ipAddress: t('ipAddress', L.ip),
      dns: normDns(r && r.dns).slice(0, L.nama),
      mikrotikType: t('mikrotikType'),
      snMikrotik: t('snMikrotik')
    };
  }

  // ---------- validasi ----------
  // Validasi IPv4 dengan regex 4 oktet (1-3 digit, masing-masing <= 255).
  // allowCidr=true mengizinkan akhiran "/0".."/32" (dipakai IP Address; Gateway & DNS tidak boleh CIDR).
  function isIPv4(s, allowCidr) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(s);
    if (!m) return false;
    if (m[5] !== undefined && (!allowCidr || Number(m[5]) > 32)) return false;
    return [m[1], m[2], m[3], m[4]].every((o) => Number(o) <= 255);
  }

  /**
   * Validasi data satu gerai. Wajib: Nama Gerai, Function, Nama ISP (harus ada di config.vendors), Rasio.
   * IP Gateway/IP Address/DNS opsional, tetapi bila diisi harus IPv4 valid.
   * Aturan duplikat: Code Analytic tidak boleh sama (tidak peka huruf besar/kecil) dengan rekaman lain;
   * `ignoreId` = id rekaman yang sedang diubah (dikecualikan), null/undefined saat tambah/impor.
   * TROUBLESHOOT: simpan/impor ditolak tanpa alasan jelas -> baca array error ini; pesan ditampilkan
   * di #netFormErrors (form) atau toast (impor). Catatan: duplikat antar-baris dalam satu file impor
   * dicek terpisah di ui-network.js (importRows), bukan di sini.
   */
  function validate(data, ignoreId, codeSet) {
    data = data || {};
    const errors = [];
    if (!utils.normalizeText(data.namaGerai)) errors.push('Nama Gerai wajib diisi.');
    if (!normFungsi(data.fungsi)) errors.push('Function wajib dipilih (LM atau LM + FM).');
    if (!config.vendors.includes(data.vendor)) errors.push('Nama ISP wajib dipilih.');
    if (!normRasio(data.rasio)) errors.push('Rasio wajib dipilih (1:1, 1:2, 1:4, atau 1:8).');

    const gw = utils.normalizeText(data.ipGateway);
    if (gw && !isIPv4(gw, false)) errors.push('IP Gateway tidak valid (contoh: 192.168.1.1).');
    const ip = utils.normalizeText(data.ipAddress);
    if (ip && !isIPv4(ip, true)) errors.push('IP Address tidak valid (contoh: 192.168.1.2 atau 192.168.1.2/24).');
    const dns = normDns(data.dns);
    if (dns && !dns.split(', ').every((d) => isIPv4(d, false))) errors.push('DNS tidak valid (pisahkan beberapa IP dengan koma, contoh: 8.8.8.8, 1.1.1.1).');

    const code = utils.normalizeText(data.codeAnalytic).toLowerCase();
    // codeSet (opsional): Set kode huruf kecil milik data tersimpan, dipakai impor massal agar tidak memindai ulang semua data per baris.
    const taken = codeSet ? codeSet.has(code) : records.some((r) => r.id !== ignoreId && r.codeAnalytic.toLowerCase() === code);
    if (code && taken) {
      errors.push('Code Analytic ' + data.codeAnalytic + ' sudah dipakai gerai lain.');
    }
    return errors;
  }

  // ---------- data ----------
  // Muat data dari localStorage lalu normalisasi tiap rekaman (menambal kolom baru/data lama).
  // Mengembalikan hasil storage.load ({ ok, error, data }) agar pemanggil bisa menampilkan error.
  function init() {
    const res = storage.load(KEY);
    // Elemen yang bukan objek (null, angka, teks, array) dibuang: data rusak tidak boleh jadi baris kosong di tabel.
    records = res.data.filter(utils.isPlainObject).map(normalize);
    return res;
  }

  // Simpan seluruh `records` ke localStorage; return { ok, error } dari storage.save.
  const commit = () => storage.save(records, KEY);
  // Terapkan perubahan secara atomik: simpan gagal (kuota/diblokir) -> data dikembalikan ke kondisi sebelumnya
  // sehingga UI tidak menampilkan data yang tidak tersimpan. CRUD tidak boleh mengubah array records di tempat.
  function applyChange(next) {
    const prev = records;
    records = next;
    const res = commit();
    if (!res.ok) records = prev;
    return res;
  }
  // Salinan dangkal array rekaman (aman diurutkan/diubah pemanggil tanpa mengubah state).
  const all = () => records.slice();
  // Cari rekaman berdasarkan id; null bila tidak ada.
  const find = (id) => records.find((r) => r.id === id) || null;

  // ---------- CRUD ----------
  // Semua fungsi CRUD di bawah mengembalikan { ok, error } dan langsung menyimpan (commit).
  // TROUBLESHOOT: UI tidak berubah setelah CRUD -> pastikan pemanggil memanggil render() sesudahnya.

  // Tambah satu rekaman; id selalu dibuat baru (id dari data diabaikan).
  function add(data) { return applyChange(records.concat([normalize(Object.assign({}, data, { id: utils.uid() }))])); }

  // Ganti rekaman berdasarkan id (id dipertahankan). Gagal bila id tidak ditemukan.
  function update(id, data) {
    const i = records.findIndex((r) => r.id === id);
    if (i < 0) return { ok: false, error: 'Data tidak ditemukan.' };
    const next = records.slice();
    next[i] = normalize(Object.assign({}, data, { id }));
    return applyChange(next);
  }

  // Hapus rekaman berdasarkan id; dianggap gagal bila jumlah rekaman tidak berubah (id tak ada).
  // Hapus SEMUA rekaman Data Network (tidak menyentuh Data Gerai/pembayaran). Atomik seperti CRUD lain:
  // bila penyimpanan gagal, data dikembalikan. Sudah kosong -> { ok:true } tanpa menulis apa pun.
  function clear() {
    return records.length ? applyChange([]) : { ok: true };
  }

  function remove(id) {
    const next = records.filter((r) => r.id !== id);
    return next.length === records.length ? { ok: false, error: 'Data tidak ditemukan.' } : applyChange(next);
  }

  // Tambah banyak rekaman sekaligus (impor / kerangka dari Data Gerai) dengan satu kali commit.
  // Tidak memvalidasi: pemanggil harus sudah memvalidasi.
  function addMany(list) {
    return applyChange(records.concat(list.map((r) => normalize(Object.assign({}, r, { id: utils.uid() })))));
  }

  // Kumpulan Code Analytic (huruf kecil) milik data tersimpan. Untuk impor massal: dibangun sekali lalu
  // diberikan ke validate(data, null, codeSet) agar pengecekan dobel O(1) per baris, bukan memindai semua data.
  function codeSet() {
    return new Set(records.map((r) => r.codeAnalytic.toLowerCase()).filter(Boolean));
  }
  // ---------- tampilan ----------
  // Hasil filter + urutan sebelum paginasi (juga dipakai ekspor). Filter dropdown cocok persis;
  // pencarian teks mencari di gabungan semua kolom FIELDS. Sortir string tidak peka huruf besar/kecil
  // (nilai kosong dianggap '').
  // TROUBLESHOOT: tabel kosong padahal data ada -> cek state.query/vendor/fungsi/rasio (filter aktif),
  // dan pastikan nilai vendor/fungsi/rasio rekaman sama persis dengan opsi filter.
  function filtered() {
    const q = state.query.toLowerCase();
    const list = records.filter((r) => {
      if (state.vendor && r.vendor !== state.vendor) return false;
      if (state.fungsi && r.fungsi !== state.fungsi) return false;
      if (state.rasio && r.rasio !== state.rasio) return false;
      return !q || FIELDS.map((f) => r[f.key]).join(' ').toLowerCase().includes(q);
    });
    const { key, dir } = state.sort;
    const mul = dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = String(a[key] || '').toLowerCase();
      const y = String(b[key] || '').toLowerCase();
      return x === y ? 0 : (x > y ? 1 : -1) * mul;
    });
  }

  // Potong hasil filtered() sesuai halaman. Efek samping: state.page di-clamp ke 1..pages.
  // Return: rows (halaman ini), total (setelah filter), totalAll (tanpa filter), page, pages, start (indeks awal).
  function view() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / state.pageSize));
    state.page = Math.min(Math.max(state.page, 1), pages);
    const start = (state.page - 1) * state.pageSize;
    return { rows: list.slice(start, start + state.pageSize), total: list.length, totalAll: records.length, page: state.page, pages, start };
  }

  /** Ringkasan untuk kartu di atas tabel. "Belum lengkap" = IP Address, IP Gateway, atau SN Mikrotik kosong. */
  function stats() {
    const s = { total: records.length, lm: 0, lmfm: 0, incomplete: 0 };
    records.forEach((r) => {
      if (r.fungsi === 'LM') s.lm++; else if (r.fungsi === 'LM + FM') s.lmfm++;
      if (!r.ipAddress || !r.ipGateway || !r.snMikrotik) s.incomplete++;
    });
    return s;
  }

  // API publik modul (lihat daftar di header file).
  return { FIELDS, state, init, all, find, add, update, remove, clear, addMany, validate, codeSet, normalize, normFungsi, normRasio, filtered, view, stats };
})();
