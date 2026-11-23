/*
 * unit.js - Tes unit logika data (tanpa DOM aplikasi): utils, storage, store, validasi, CSV/Excel, Data Network, login.
 * Mencakup: kasus kosong, input salah, data rusak/tidak sesuai, simpan gagal (kuota penuh), dan data besar.
 * Semua key penyimpanan ber-namespace ".unit" (lihat config.js) sehingga data asli tidak tersentuh.
 */
(function () {
  const { utils, storage, store, validation, csv, netStore: ns, auth, config } = App;
  const NS = '.unit';

  // ---------- Bantuan ----------

  /** Hapus semua key ber-namespace tes (termasuk cadangan ".rusak-...") dan muat ulang state kedua store. */
  function resetAll() {
    Object.keys(window.localStorage).filter((k) => k.indexOf(NS) !== -1).forEach((k) => window.localStorage.removeItem(k));
    store.init();
    ns.init();
  }

  /** Jalankan fn saat localStorage.setItem GAGAL (meniru kuota penuh) untuk key ber-namespace tes. */
  function withFailingSave(fn) {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).indexOf(NS) !== -1) throw new DOMException('kuota penuh', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
    try { return fn(); } finally { Storage.prototype.setItem = orig; }
  }

  /** Buat n record gerai sintetis yang realistis (vendor bergilir, pembayaran Jun-Nov, tanggal sewa beragam). */
  function genRecords(n, tag) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const pays = utils.emptyPayments().map((_, m) => (m >= 5 && m <= 10 ? 500000 + ((i * 37 + m * 11) % 90) * 10000 : null));
      out.push({
        kodeInduk: String(1000 + i),
        po: i % 3 ? '-' : String(i % 20),
        namaGerai: 'Sicepat Ekspres Uji ' + (tag || 'A') + '-' + i,
        alamat: 'Jl. Uji Coba No. ' + i + ', Kecamatan Contoh, Kota Contoh, Jawa Barat 4' + String(1000 + (i % 9000)),
        akhirSewa: utils.addDays(((i * 53) % 700) - 200),
        status: i % 4 === 0 ? 'Inactive' : 'Active',
        idPelanggan: 'ID-' + (tag || 'A') + '-' + i,
        vendor: config.vendors[i % config.vendors.length],
        remark: i % 4 === 0 ? 'Takeout' : 'Existing',
        catatan: i % 4 === 0 ? 'Nov 25' : '',
        payments: { '2026': pays }
      });
    }
    return out;
  }

  /** Buat n record Data Network sintetis. */
  function genNet(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        codeAnalytic: 'AN-' + i, namaGerai: 'Gerai Net ' + i, fungsi: i % 2 ? 'LM' : 'LM + FM', alamat: 'Jl. Net ' + i,
        vendor: config.vendors[i % config.vendors.length], rasio: config.netRatios[i % 4], bandwidth: '50 Mbps', ssid: 'SCP-' + i,
        ipGateway: '10.' + (i % 250) + '.0.1', ipAddress: '10.' + (i % 250) + '.0.2/24', dns: '8.8.8.8, 1.1.1.1', mikrotikType: 'hAP ac2', snMikrotik: 'SN' + i
      });
    }
    return out;
  }

  // Isi penyimpanan yang rusak / tidak sesuai bentuknya (dipakai tes data rusak).
  const HOSTILE = [
    null, 42, 'teks biasa', [], [1, 2], true, {},
    { id: { a: 1 }, namaGerai: { x: 1 }, alamat: ['a', 'b'], vendor: 123, status: 'XYZ', remark: 99, akhirSewa: '2026-02-31', payments: 'bukan objek' },
    { namaGerai: 'A'.repeat(10000), alamat: 'B'.repeat(100000), catatan: 'C'.repeat(5000), payments: { '2026': 'x', abc: [1], '2025': [-5, 'dua belas', null, 1e308, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] } },
    { namaGerai: '<img src=x onerror=alert(1)>', vendor: '<script>x</script>', alamat: '"><svg onload=alert(1)>' }
  ];

  // ======================================================================
  T.group('1. Fungsi bantu (utils)');

  T.test('format angka/rupiah/ringkas/persen tidak error pada nilai ekstrem', () => {
    [0, -1, 1.5, 1e6, 1e9, 1e15, NaN, Infinity, null, undefined].forEach((v) => {
      T.noThrow(() => { utils.formatNumber(v); utils.formatRupiah(v); utils.formatCompact(v); utils.formatPercent(v); }, 'nilai ' + v);
    });
    T.eq(utils.formatRupiah(1250000), 'Rp 1.250.000');
    T.eq(utils.formatCompact(356113452), '356,1 jt');
    T.eq(utils.formatPercent(0.3456), '34,6%');
  });

  T.test('escapeHtml menetralkan payload XSS', () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>\'"&';
    const out = utils.escapeHtml(payload);
    T.ok(out.indexOf('<') === -1 && out.indexOf('>') === -1 && out.indexOf('"') === -1 && out.indexOf("'") === -1, 'masih ada karakter berbahaya: ' + out);
    T.eq(utils.escapeHtml(null), '');
    T.eq(utils.escapeHtml(undefined), '');
  });

  T.test('parseDate menolak tanggal tidak valid', () => {
    ['', null, undefined, 'abc', '2026-02-31', '2026-13-01', '2026-00-10', '20260101', '01/02/2026', 20260101, {}, []].forEach((v) => T.eq(utils.parseDate(v), null, 'input ' + JSON.stringify(v)));
    T.ok(utils.parseDate('2026-02-28') instanceof Date);
    T.eq(utils.daysRemaining('bukan tanggal'), null);
    T.eq(utils.daysRemaining(''), null);
  });

  T.test('parseAmount: sah, kosong, dan tidak valid dibedakan', () => {
    T.eq(utils.parseAmount('1.250.000'), 1250000);
    T.eq(utils.parseAmount('Rp 100'), 100);
    T.eq(utils.parseAmount('1,5'), 1.5);
    T.eq(utils.parseAmount(''), null);
    T.eq(utils.parseAmount(null), null);
    ['-5', 'abc', '1e', '9'.repeat(400), '12abc', '--'].forEach((v) => T.eq(utils.parseAmount(v), undefined, 'input ' + v));
  });

  T.test('sumPayments mengabaikan nilai bukan angka', () => {
    T.eq(utils.sumPayments([1, null, 'x', 2, undefined, NaN, Infinity, {}]), 3);
    T.eq(utils.sumPayments(null), 0);
    T.eq(utils.sumPayments(undefined), 0);
  });

  T.test('debounce hanya menjalankan panggilan terakhir', async () => {
    let n = 0;
    const f = utils.debounce(() => { n++; }, 30);
    f(); f(); f();
    await T.sleep(90);
    T.eq(n, 1);
  });

  // ======================================================================
  T.group('2. Penyimpanan (storage)');

  T.test('kosong: load mengembalikan ok + array kosong', () => {
    resetAll();
    const r = storage.load();
    T.eq(r.ok, true); T.eq(r.data, []);
  });

  T.test('JSON rusak: tidak melempar error, salinan cadangan dibuat, data asli tetap ada', () => {
    resetAll();
    window.localStorage.setItem(config.storageKey, '{ini bukan json');
    const r = storage.load();
    T.eq(r.ok, false);
    T.ok(/rusak-/.test(r.error), 'pesan error harus menyebut kunci cadangan: ' + r.error);
    const backups = Object.keys(window.localStorage).filter((k) => k.indexOf(config.storageKey + '.rusak-') === 0);
    T.eq(backups.length, 1, 'jumlah cadangan');
    T.eq(window.localStorage.getItem(backups[0]), '{ini bukan json');
    T.eq(window.localStorage.getItem(config.storageKey), '{ini bukan json', 'data asli tidak boleh hilang saat dibaca');
  });

  T.test('bukan array (objek / angka / null): ditolak dengan pesan, tanpa crash', () => {
    ['{"a":1}', '42', '"teks"', 'true'].forEach((raw) => {
      resetAll();
      window.localStorage.setItem(config.storageKey, raw);
      const r = storage.load();
      T.eq(r.ok, false, 'isi ' + raw);
      T.eq(r.data, []);
    });
  });

  T.test('simpan gagal (kuota penuh): tidak melempar error, melapor ok:false', () => {
    resetAll();
    const r = withFailingSave(() => storage.save([{ a: 1 }]));
    T.eq(r.ok, false);
    T.ok(/Gagal menyimpan/.test(r.error));
  });

  // ======================================================================
  T.group('3. Data gerai (store) - kasus kosong');

  T.test('store kosong: semua agregat aman (tanpa NaN/error)', () => {
    resetAll();
    T.eq(store.all().length, 0);
    const v = store.view();
    T.eq([v.total, v.totalAll, v.page, v.pages, v.rows.length], [0, 0, 1, 1, 0]);
    const s = store.stats();
    T.eq([s.total, s.active, s.inactive, s.expiring, s.noDate], [0, 0, 0, 0, 0]);
    const p = store.paymentStats();
    T.eq(p.grandTotal, 0);
    T.ok(p.monthTotals.every((n) => n === 0));
    T.eq(store.expiringList(8), { total: 0, items: [] });
    T.ok(store.years().length >= 5, 'daftar tahun harus tetap ada');
    T.eq(store.filtered(), []);
  });

  T.test('csv: ekspor store kosong menghasilkan header saja dan tidak error', () => {
    resetAll();
    const out = csv.toCsv([], '2026');
    T.ok(out.split('\n').length === 1 && out.indexOf('Nama Gerai') > -1);
  });

  // ======================================================================
  T.group('4. Data gerai (store) - data rusak / tidak sesuai');

  T.test('isi penyimpanan campur aduk dimuat tanpa crash dan dibersihkan', () => {
    resetAll();
    window.localStorage.setItem(config.storageKey, JSON.stringify(HOSTILE));
    let res;
    T.noThrow(() => { res = store.init(); });
    T.eq(res.ok, true);
    const expectedObjects = HOSTILE.filter(utils.isPlainObject).length;
    T.eq(store.all().length, expectedObjects, 'hanya objek yang dimuat');
    store.all().forEach((r, i) => {
      ['kodeInduk', 'po', 'namaGerai', 'alamat', 'akhirSewa', 'status', 'idPelanggan', 'vendor', 'remark', 'catatan', 'id'].forEach((f) => T.eq(typeof r[f], 'string', 'rekaman ' + i + ' field ' + f));
      T.ok(config.statuses.indexOf(r.status) > -1 && config.remarks.indexOf(r.remark) > -1, 'status/remark default');
      T.ok(r.namaGerai.length <= config.limits.nama && r.alamat.length <= config.limits.alamat && r.catatan.length <= config.limits.catatan, 'batas panjang rekaman ' + i);
      Object.keys(r.payments).forEach((y) => {
        T.ok(/^\d{4}$/.test(y), 'kunci tahun aneh: ' + y);
        T.eq(r.payments[y].length, 12);
        T.ok(r.payments[y].every((n) => n === null || (typeof n === 'number' && isFinite(n) && n >= 0)), 'nominal tidak valid di ' + y);
      });
      T.eq(r.akhirSewa === '' || utils.parseDate(r.akhirSewa) !== null, true);
    });
    T.noThrow(() => { store.view(); store.stats(); store.paymentStats(); store.expiringList(5); store.filtered(); });
  });

  T.test('kunci "__proto__" pada payments tidak mencemari objek', () => {
    resetAll();
    window.localStorage.setItem(config.storageKey, '[{"namaGerai":"X","payments":{"__proto__":[1,2,3],"2026":[1]}}]');
    store.init();
    const r = store.all()[0];
    T.eq(Object.keys(r.payments), ['2026']);
    T.eq(Object.getPrototypeOf(r.payments), Object.prototype);
    T.eq({}.polluted, undefined);
  });

  T.test('tambah gerai dengan field bertipe salah tidak crash dan dinormalisasi', () => {
    resetAll();
    const r = store.add({ namaGerai: 123, alamat: null, vendor: ['HSI'], status: {}, akhirSewa: 'kemarin', payments: { '2026': [1, 'x'] } });
    T.eq(r.ok, true);
    const rec = store.all()[0];
    T.eq([rec.namaGerai, rec.alamat, rec.akhirSewa, rec.status], ['123', '', '', 'Active']);
  });

  // ======================================================================
  T.group('5. Data gerai (store) - simpan gagal & konsistensi');

  T.test('tambah gagal simpan: data di memori dikembalikan (tidak ada data hantu)', () => {
    resetAll();
    store.add({ namaGerai: 'Awal', vendor: 'HSI' });
    const r = withFailingSave(() => store.add({ namaGerai: 'Gagal', vendor: 'HSI' }));
    T.eq(r.ok, false);
    T.eq(store.all().map((x) => x.namaGerai), ['Awal']);
    T.eq(JSON.parse(window.localStorage.getItem(config.storageKey)).length, 1, 'penyimpanan tetap 1');
  });

  T.test('ubah, hapus, addMany, replaceAll yang gagal simpan juga dibatalkan', () => {
    resetAll();
    store.add({ namaGerai: 'Satu', vendor: 'HSI' });
    const id = store.all()[0].id;
    withFailingSave(() => {
      T.eq(store.update(id, { namaGerai: 'Diubah', vendor: 'HSI' }).ok, false);
      T.eq(store.remove(id).ok, false);
      T.eq(store.addMany([{ namaGerai: 'B' }, { namaGerai: 'C' }]).ok, false);
      T.eq(store.replaceAll([{ namaGerai: 'Z' }]).ok, false);
    });
    T.eq(store.all().map((x) => x.namaGerai), ['Satu']);
  });

  T.test('id tidak dikenal pada ubah/hapus mengembalikan error, bukan exception', () => {
    resetAll();
    T.eq(store.update('tidak-ada', {}).ok, false);
    T.eq(store.remove('tidak-ada').ok, false);
    T.eq(store.find('tidak-ada'), null);
  });

  T.test('validasi form gerai: wajib isi, vendor/status/remark, tanggal, duplikat', () => {
    resetAll();
    store.add({ namaGerai: 'Gerai Satu', alamat: 'Alamat', idPelanggan: 'X1', vendor: 'HSI' });
    T.ok(validation.check({}).length >= 4, 'form kosong harus memberi banyak error');
    T.ok(validation.check({ namaGerai: 'A', alamat: 'B', vendor: 'Salah', status: 'Active', remark: 'Existing' }).some((e) => /Vendor/i.test(e)));
    T.ok(validation.check({ namaGerai: 'A', alamat: 'B', vendor: 'HSI', status: 'Salah', remark: 'Existing' }).some((e) => /Status/i.test(e)));
    T.ok(validation.check({ namaGerai: 'A', alamat: 'B', vendor: 'HSI', status: 'Active', remark: 'Existing', akhirSewa: '2026-02-31' }).some((e) => /tanggal/i.test(e)));
    const dup = validation.check({ namaGerai: 'Gerai Satu', alamat: 'B', idPelanggan: 'X1', vendor: 'HSI', status: 'Active', remark: 'Existing' });
    T.ok(dup.some((e) => /sudah terdaftar/i.test(e)), 'duplikat harus terdeteksi');
    T.eq(validation.check({ namaGerai: 'Baru', alamat: 'B', vendor: 'HSI', status: 'Active', remark: 'Existing' }), []);
  });

  // ======================================================================
  T.group('6. Data besar (store)');

  T.test('5.000 gerai: tambah, simpan, muat ulang, filter, urut, statistik tetap cepat', () => {
    resetAll();
    const N = 5000;
    let t = performance.now();
    const res = store.addMany(genRecords(N, 'B'));
    const tAdd = Math.round(performance.now() - t);
    T.eq(res.ok, true, 'simpan 5.000 gerai ke localStorage: ' + (res.error || ''));
    T.eq(store.all().length, N);
    const bytes = (window.localStorage.getItem(config.storageKey) || '').length;
    T.note('ukuran tersimpan ~' + Math.round(bytes / 1024) + ' KB untuk ' + N + ' gerai (batas browser ~5.000 KB)');

    t = performance.now(); store.init(); const tLoad = Math.round(performance.now() - t);
    T.eq(store.all().length, N, 'muat ulang');

    store.state.query = 'uji b-4999'; t = performance.now(); const found = store.filtered(); const tSearch = Math.round(performance.now() - t);
    T.eq(found.length, 1);
    store.state.query = '';
    store.state.sort = { key: 'sisa', dir: 'asc' }; t = performance.now(); store.view(); const tSort = Math.round(performance.now() - t);
    store.state.sort = { key: 'total', dir: 'desc' }; store.state.pageSize = 100; store.state.page = 9999; const v = store.view();
    T.eq(v.page, v.pages, 'halaman di luar jangkauan harus dikoreksi');
    store.state.sort = { key: 'namaGerai', dir: 'asc' }; store.state.page = 1; store.state.pageSize = config.pageSizes[0];
    t = performance.now(); const st = store.stats(); const ps = store.paymentStats(); store.expiringList(8); const tStats = Math.round(performance.now() - t);
    T.eq(st.total, N);
    T.ok(ps.grandTotal > 0 && isFinite(ps.grandTotal));
    T.note('waktu: tambah+simpan ' + tAdd + ' ms, muat ulang ' + tLoad + ' ms, cari ' + tSearch + ' ms, urut ' + tSort + ' ms, statistik ' + tStats + ' ms');
    T.ok(tAdd < 4000 && tLoad < 2000 && tSearch < 1000 && tSort < 1500 && tStats < 1000, 'terlalu lambat');
  });

  T.test('20.000 gerai di memori (tanpa simpan): operasi inti tidak membeku', () => {
    resetAll();
    const orig = storage.save;
    storage.save = () => ({ ok: true });
    try {
      let t = performance.now();
      store.addMany(genRecords(20000, 'C'));
      const tAdd = Math.round(performance.now() - t);
      t = performance.now();
      store.state.query = 'ekspres'; store.view(); store.state.query = '';
      store.state.sort = { key: 'sisa', dir: 'desc' }; store.view();
      store.stats(); store.paymentStats(); store.expiringList(8);
      const tOps = Math.round(performance.now() - t);
      T.note('tambah ' + tAdd + ' ms; cari+urut+statistik ' + tOps + ' ms');
      T.ok(tAdd < 5000 && tOps < 5000, 'terlalu lambat');
    } finally { storage.save = orig; store.state.sort = { key: 'namaGerai', dir: 'asc' }; }
  });

  T.test('simpan data melebihi kuota browser: gagal dengan pesan, tanpa crash, data tetap konsisten', () => {
    resetAll();
    // 60 rekaman besar yang dipadatkan (alamat/ nama maksimal) berkali-kali sampai kuota benar-benar penuh.
    let failed = null;
    for (let i = 0; i < 400 && !failed; i++) {
      const big = genRecords(2000, 'Q' + i).map((r) => Object.assign(r, { alamat: 'X'.repeat(config.limits.alamat), catatan: 'Y'.repeat(config.limits.catatan) }));
      const before = store.all().length;
      const res = store.addMany(big);
      if (!res.ok) { failed = { res, before }; }
    }
    T.ok(failed, 'kuota seharusnya akhirnya penuh pada pengujian ini');
    T.eq(store.all().length, failed.before, 'data memori harus kembali ke kondisi sebelum gagal');
    T.ok(/Gagal menyimpan/.test(failed.res.error));
    T.note('kuota penuh setelah ' + failed.before + ' gerai besar');
    resetAll();
  });

  // ======================================================================
  T.group('7. Impor CSV/Excel - input salah');

  const GOOD_HEADER = ['Kode Induk', 'PO', 'Nama Gerai', 'Alamat Gerai', 'Akhir Sewa (YYYY-MM-DD)', 'Status', 'ID Pelanggan', 'Nama Vendor', 'Remark', 'Januari', 'Februari'];

  T.test('masukan bukan tabel / baris tidak sah tidak membuat crash', () => {
    resetAll();
    [null, undefined, 42, 'teks', {}, [], [[]], [null], [null, [1, 2]], [[null, undefined]], [1, 2, 3], [['a']], [[{}]], [[[]]]].forEach((input) => {
      let r;
      T.noThrow(() => { r = csv.importRows(input, '2026'); }, 'input ' + JSON.stringify(input));
      T.eq(r.records.length, 0);
      T.ok(Array.isArray(r.errors));
    });
  });

  T.test('file kosong / hanya header / tanpa kolom wajib ditolak dengan pesan jelas', () => {
    resetAll();
    T.ok(csv.importText('', '2026').errors.length > 0);
    T.ok(csv.importText('Kode Induk,Nama Gerai\r\n', '2026').errors.length > 0);
    const noVendor = csv.importText('Kode Induk,Nama Gerai\r\n1,A\r\n', '2026');
    T.ok(noVendor.errors.some((e) => /wajib/i.test(e)), 'harus menyebut kolom wajib: ' + noVendor.errors.join('|'));
  });

  T.test('CSV rusak (kutip tak seimbang, BOM, CR saja, baris sangat panjang) tidak crash', () => {
    resetAll();
    const cases = ['"a,b\r\n1,2', '﻿Kode Induk,Nama Gerai,Nama Vendor\r\n1,"A\r\n2,B,HSI', 'Kode Induk,Nama Gerai,Nama Vendor\r1,A,HSI\r2,B,HSI', 'x'.repeat(2000000), '\u0000\u0001\u0002,,,\n,,,', ';;;;\n;;;;'];
    cases.forEach((txt, i) => { T.noThrow(() => csv.importText(txt, '2026'), 'kasus ' + i); });
    const ok = csv.importText('Kode Induk,Nama Gerai,Nama Vendor\r1,A,HSI\r2,B,HSI', '2026');
    T.eq(ok.records.length, 2, 'CR saja harus terbaca sebagai pemisah baris');
  });

  T.test('baris bermasalah dilewati, baris benar tetap masuk, pesan menyebut nomor baris', () => {
    resetAll();
    const rows = [GOOD_HEADER,
      ['1', '-', 'Gerai Bagus', 'Alamat', '2026-12-31', 'active', 'ID1', 'HSI', 'existing', '1.250.000', ''],
      ['2', '', 'Vendor Salah', 'Alamat', '', '', 'ID2', 'VendorTakDikenal', '', '', ''],
      ['3', '', 'Tanggal Salah', 'Alamat', '2026-02-31', '', 'ID3', 'HSI', '', '', ''],
      ['4', '', 'Nominal Negatif', 'Alamat', '', '', 'ID4', 'HSI', '', '-500', ''],
      ['5', '', 'Nominal Huruf', 'Alamat', '', '', 'ID5', 'HSI', '', 'abc', ''],
      ['6', '', '', 'Tanpa Nama', '', '', 'ID6', 'HSI', '', '', ''],
      ['7', '', 'Gerai Bagus', 'Alamat', '', '', 'ID1', 'HSI', '', '', '']];
    const r = csv.importRows(rows, '2026');
    T.eq(r.records.length, 1, 'hanya satu baris valid');
    T.eq(r.records[0].remark, 'Existing');
    T.eq(r.records[0].payments['2026'][0], 1250000);
    T.eq(r.errors.length, 6, 'enam baris dilewati: ' + r.errors.join(' | '));
    T.ok(r.errors.every((e) => /^Baris \d+:/.test(e)));
  });

  T.test('duplikat terhadap data tersimpan terdeteksi', () => {
    resetAll();
    store.add({ namaGerai: 'Gerai Bagus', idPelanggan: 'ID1', vendor: 'HSI', alamat: 'x' });
    const r = csv.importRows([GOOD_HEADER, ['1', '', 'Gerai Bagus', 'x', '', '', 'ID1', 'HSI', '', '', '']], '2026');
    T.eq(r.records.length, 0);
    T.ok(/duplikat/i.test(r.errors[0]));
  });

  T.test('payload HTML di sel impor tersimpan sebagai teks (bukan dieksekusi)', () => {
    resetAll();
    const r = csv.importRows([GOOD_HEADER, ['1', '', '<img src=x onerror=alert(1)>', '"><script>1</script>', '', '', 'ID9', 'HSI', '', '', '']], '2026');
    T.eq(r.records.length, 1);
    T.eq(r.records[0].namaGerai, '<img src=x onerror=alert(1)>');
  });

  T.test('melebihi batas baris impor ditolak dengan pesan', () => {
    resetAll();
    const rows = [GOOD_HEADER];
    for (let i = 0; i <= config.maxImportRows; i++) rows.push(['', '', 'G' + i, '', '', '', 'I' + i, 'HSI', '', '', '']);
    const r = csv.importRows(rows, '2026');
    T.eq(r.records.length, 0);
    T.ok(/terlalu besar/i.test(r.errors[0]));
  });

  T.test('impor 5.000 baris cepat (duplikat dicek O(1))', () => {
    resetAll();
    store.addMany(genRecords(5000, 'D'));
    const rows = [GOOD_HEADER];
    for (let i = 0; i < 5000; i++) rows.push([String(i), '', 'Impor Baru ' + i, 'Alamat', '2026-12-31', 'Active', 'IMP-' + i, config.vendors[i % 7], 'Existing', '1000000', '']);
    const t = performance.now();
    const r = csv.importRows(rows, '2026');
    const ms = Math.round(performance.now() - t);
    T.eq(r.records.length, 5000);
    T.note('impor 5.000 baris terhadap 5.000 data tersimpan: ' + ms + ' ms');
    T.ok(ms < 3000, 'terlalu lambat: ' + ms + ' ms');
    resetAll();
  });

  T.test('ekspor lalu impor kembali (round-trip) mempertahankan data', () => {
    resetAll();
    store.addMany(genRecords(30, 'E'));
    const text = csv.toCsv(store.filtered(), '2026');
    store.replaceAll([]);
    const r = csv.importText(text, '2026');
    T.eq(r.records.length, 30, 'errors: ' + r.errors.slice(0, 2).join(' | '));
    T.eq(r.records[0].payments['2026'].length, 12);
    resetAll();
  });

  T.test('Excel: berkas sampah / kosong tidak menghasilkan data dan tidak crash (error terkendali atau 0 baris)', () => {
    [new Uint8Array([1, 2, 3, 4, 5, 250, 251]).buffer, new ArrayBuffer(0), new Uint8Array(5000).buffer].forEach((buf, i) => {
      let result = null;
      let threw = false;
      try { result = App.excel.importBuffer(buf, '2026'); } catch (e) { threw = true; T.ok(e instanceof Error, 'harus Error biasa'); }
      T.ok(threw || (result && result.records.length === 0 && result.errors.length > 0), 'kasus ' + i + ': harus ditolak dengan error atau 0 baris + pesan');
    });
  }, { skipIf: () => typeof window.XLSX === 'undefined' });

  T.test('Excel: berkas .xlsx asli dengan baris campur terbaca benar', () => {
    resetAll();
    const aoa = [['LAPORAN'], [], ['Kode Induk', 'Gerai', 'Nama Vendor', 'Status', 'Remarks', 'JUNE'],
      ['1', 'Gerai X', 'satu akses indonesia', 'ACTIVE', 'Takeout Nov 25', 570000],
      ['2', 'Gerai Y', 'Fiberstar', 'INACTIVE', 'Existing', '-'],
      ['', '', '', '', '', '']];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S');
    const r = App.excel.importBuffer(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), '2026');
    T.eq(r.records.length, 2, r.errors.join('|'));
    T.eq([r.records[0].vendor, r.records[0].remark, r.records[0].catatan, r.records[0].payments['2026'][5]], ['Satu ID', 'Takeout', 'Nov 25', 570000]);
    T.eq(r.records[1].vendor, 'Fiberstart');
  }, { skipIf: () => typeof window.XLSX === 'undefined' });

  // ======================================================================
  T.group('8. Data Network');

  T.test('kosong: statistik dan tampilan aman', () => {
    resetAll();
    const s = ns.stats();
    T.eq([s.total, s.lm, s.lmfm, s.incomplete], [0, 0, 0, 0]);
    const v = ns.view();
    T.eq([v.total, v.rows.length, v.pages], [0, 0, 1]);
    T.eq(ns.codeSet().size, 0);
  });

  T.test('validate: wajib isi, IP/DNS salah, duplikat kode, dan data null aman', () => {
    resetAll();
    T.noThrow(() => ns.validate(null));
    T.noThrow(() => ns.validate(undefined));
    T.ok(ns.validate({}).length >= 4, 'form kosong');
    const base = { namaGerai: 'G', fungsi: 'LM', vendor: 'HSI', rasio: '1:2' };
    T.eq(ns.validate(base), []);
    ['300.1.1.1', '1.2.3', '1.2.3.4.5', 'abc', '1.2.3.4/24', '01.2.3.-4'].forEach((ip) => T.ok(ns.validate(Object.assign({}, base, { ipGateway: ip })).some((e) => /Gateway/.test(e)), 'gateway ' + ip));
    ['1.2.3.4/33', '1.2.3.4/', '1.2.3.999'].forEach((ip) => T.ok(ns.validate(Object.assign({}, base, { ipAddress: ip })).some((e) => /IP Address/.test(e)), 'ip ' + ip));
    T.eq(ns.validate(Object.assign({}, base, { ipAddress: '10.0.0.2/24', ipGateway: '10.0.0.1', dns: '8.8.8.8, 1.1.1.1' })), []);
    T.ok(ns.validate(Object.assign({}, base, { dns: '8.8.8.8, abc' })).some((e) => /DNS/.test(e)));
    ns.add(Object.assign({}, base, { codeAnalytic: 'AN-1' }));
    T.ok(ns.validate(Object.assign({}, base, { codeAnalytic: 'an-1' })).some((e) => /sudah dipakai/.test(e)), 'kode kembar (huruf besar/kecil)');
    T.eq(ns.validate(Object.assign({}, base, { codeAnalytic: 'an-1' }), ns.all()[0].id), [], 'edit rekaman sendiri tidak dianggap kembar');
  });

  T.test('isi penyimpanan campur aduk dimuat tanpa crash', () => {
    resetAll();
    window.localStorage.setItem(config.netStorageKey, JSON.stringify([null, 5, 'x', [], {}, { fungsi: 'ngawur', rasio: '9:9', ipAddress: { a: 1 }, dns: 12345, namaGerai: 'Z'.repeat(9999) }]));
    T.noThrow(() => ns.init());
    T.eq(ns.all().length, 2);
    ns.all().forEach((r) => { T.eq(r.fungsi, ''); T.eq(r.rasio, ''); T.ok(r.namaGerai.length <= config.limits.nama); });
    T.noThrow(() => { ns.view(); ns.stats(); ns.filtered(); });
  });

  T.test('simpan gagal membatalkan perubahan Data Network', () => {
    resetAll();
    ns.add({ namaGerai: 'Awal', fungsi: 'LM', vendor: 'HSI', rasio: '1:1' });
    const id = ns.all()[0].id;
    withFailingSave(() => {
      T.eq(ns.add({ namaGerai: 'B' }).ok, false);
      T.eq(ns.update(id, { namaGerai: 'Ubah' }).ok, false);
      T.eq(ns.remove(id).ok, false);
      T.eq(ns.addMany([{ namaGerai: 'C' }]).ok, false);
    });
    T.eq(ns.all().map((r) => r.namaGerai), ['Awal']);
  });

  T.test('clear(): menghapus semua Data Network, aman saat kosong, dan dibatalkan bila simpan gagal', () => {
    resetAll();
    T.eq(ns.clear().ok, true, 'kosong -> ok tanpa efek');
    ns.addMany(genNet(25));
    store.add({ namaGerai: 'Gerai tetap', vendor: 'HSI' });
    T.eq(ns.all().length, 25);
    T.eq(withFailingSave(() => ns.clear()).ok, false);
    T.eq(ns.all().length, 25, 'simpan gagal -> data tidak boleh hilang dari memori');
    T.eq(JSON.parse(window.localStorage.getItem(config.netStorageKey)).length, 25, 'penyimpanan tetap utuh');
    T.eq(ns.clear().ok, true);
    T.eq(ns.all().length, 0);
    T.eq(JSON.parse(window.localStorage.getItem(config.netStorageKey)), [], 'penyimpanan dikosongkan');
    ns.init();
    T.eq(ns.all().length, 0, 'tetap kosong setelah dimuat ulang');
    T.eq(store.all().length, 1, 'Data Gerai tidak boleh ikut terhapus');
    T.eq(ns.stats().total, 0);
    T.noThrow(() => { ns.view(); ns.filtered(); ns.codeSet(); });
    resetAll();
  });

  T.test('normalisasi Function dan Rasio dari variasi penulisan', () => {
    T.eq(['lm', 'LM', ' lm ', 'LM + FM', 'lm+fm', 'LM+FM', 'lm fm', 'xx', ''].map(ns.normFungsi), ['LM', 'LM', 'LM', 'LM + FM', 'LM + FM', 'LM + FM', 'LM + FM', '', '']);
    T.eq(['1:2', '1/4', ' 1 : 8 ', '1;1', '2:2', '', '1:3'].map(ns.normRasio), ['1:2', '1:4', '1:8', '1:1', '', '', '']);
  });

  T.test('5.000 data network: simpan, muat, cari, dan hitung tetap cepat', () => {
    resetAll();
    let t = performance.now();
    const res = ns.addMany(genNet(5000));
    const tAdd = Math.round(performance.now() - t);
    T.eq(res.ok, true, res.error || '');
    t = performance.now(); ns.init(); const tLoad = Math.round(performance.now() - t);
    ns.state.query = '10.7.0.2'; t = performance.now(); const f = ns.filtered(); const tSearch = Math.round(performance.now() - t);
    ns.state.query = '';
    T.ok(f.length > 0);
    t = performance.now(); ns.stats(); ns.codeSet(); const tStats = Math.round(performance.now() - t);
    T.note('waktu: tambah+simpan ' + tAdd + ' ms, muat ' + tLoad + ' ms, cari ' + tSearch + ' ms, statistik ' + tStats + ' ms');
    T.ok(tAdd < 4000 && tLoad < 2000 && tSearch < 1000 && tStats < 1000, 'terlalu lambat');
    resetAll();
  });

  // ======================================================================
  T.group('9. Login (auth)');
  const cryptoMissing = () => !auth.cryptoAvailable();

  T.test('belum ada akun: hasAccount false, verify gagal tanpa crash', async () => {
    resetAll();
    T.eq(auth.hasAccount(), false);
    const v = await auth.verify('admin', 'apapun123');
    T.eq(v.ok, false);
    T.eq(auth.isAuthenticated(), false);
    T.eq(auth.currentUser(), null);
  }, { skipIf: cryptoMissing });

  T.test('buat akun: username/password lemah ditolak, yang kuat diterima, password tidak tersimpan polos', async () => {
    resetAll();
    T.eq((await auth.createAccount({ name: 'A', username: 'ad', password: 'Abcdef12' })).ok, false, 'username pendek');
    T.eq((await auth.createAccount({ name: 'A', username: 'ada man', password: 'Abcdef12' })).ok, false, 'username berspasi');
    T.eq((await auth.createAccount({ name: 'A', username: 'admin', password: 'pendek1' })).ok, false, 'password pendek');
    T.eq((await auth.createAccount({ name: 'A', username: 'admin', password: 'hanyahuruf' })).ok, false, 'tanpa angka');
    T.eq((await auth.createAccount({ name: 'A', username: 'admin', password: '12345678' })).ok, false, 'tanpa huruf');
    const ok = await auth.createAccount({ name: 'Admin', username: 'Admin', password: 'Rahasia123' });
    T.eq(ok.ok, true);
    T.ok(window.localStorage.getItem(config.authKeys.account).indexOf('Rahasia123') === -1, 'password tidak boleh tersimpan polos');
    T.eq((await auth.createAccount({ name: 'B', username: 'lain', password: 'Rahasia123' })).ok, false, 'akun kedua tidak boleh menimpa');
  }, { skipIf: cryptoMissing });

  T.test('login: password salah ditolak, benar diterima, sesi & logout bekerja', async () => {
    resetAll();
    await auth.createAccount({ name: 'Admin', username: 'admin', password: 'Rahasia123' });
    T.eq((await auth.verify('admin', 'salah12345')).ok, false);
    T.eq((await auth.verify('orang', 'Rahasia123')).ok, false);
    T.eq((await auth.verify('ADMIN', 'Rahasia123')).ok, true, 'username tidak peka huruf besar-kecil');
    auth.startSession('admin', false);
    T.eq(auth.isAuthenticated(), true);
    auth.logout();
    T.eq(auth.isAuthenticated(), false);
  }, { skipIf: cryptoMissing });

  T.test('5 percobaan gagal mengunci login sementara; setelahnya password benar pun ditolak sampai kunci habis', async () => {
    resetAll();
    await auth.createAccount({ name: 'Admin', username: 'admin', password: 'Rahasia123' });
    for (let i = 0; i < 5; i++) await auth.verify('admin', 'salah' + i + '123');
    T.ok(auth.lockRemaining() > 0, 'harus terkunci');
    const r = await auth.verify('admin', 'Rahasia123');
    T.eq(r.ok, false);
    T.ok(/dikunci|Terlalu banyak/.test(r.error));
    resetAll();
  }, { skipIf: cryptoMissing });

  T.test('ganti password: lama salah ditolak, baru lemah ditolak, sukses mengganti', async () => {
    resetAll();
    await auth.createAccount({ name: 'Admin', username: 'admin', password: 'Rahasia123' });
    T.eq((await auth.changePassword('SALAH12345', 'Baru12345')).ok, false);
    T.eq((await auth.changePassword('Rahasia123', 'pendek')).ok, false);
    T.eq((await auth.changePassword('Rahasia123', 'Baru12345')).ok, true);
    T.eq((await auth.verify('admin', 'Rahasia123')).ok, false);
    T.eq((await auth.verify('admin', 'Baru12345')).ok, true);
  }, { skipIf: cryptoMissing });

  T.test('data akun rusak/dirusak tidak membuat crash', async () => {
    resetAll();
    window.localStorage.setItem(config.authKeys.account, '{rusak');
    T.noThrow(() => { auth.hasAccount(); auth.isAuthenticated(); auth.currentUser(); });
    window.localStorage.setItem(config.authKeys.account, JSON.stringify({ username: 'admin' })); // tanpa salt/hash
    const v = await auth.verify('admin', 'apa saja 123');
    T.eq(v.ok, false);
    window.localStorage.setItem(config.authKeys.session, '{rusak');
    window.sessionStorage.setItem(config.authKeys.session, 'bukan json');
    T.eq(auth.isAuthenticated(), false);
    resetAll();
  }, { skipIf: cryptoMissing });

  T.test('sesi "ingat saya" yang sudah kedaluwarsa tidak dianggap login', async () => {
    resetAll();
    await auth.createAccount({ name: 'Admin', username: 'admin', password: 'Rahasia123' });
    window.sessionStorage.removeItem(config.authKeys.session);
    window.localStorage.setItem(config.authKeys.session, JSON.stringify({ u: 'admin', exp: Date.now() - 1000 }));
    T.eq(auth.isAuthenticated(), false);
    window.localStorage.setItem(config.authKeys.session, JSON.stringify({ u: 'admin', exp: Date.now() + 100000 }));
    T.eq(auth.isAuthenticated(), true);
    resetAll();
  }, { skipIf: cryptoMissing });

  // ======================================================================
  T.group('9b. Ketahanan tambahan');

  /** Jalankan fn saat SELURUH akses localStorage melempar SecurityError (mode privat ketat / kebijakan perusahaan). */
  function withBlockedStorage(fn) {
    const g = Storage.prototype.getItem, s = Storage.prototype.setItem, d = Storage.prototype.removeItem;
    const boom = function () { throw new DOMException('akses penyimpanan diblokir', 'SecurityError'); };
    Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom;
    try { return fn(); } finally { Storage.prototype.getItem = g; Storage.prototype.setItem = s; Storage.prototype.removeItem = d; }
  }

  T.test('penyimpanan browser diblokir total: storage/store/net-store/login tidak crash dan melapor gagal', () => {
    resetAll();
    withBlockedStorage(() => {
      const l = storage.load();
      T.eq(l.ok, false);
      T.eq(storage.save([{ a: 1 }]).ok, false);
      T.noThrow(() => { store.init(); ns.init(); });
      T.eq(store.add({ namaGerai: 'X', vendor: 'HSI' }).ok, false);
      T.eq(store.all().length, 0, 'tidak boleh ada data hantu');
      T.noThrow(() => { auth.hasAccount(); auth.isAuthenticated(); auth.currentUser(); auth.lockRemaining(); auth.logout(); });
    });
  });

  T.test('login: argumen API aneh (undefined, null, objek, angka, teks raksasa) tidak crash dan ditolak', async () => {
    resetAll();
    T.eq((await auth.createAccount()).ok, false);
    T.eq((await auth.createAccount(undefined)).ok, false);
    T.eq((await auth.createAccount({})).ok, false);
    T.eq((await auth.createAccount({ username: 'admin', password: 12345678 })).ok, false, 'password angka');
    T.eq((await auth.createAccount({ username: 'admin', password: ['Abc12345'] })).ok, false, 'password array');
    T.eq((await auth.createAccount({ username: 'admin', password: 'A1' + 'x'.repeat(5000) })).ok, false, 'password terlalu panjang');
    await auth.createAccount({ name: 'A', username: 'admin', password: 'Rahasia123' });
    resetAllKeepAuth();
    for (const [u, p] of [[null, null], [undefined, undefined], [{}, []], [123, 456], ['admin', 'x'.repeat(5000)], ['a'.repeat(5000), 'Rahasia123']]) {
      const v = await auth.verify(u, p);
      T.eq(v.ok, false, 'verify(' + typeof u + ',' + typeof p + ')');
    }
    resetAll();
  }, { skipIf: cryptoMissing });

  /** Reset penghitung percobaan login tanpa menghapus akun (agar tes verify tidak terkunci oleh percobaan gagal sebelumnya). */
  function resetAllKeepAuth() { window.localStorage.removeItem(config.authKeys.lock); }

  T.test('ekspor CSV menetralkan injeksi rumus (= + - @) tetapi tidak merusak angka dan placeholder', () => {
    resetAll();
    store.addMany([{ namaGerai: '=HYPERLINK("http://jahat","klik")', alamat: '+1+2', catatan: '@SUM(1+1)', idPelanggan: '-2+3', kodeInduk: '-', po: '-12', vendor: 'HSI', akhirSewa: '2026-12-31' }]);
    const line = csv.toCsv(store.filtered(), '2026').split('\r\n')[1];
    T.ok(line.indexOf("'=HYPERLINK") > -1, 'rumus = harus diawali tanda petik: ' + line);
    T.ok(line.indexOf("'+1+2") > -1 && line.indexOf("'@SUM") > -1 && line.indexOf("'-2+3") > -1, 'rumus + @ - harus dinetralkan');
    T.ok(/^-,/.test(line) || line.indexOf(',-,') > -1 || line.indexOf('-,') === 0, 'strip tunggal tetap apa adanya');
    T.eq(csv.rowsToCsv([['=1+1', 5, -7, '-3', 'aman']]).replace(/^\ufeff/, ''), "'=1+1,5,-7,-3,aman");
    resetAll();
  });
  // ======================================================================
  T.group('10. Isolasi tes');

  T.test('tes tidak menyentuh data aplikasi asli (key tanpa namespace)', () => {
    resetAll();
    const plain = ['isp-pendataan-v1', 'isp-network-v1', 'isp-auth-v1', 'isp-session-v1', 'isp-auth-lock', 'isp-seeded-v1'];
    T.ok(plain.every((k) => config.storageKey !== k && config.netStorageKey !== k && Object.keys(config.authKeys).every((n) => config.authKeys[n] !== k)), 'key tes harus ber-namespace: ' + config.storageKey);
  });

  // Dibersihkan di akhir agar tidak meninggalkan sampah di penyimpanan browser.
  T.test('pembersihan akhir', () => { resetAll(); T.ok(true); });
})();
