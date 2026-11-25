/*
 * ui.js - Tes antarmuka: memuat aplikasi ASLI (../index.html) di dalam iframe ber-namespace "unit".
 * Lebar iframe = lebar layar (media query ikut berubah), jadi tampilan laptop/tablet/ponsel diuji nyata.
 * Mencakup: kasus kosong, data besar, data rusak/XSS, input salah (form & impor), dialog, menu, dan layar login.
 */
(function () {
  const { auth, config, utils } = App;
  const NS = '.unit';

  // ---------- Bantuan ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Tunggu sampai cond() benar (polling) atau lempar error setelah timeout. */
  async function waitFor(cond, timeout, what) {
    const end = Date.now() + (timeout || 10000);
    while (Date.now() < end) { try { if (cond()) return; } catch (e) { /* belum siap */ } await sleep(50); }
    throw new Error('timeout menunggu: ' + (what || 'kondisi'));
  }

  function wipe() {
    Object.keys(window.localStorage).filter((k) => k.indexOf(NS) !== -1).forEach((k) => window.localStorage.removeItem(k));
    Object.keys(window.sessionStorage).filter((k) => k.indexOf(NS) !== -1).forEach((k) => window.sessionStorage.removeItem(k));
  }

  function genRecords(n, opts) {
    const o = opts || {};
    const out = [];
    for (let i = 0; i < n; i++) {
      const pays = utils.emptyPayments().map((_, m) => (m >= 5 && m <= 10 ? 500000 + ((i * 37 + m * 11) % 90) * 10000 : null));
      out.push({
        kodeInduk: String(1000 + i), po: i % 3 ? '-' : String(i % 20), namaGerai: (o.namePrefix || 'Sicepat Ekspres Uji ') + i,
        alamat: 'Jl. Uji Coba No. ' + i + ', Kecamatan Contoh, Kota Contoh, Jawa Barat 4' + String(1000 + (i % 9000)),
        akhirSewa: utils.addDays(o.nearExpiry ? (i % 25) - 5 : ((i * 53) % 700) - 200), status: o.allActive || i % 4 ? 'Active' : 'Inactive',
        idPelanggan: 'ID-' + i, vendor: config.vendors[i % config.vendors.length], remark: i % 4 ? 'Existing' : 'Takeout', catatan: i % 4 ? '' : 'Nov 25',
        payments: { '2026': pays }
      });
    }
    return out;
  }

  function genNet(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ codeAnalytic: 'AN-' + i, namaGerai: 'Gerai Net ' + i, fungsi: i % 2 ? 'LM' : 'LM + FM', alamat: 'Jl. Net ' + i + ' Kota Contoh', vendor: config.vendors[i % 7], rasio: config.netRatios[i % 4], bandwidth: '50 Mbps', ssid: 'SCP-' + i, ipGateway: '10.0.' + (i % 250) + '.1', ipAddress: '10.0.' + (i % 250) + '.2/24', dns: '8.8.8.8, 1.1.1.1', mikrotikType: 'hAP ac2', snMikrotik: 'SN-' + i });
    }
    return out;
  }

  /**
   * Buka aplikasi di iframe tersembunyi dengan penyimpanan yang sudah disiapkan.
   * opsi: width, height, hash, records/raw (data gerai), netRecords/netRaw, noAuth (tampilkan layar login), seed (izinkan data awal).
   */
  async function openApp(opts) {
    const o = Object.assign({ width: 1280, height: 800, hash: '#dashboard' }, opts || {});
    wipe();
    if (!o.noAuth) {
      const made = await auth.createAccount({ name: 'Uji', username: 'uji', password: 'Uji12345' });
      if (!made.ok) throw new Error('gagal menyiapkan akun uji: ' + made.error);
      auth.startSession('uji', false);
    }
    if (!o.seed) window.localStorage.setItem(config.seedFlagKey, '1');   // cegah data awal Excel terisi otomatis
    if (o.raw !== undefined) window.localStorage.setItem(config.storageKey, o.raw);
    else if (o.records) window.localStorage.setItem(config.storageKey, JSON.stringify(o.records));
    if (o.netRaw !== undefined) window.localStorage.setItem(config.netStorageKey, o.netRaw);
    else if (o.netRecords) window.localStorage.setItem(config.netStorageKey, JSON.stringify(o.netRecords));

    const fr = document.createElement('iframe');
    fr.style.cssText = 'width:' + o.width + 'px;height:' + o.height + 'px;border:0;background:#fff';
    fr.src = '../index.html?ns=unit' + o.hash;
    document.getElementById('frames').appendChild(fr);
    await new Promise((res, rej) => { fr.onload = res; setTimeout(() => rej(new Error('iframe tidak selesai dimuat')), 30000); });
    if (!o.noAuth) await waitFor(() => !fr.contentDocument.body.classList.contains('is-locked') && fr.contentWindow.App && fr.contentWindow.App.store, 15000, 'aplikasi siap');
    else await waitFor(() => fr.contentDocument.getElementById('authForm'), 10000, 'layar login');
    // Animasi/transisi dimatikan: yang diuji adalah geometri tata letak, bukan animasinya. Pada halaman
    // tersembunyi (browser headless) animasi CSS tidak berjalan sehingga posisi akhir tidak pernah tercapai.
    const noMotion = fr.contentDocument.createElement('style');
    noMotion.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    fr.contentDocument.head.appendChild(noMotion);
    await sleep(300);
    const ctx = {
      fr, win: fr.contentWindow, doc: fr.contentDocument,
      resize(w, h) { fr.style.width = w + 'px'; if (h) fr.style.height = h + 'px'; return sleep(280); },
      async go(page) { fr.contentWindow.location.hash = page; await sleep(250); },
      toasts() { return Array.from(fr.contentDocument.querySelectorAll('.toast')).map((t) => t.textContent); },
      close() { fr.remove(); }
    };
    return ctx;
  }

  /** Laporan elemen yang melewati batas lebar layar (halaman tidak boleh bergeser ke samping). */
  function overflowIssues(ctx, label) {
    const { doc, win } = ctx;
    const W = win.innerWidth;
    const issues = [];
    const de = doc.documentElement;
    if (de.scrollWidth > W + 1) issues.push(label + ': halaman melebar (scrollWidth ' + de.scrollWidth + ' > lebar ' + W + ')');
    const sels = ['.topbar', '.topbar > *:not([hidden])', '.page-head', '[data-page]:not([hidden]) .panel', '[data-page]:not([hidden]) .kpi', '[data-page]:not([hidden]) .net-stat', '.pager', '.auth-card'];
    sels.forEach((s) => doc.querySelectorAll(s).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > W + 1 || r.left < -1)) issues.push(label + ': ' + s + ' keluar layar (' + Math.round(r.left) + '..' + Math.round(r.right) + ' dari ' + W + ')');
    }));
    return issues;
  }

  function dialogIssues(ctx, id, label) {
    const d = ctx.doc.getElementById(id);
    const W = ctx.win.innerWidth, H = ctx.win.innerHeight;
    const r = d.getBoundingClientRect();
    const issues = [];
    if (r.left < -1 || r.right > W + 1) issues.push(label + ': dialog ' + id + ' melebihi lebar layar (' + Math.round(r.left) + '..' + Math.round(r.right) + ' dari ' + W + ')');
    if (r.top < -1 || r.bottom > H + 1) issues.push(label + ': dialog ' + id + ' melebihi tinggi layar (' + Math.round(r.top) + '..' + Math.round(r.bottom) + ' dari ' + H + ')');
    return issues;
  }

  const errorToasts = (ctx) => ctx.toasts().filter((t) => /Terjadi kesalahan|gagal ditampilkan/.test(t));
  const HOSTILE_NAMES = ['<img src=x onerror="window.__xss=(window.__xss||0)+1">', '"><svg onload="window.__xss=(window.__xss||0)+1">', '<script>window.__xss=(window.__xss||0)+1</script>', "' onmouseover='window.__xss=1' x='", '&lt;b&gt;sudah-escape&lt;/b&gt;'];

  // ======================================================================
  T.group('11. UI - kasus kosong');

  T.test('aplikasi tanpa data: semua halaman tampil dengan keadaan kosong yang jelas, tanpa error', async () => {
    const c = await openApp({});
    try {
      T.eq(errorToasts(c), []);
      T.eq(c.doc.getElementById('statTotal').textContent, '0');
      await c.go('#data');
      T.ok(/Belum ada data gerai/.test(c.doc.getElementById('tableBody').innerText), 'pesan kosong Data Gerai');
      T.ok(c.doc.querySelector('#tableBody [data-action="add"]'), 'tombol tambah di keadaan kosong');
      await c.go('#network');
      T.ok(/Belum ada Data Network/.test(c.doc.getElementById('netBody').innerText), 'pesan kosong Data Network');
      await c.go('#rekap');
      T.eq(c.doc.querySelectorAll('#chartTable tbody tr').length, 7, 'rekap tetap menampilkan 7 baris ISP');
      await c.go('#dashboard');
      T.ok(!c.doc.getElementById('chartsEmpty').hidden, 'pesan "belum ada data pembayaran"');
      T.eq(c.toasts().filter((t) => /gagal/i.test(t)), [], 'tidak ada toast error');
    } finally { c.close(); }
  });

  T.test('ekspor & template dari keadaan kosong tidak menimbulkan error', async () => {
    const c = await openApp({});
    try {
      c.doc.querySelector('[data-file="template"][data-format="csv"]').click();
      c.doc.querySelector('[data-file="export"][data-format="csv"]').click();   // tidak ada data -> toast info
      await sleep(200);
      T.eq(errorToasts(c), []);
      T.ok(c.toasts().some((t) => /Tidak ada data untuk diekspor/.test(t)));
    } finally { c.close(); }
  });

  // ======================================================================
  T.group('12. UI - data rusak dan serangan XSS');

  T.test('JSON rusak di penyimpanan: aplikasi tetap terbuka, memberi tahu, dan membuat cadangan', async () => {
    const c = await openApp({ raw: '{ini rusak', netRaw: '[[[' });
    try {
      T.ok(c.toasts().some((t) => /Gagal membaca data tersimpan/.test(t)), 'harus ada pesan: ' + c.toasts().join(' | '));
      T.ok(Object.keys(window.localStorage).some((k) => k.indexOf(config.storageKey + '.rusak-') === 0), 'cadangan data gerai rusak');
      T.ok(Object.keys(window.localStorage).some((k) => k.indexOf(config.netStorageKey + '.rusak-') === 0), 'cadangan data network rusak');
      await c.go('#data');
      T.ok(/Belum ada data gerai/.test(c.doc.getElementById('tableBody').innerText));
      T.eq(errorToasts(c), []);
    } finally { c.close(); }
  });

  T.test('isi penyimpanan campur aduk (null, angka, teks, tipe salah, nilai ekstrem): semua halaman tetap tampil', async () => {
    const hostile = [null, 42, 'teks', [], { id: { a: 1 }, namaGerai: { x: 1 }, vendor: 123, akhirSewa: '2026-02-31', payments: 'x' }, { namaGerai: 'A'.repeat(10000), alamat: 'B'.repeat(50000), payments: { '2026': [-1, 'x', 1e308, 5], __proto__: [1] } }, { namaGerai: 'Normal', vendor: 'HSI', alamat: 'x', payments: { '2026': [null, null, null, null, null, 1000] } }];
    const c = await openApp({ raw: JSON.stringify(hostile), netRaw: JSON.stringify([null, 7, { fungsi: 'x', rasio: 'y', namaGerai: 'Net' }, { ipAddress: { a: 1 } }]) });
    try {
      for (const p of ['#dashboard', '#data', '#network', '#rekap']) { await c.go(p); T.eq(errorToasts(c), [], 'halaman ' + p); }
      T.eq(c.doc.querySelectorAll('#tableBody tr').length > 0, true);
      T.ok(c.doc.getElementById('tableBody').innerText.length < 20000, 'teks panjang harus dipangkas');
      T.eq(overflowIssues(c, 'rusak'), []);
    } finally { c.close(); }
  });

  T.test('XSS: nama/alamat/vendor berisi HTML+skrip tampil sebagai teks di semua halaman, tidak dieksekusi', async () => {
    const recs = HOSTILE_NAMES.map((n, i) => ({ kodeInduk: '9' + i, namaGerai: n, alamat: n, idPelanggan: n, catatan: n, vendor: config.vendors[i % 7], status: 'Active', remark: 'Takeout', akhirSewa: utils.addDays(3 + i), payments: { '2026': [null, null, null, null, null, 1000000] } }));
    const net = HOSTILE_NAMES.map((n, i) => ({ codeAnalytic: n, namaGerai: n, alamat: n, fungsi: 'LM', rasio: '1:1', vendor: config.vendors[i % 7], bandwidth: n, ssid: n, mikrotikType: n, snMikrotik: n }));
    const c = await openApp({ records: recs, netRecords: net });
    try {
      for (const p of ['#dashboard', '#data', '#network', '#rekap']) { await c.go(p); }
      // Beri waktu cukup agar event onerror/onload asinkron (bila ada payload yang lolos) sempat berjalan.
      // Pemeriksaan DOM di bawah bersifat sinkron dan tidak bergantung pada waktu.
      await sleep(1200);
      T.eq(c.win.__xss, undefined, 'skrip penyerang tereksekusi!');
      T.eq(window.__xss, undefined);
      T.eq(c.doc.querySelectorAll('img[src="x"], svg[onload], [onerror], [onload], [onmouseover]').length, 0, 'elemen/atribut berbahaya muncul di DOM');
      T.eq(Array.from(c.doc.querySelectorAll('script:not([src])')).filter((s) => /__xss/.test(s.textContent)).length, 0, 'skrip sisipan di DOM');
      await c.go('#data');
      const tableText = c.doc.getElementById('tableBody').innerText;
      T.ok(tableText.indexOf('<img src=x') > -1, 'payload harus terlihat sebagai teks biasa');
      T.ok(tableText.indexOf('&lt;b&gt;') > -1, 'entitas HTML tidak boleh di-decode ganda');
      await c.go('#dashboard');
      T.ok(c.doc.getElementById('expiringList').innerText.indexOf('<img src=x') > -1, 'daftar sewa berakhir juga aman');
      // buka dialog ubah: nilai input memuat payload apa adanya (bukan HTML)
      await c.go('#data');
      c.doc.querySelector('#tableBody [data-action="edit"]').click();
      await sleep(150);
      T.ok(c.doc.getElementById('fNamaGerai').value.length > 0);
      T.eq(c.win.__xss, undefined);
      c.doc.getElementById('formDialog').close();
    } finally { c.close(); }
  });

  // ======================================================================
  T.group('13. UI - data besar');

  T.test('3.000 gerai + 3.000 data network: halaman tetap responsif, paginasi/cari/urut berfungsi', async () => {
    const c = await openApp({ records: genRecords(3000), netRecords: genNet(3000) });
    try {
      T.eq(errorToasts(c), []);
      T.eq(c.doc.getElementById('statTotal').textContent, '3.000');
      const timing = {};
      const time = (name, fn) => { const t = performance.now(); fn(); timing[name] = Math.round(performance.now() - t); };
      time('render dashboard', () => c.win.App.summary.render());
      time('render tabel', () => c.win.App.table.render());
      time('render grafik+rekap', () => c.win.App.charts.render());
      time('render network', () => c.win.App.network.render());
      await c.go('#data');
      T.ok(/dari 3000 data/.test(c.doc.getElementById('pagerInfo').textContent), c.doc.getElementById('pagerInfo').textContent);
      const si = c.doc.getElementById('searchInput');
      si.value = 'uji 2999'; si.dispatchEvent(new c.win.Event('input')); await sleep(450);
      T.ok(/dari 1 data|1–1 dari 1/.test(c.doc.getElementById('pagerInfo').textContent), 'hasil cari: ' + c.doc.getElementById('pagerInfo').textContent);
      si.value = ''; si.dispatchEvent(new c.win.Event('input')); await sleep(450);
      c.doc.querySelector('#tableHead button[data-sort="sisa"]').click(); await sleep(100);
      const ps = c.doc.getElementById('pageSize'); ps.value = '100'; ps.dispatchEvent(new c.win.Event('change')); await sleep(100);
      for (let i = 0; i < 40; i++) c.doc.getElementById('pageNext').click();
      T.ok(/Hal\. 30 \/ 30/.test(c.doc.getElementById('pageLabel').textContent), 'halaman terakhir: ' + c.doc.getElementById('pageLabel').textContent);
      T.ok(c.doc.getElementById('pageNext').disabled, 'tombol berikutnya nonaktif di halaman terakhir');
      T.eq(c.doc.querySelectorAll('#tableBody tr').length, 100);
      await c.go('#network');
      T.ok(/dari 3000 data/.test(c.doc.getElementById('netPagerInfo').textContent), c.doc.getElementById('netPagerInfo').textContent);
      await c.go('#rekap');
      T.eq(c.doc.querySelectorAll('#chartTable tbody tr').length, 7);
      T.note('waktu render: ' + Object.keys(timing).map((k) => k + ' ' + timing[k] + ' ms').join(', '));
      T.ok(Object.keys(timing).every((k) => timing[k] < 1500), 'ada render > 1,5 detik');
      T.eq(errorToasts(c), []);
    } finally { c.close(); }
  });

  // ======================================================================
  T.group('14. UI - input salah (form & impor)');

  T.test('form gerai: kosong ditolak dengan daftar error; teks super panjang dipangkas saat disimpan', async () => {
    const c = await openApp({ hash: '#data' });
    try {
      c.doc.getElementById('btnAdd').click(); await sleep(150);
      c.doc.getElementById('gerForm').requestSubmit(); await sleep(150);
      T.ok(!c.doc.getElementById('formErrors').hidden, 'error harus tampil');
      T.ok(/wajib/i.test(c.doc.getElementById('formErrors').innerText));
      T.eq(c.win.App.store.all().length, 0, 'tidak boleh tersimpan');
      T.eq([c.doc.getElementById('fNamaGerai').maxLength, c.doc.getElementById('fAlamat').maxLength], [config.limits.nama, config.limits.alamat], 'atribut maxlength sesuai config');
      c.doc.getElementById('fNamaGerai').value = 'N'.repeat(1000);
      c.doc.getElementById('fAlamat').value = 'A'.repeat(5000);
      c.doc.getElementById('fVendor').value = 'HSI';
      c.doc.getElementById('gerForm').requestSubmit(); await sleep(200);
      const saved = c.win.App.store.all();
      T.eq(saved.length, 1);
      T.eq([saved[0].namaGerai.length, saved[0].alamat.length], [config.limits.nama, config.limits.alamat]);
      T.eq(errorToasts(c), []);
    } finally { c.close(); }
  });

  T.test('form Data Network: IP/DNS salah ditolak dengan pesan; data valid tersimpan', async () => {
    const c = await openApp({ hash: '#network' });
    try {
      const set = (id, v) => { c.doc.getElementById(id).value = v; };
      c.doc.getElementById('btnNetAdd').click(); await sleep(150);
      set('nGerai', 'Uji'); set('nFungsi', 'LM'); set('nVendor', 'HSI'); set('nRasio', '1:2'); set('nGateway', '999.1.1.1'); set('nIp', '1.2.3'); set('nDns', 'abc');
      c.doc.getElementById('netForm').requestSubmit(); await sleep(150);
      const err = c.doc.getElementById('netFormErrors');
      T.ok(!err.hidden && /Gateway/.test(err.innerText) && /IP Address/.test(err.innerText) && /DNS/.test(err.innerText), err.innerText);
      T.eq(c.win.App.netStore.all().length, 0);
      set('nGateway', '10.0.0.1'); set('nIp', '10.0.0.2/24'); set('nDns', '8.8.8.8, 1.1.1.1');
      c.doc.getElementById('netForm').requestSubmit(); await sleep(200);
      T.eq(c.win.App.netStore.all().length, 1);
      T.eq(errorToasts(c), []);
    } finally { c.close(); }
  });

  T.test('tabel Data Network: Rasio+Bandwidth digabung, tanpa kolom Aksi, Status Gerai diubah dari tabel, klik nama = ubah, hapus lewat form', async () => {
    const nets = genNet(6);
    nets[0].statusGerai = 'Terminated'; nets[1].statusGerai = 'Merger';
    const c = await openApp({ hash: '#network', netRecords: nets });
    try {
      const heads = Array.from(c.doc.querySelectorAll('#netHead th')).map((th) => th.textContent.replace(/[↕▲▼]/g, '').replace(/\s+/g, ' ').trim());
      T.ok(heads.indexOf('Aksi') === -1, 'kolom Aksi harus hilang: ' + heads.join('|'));
      T.ok(heads.indexOf('Bandwidth') === -1 && heads.indexOf('Rasio / Bandwidth') > -1, 'Rasio dan Bandwidth harus satu kolom: ' + heads.join('|'));
      T.eq(heads[heads.length - 1], 'Status Gerai', 'kolom terakhir = Status Gerai');
      const rows = c.doc.querySelectorAll('#netBody tr');
      T.eq(rows.length, 6);
      T.ok(/^1:\d\s*50 Mbps$/.test(rows[0].children[5].innerText.replace(/\s+/g, ' ').trim().replace(/^(\d:\d) /, '$1 ')) || /50 Mbps/.test(rows[0].children[5].innerText), 'sel gabungan berisi rasio dan bandwidth: ' + rows[0].children[5].innerText);
      T.eq(rows[0].children.length, heads.length, 'jumlah <td> harus sama dengan jumlah header');
      const sel = (i) => rows[i].querySelector('select[data-net-status]');
      T.eq(Array.from(sel(0).options).map((o) => o.value), ['Aktif', 'Terminated', 'Merger']);
      T.eq([sel(0).value, sel(1).value, sel(2).value], ['Terminated', 'Merger', 'Aktif']);
      T.ok(c.doc.querySelector('#netBody [data-net="delete"]') === null, 'tombol Hapus per baris tidak ada lagi');

      // ubah status dari tabel -> tersimpan permanen
      const target = c.win.App.netStore.all().find((r) => r.namaGerai === 'Gerai Net 2');
      const s2 = c.doc.querySelector('select[data-net-status][data-id="' + target.id + '"]');
      s2.value = 'Merger'; s2.dispatchEvent(new c.win.Event('change', { bubbles: true })); await sleep(200);
      T.eq(c.win.App.netStore.find(target.id).statusGerai, 'Merger');
      T.eq(JSON.parse(c.win.localStorage.getItem(config.netStorageKey)).find((r) => r.id === target.id).statusGerai, 'Merger', 'harus tersimpan di penyimpanan');
      T.ok(c.doc.querySelector('select[data-net-status][data-id="' + target.id + '"]').classList.contains('st-merger'), 'warna pil ikut berubah');

      // simpan gagal -> status dikembalikan dan ada pesan
      const orig = c.win.Storage.prototype.setItem;
      c.win.Storage.prototype.setItem = function () { throw new c.win.DOMException('penuh', 'QuotaExceededError'); };
      try {
        const s3 = c.doc.querySelector('select[data-net-status][data-id="' + target.id + '"]');
        s3.value = 'Terminated'; s3.dispatchEvent(new c.win.Event('change', { bubbles: true })); await sleep(200);
      } finally { c.win.Storage.prototype.setItem = orig; }
      T.eq(c.win.App.netStore.find(target.id).statusGerai, 'Merger', 'simpan gagal -> status tidak berubah');
      T.eq(c.doc.querySelector('select[data-net-status][data-id="' + target.id + '"]').value, 'Merger', 'dropdown dikembalikan ke nilai tersimpan');
      T.ok(c.toasts().some((t) => /Gagal menyimpan/.test(t)));

      // filter status
      const fs = c.doc.getElementById('netFilterStatus');
      fs.value = 'Terminated'; fs.dispatchEvent(new c.win.Event('change')); await sleep(150);
      T.eq(c.doc.querySelectorAll('#netBody tr').length, 1, 'filter Terminated');
      fs.value = ''; fs.dispatchEvent(new c.win.Event('change')); await sleep(150);

      // klik nama -> form ubah; tombol hapus hanya ada di mode ubah
      c.doc.querySelector('#netBody [data-net="edit"]').click(); await sleep(200);
      T.ok(c.doc.getElementById('netDialog').open, 'form ubah terbuka');
      T.eq(c.doc.getElementById('netFormDelete').hidden, false, 'tombol Hapus tampil di mode ubah');
      T.eq(c.doc.getElementById('nStatus').options.length, 3);
      const editName = c.doc.getElementById('nGerai').value;
      c.doc.getElementById('netFormDelete').click(); await sleep(200);
      T.ok(!c.doc.getElementById('netDialog').open && c.doc.getElementById('netDeleteDialog').open, 'form tertutup, konfirmasi hapus terbuka');
      T.ok(c.doc.getElementById('netDeleteName').textContent.indexOf(editName) > -1, 'konfirmasi menyebut nama yang benar');
      c.doc.getElementById('netDeleteConfirm').click(); await sleep(250);
      T.eq(c.win.App.netStore.all().length, 5, 'satu data terhapus');
      T.ok(!c.win.App.netStore.all().some((r) => r.namaGerai === editName));

      // mode tambah: tombol hapus tersembunyi, status bawaan Aktif
      c.doc.getElementById('btnNetAdd').click(); await sleep(150);
      T.eq(c.doc.getElementById('netFormDelete').hidden, true, 'tidak ada Hapus di mode tambah');
      T.eq(c.doc.getElementById('nStatus').value, 'Aktif', 'bawaan Aktif');
      c.doc.getElementById('netDialog').close();
      T.eq(errorToasts(c), []);
    } finally { c.close(); }
  });

  T.test('impor Data Network: kolom Status Gerai dibaca (ejaan bebas); status asing menolak barisnya', async () => {
    const c = await openApp({ hash: '#network' });
    try {
      const csvText = 'Nama Gerai,Function,Nama ISP,Rasio,Status Gerai\r\nA,LM,HSI,1:2,Terminated\r\nB,LM,HSI,1:2,marger\r\nC,LM,HSI,1:2,\r\nD,LM,HSI,1:2,Ditutup\r\n';
      const dt = new c.win.DataTransfer(); dt.items.add(new c.win.File([csvText], 'net.csv', { type: 'text/csv' }));
      const input = c.doc.getElementById('netImportFile'); input.files = dt.files; input.dispatchEvent(new c.win.Event('change', { bubbles: true })); await sleep(900);
      const byName = {}; c.win.App.netStore.all().forEach((r) => { byName[r.namaGerai] = r.statusGerai; });
      T.eq(byName, { A: 'Terminated', B: 'Merger', C: 'Aktif' }, 'D (status asing) harus ditolak');
      T.ok(c.toasts().some((t) => /Status Gerai/.test(t)), 'pesan menyebut Status Gerai: ' + c.toasts().join('|'));
    } finally { c.close(); }
  });

  T.test('Hapus Semua Data Network: konfirmasi menyebut jumlah, Batal aman, konfirmasi menghapus, Data Gerai utuh', async () => {
    const c = await openApp({ hash: '#network', records: genRecords(12), netRecords: genNet(461) });
    try {
      const btn = c.doc.getElementById('btnNetClear');
      T.eq(btn.disabled, false, 'tombol aktif saat ada data');
      btn.click(); await sleep(150);
      const dlg = c.doc.getElementById('netClearDialog');
      T.ok(dlg.open, 'dialog konfirmasi harus terbuka');
      T.eq(c.doc.getElementById('netClearCount').textContent, '461', 'jumlah data harus disebut');
      c.doc.getElementById('netClearCancel').click(); await sleep(100);
      T.ok(!dlg.open && c.win.App.netStore.all().length === 461, 'Batal tidak boleh menghapus apa pun');

      // simpan gagal saat konfirmasi: data tetap ada dan pesan error muncul
      btn.click(); await sleep(100);
      const orig = c.win.Storage.prototype.setItem;
      c.win.Storage.prototype.setItem = function () { throw new c.win.DOMException('penuh', 'QuotaExceededError'); };
      try { c.doc.getElementById('netClearConfirm').click(); await sleep(200); } finally { c.win.Storage.prototype.setItem = orig; }
      T.eq(c.win.App.netStore.all().length, 461, 'simpan gagal -> data tidak boleh hilang');
      T.ok(c.toasts().some((t) => /Gagal menyimpan/.test(t)), 'pesan gagal: ' + c.toasts().join('|'));

      c.doc.querySelectorAll('.toast').forEach((t) => t.remove());
      btn.click(); await sleep(100);
      c.doc.getElementById('netClearConfirm').click(); await sleep(250);
      T.eq(c.win.App.netStore.all().length, 0, 'semua Data Network terhapus');
      T.eq(JSON.parse(c.win.localStorage.getItem(config.netStorageKey)), [], 'penyimpanan ikut kosong');
      T.eq(c.win.App.store.all().length, 12, 'Data Gerai TIDAK boleh ikut terhapus');
      T.ok(/Belum ada Data Network/.test(c.doc.getElementById('netBody').innerText), 'tampilan kosong');
      T.eq(c.doc.getElementById('navNetCount').textContent, '0');
      T.eq(c.doc.getElementById('btnNetClear').disabled, true, 'tombol nonaktif saat kosong');
      T.ok(c.toasts().some((t) => /461/.test(t) && /dihapus/.test(t)), 'toast sukses: ' + c.toasts().join('|'));
      T.eq(errorToasts(c), []);
    } finally { c.close(); }
  });

  /** Kirim File ke input impor di dalam iframe lalu tunggu aplikasi memprosesnya. */
  async function feed(c, inputId, file) {
    const dt = new c.win.DataTransfer();
    dt.items.add(file);
    const input = c.doc.getElementById(inputId);
    input.files = dt.files;
    input.dispatchEvent(new c.win.Event('change', { bubbles: true }));
    await sleep(900);
  }

  T.test('impor file sampah/kosong/salah jenis/terlalu besar: ditolak dengan pesan, aplikasi tetap hidup (gerai & network)', async () => {
    const c = await openApp({ hash: '#data' });
    try {
      const junk = new Uint8Array(4096); for (let i = 0; i < junk.length; i++) junk[i] = (i * 131 + 7) % 256;
      const files = [
        ['sampah.xlsx', [junk]], ['sampah.csv', [junk]], ['kosong.csv', ['']], ['salah.pdf', ['%PDF-1.4 abc']],
        ['besar.csv', ['a'.repeat(config.maxImportBytes + 10)]], ['judul-saja.csv', ['Kode Induk,Nama Gerai,Nama Vendor\r\n']],
        ['ngawur.csv', ['"""",,,,\n;;;;;\n<<<>>>\n\u0000\u0001']]
      ];
      for (const [inputId, label] of [['importFile', 'gerai'], ['netImportFile', 'network']]) {
        for (const [name, parts] of files) {
          c.doc.querySelectorAll('.toast').forEach((t) => t.remove());
          await feed(c, inputId, new c.win.File(parts, name));
          const msgs = c.toasts();
          T.ok(msgs.length > 0, label + ' / ' + name + ': harus ada pesan untuk pengguna');
          T.ok(!msgs.some((t) => /berhasil diimpor/.test(t)), label + ' / ' + name + ': tidak boleh dianggap berhasil: ' + msgs.join('|'));
          T.eq(errorToasts(c), [], label + ' / ' + name + ': error tak terduga');
        }
      }
      T.eq(c.win.App.store.all().length + c.win.App.netStore.all().length, 0, 'tidak ada data yang masuk dari file buruk');
      T.ok(c.doc.getElementById('statTotal'), 'aplikasi masih hidup');
    } finally { c.close(); }
  });

  T.test('impor CSV campuran: baris benar masuk, baris salah dilewati dengan laporan', async () => {
    const c = await openApp({ hash: '#data' });
    try {
      const csvText = 'Kode Induk,Nama Gerai,Nama Vendor,Status,Remark,Juni\r\n1,Gerai Baik,HSI,Active,Existing,500000\r\n2,Gerai Vendor Salah,XXX,Active,Existing,1000\r\n3,Gerai Nominal Salah,HSI,Active,Existing,abc\r\n';
      await feed(c, 'importFile', new c.win.File([csvText], 'campur.csv', { type: 'text/csv' }));
      T.eq(c.win.App.store.all().length, 1);
      T.ok(c.toasts().some((t) => /berhasil diimpor/.test(t)) && c.toasts().some((t) => /Baris \d+/.test(t)), c.toasts().join(' | '));
    } finally { c.close(); }
  });

  T.test('penyimpanan penuh saat tambah data: pesan error tampil dan tabel tidak menampilkan data hantu', async () => {
    const c = await openApp({ hash: '#data' });
    try {
      const orig = c.win.Storage.prototype.setItem;
      c.win.Storage.prototype.setItem = function () { throw new c.win.DOMException('penuh', 'QuotaExceededError'); };
      try {
        c.doc.getElementById('btnAdd').click(); await sleep(150);
        c.doc.getElementById('fNamaGerai').value = 'Tidak boleh muncul'; c.doc.getElementById('fAlamat').value = 'x'; c.doc.getElementById('fVendor').value = 'HSI';
        c.doc.getElementById('gerForm').requestSubmit(); await sleep(250);
      } finally { c.win.Storage.prototype.setItem = orig; }
      T.eq(c.win.App.store.all().length, 0, 'data tidak boleh tersisa di memori');
      T.ok(!c.doc.getElementById('formErrors').hidden && /Gagal menyimpan/.test(c.doc.getElementById('formErrors').innerText), 'pesan di form');
      T.ok(/Belum ada data gerai/.test(c.doc.getElementById('tableBody').innerText), 'tabel tetap kosong');
    } finally { c.close(); }
  });

  // ======================================================================
  T.group('15. UI - responsif (laptop, tablet, ponsel)');

  const WIDTHS = [320, 360, 375, 414, 600, 768, 820, 1024, 1280, 1366, 1536, 1920];
  WIDTHS.forEach((w) => {
    T.test('lebar ' + w + ' px: 4 halaman + dialog tidak melebar/terpotong', async () => {
      const h = w < 700 ? 740 : 800;
      const c = await openApp({ width: w, height: h, records: genRecords(60, { nearExpiry: true }), netRecords: genNet(40) });
      const issues = [];
      try {
        for (const p of ['#dashboard', '#network', '#data', '#rekap']) {
          await c.go(p);
          issues.push.apply(issues, overflowIssues(c, p));
          if (p === '#rekap') {
            // Tabel rekap berlayout tetap: angka tidak boleh lebih lebar dari selnya (akan saling menimpa).
            await sleep(300);
            const bad = Array.from(c.doc.querySelectorAll('#chartTable td.num, #chartTable th.num')).filter((el) => el.scrollWidth > el.clientWidth + 1).length;
            if (bad) issues.push('rekap: ' + bad + ' sel angka lebih lebar dari kolomnya (saling menimpa/terpotong)');
          }
        }
        const toggleVisible = c.doc.getElementById('menuToggle').getBoundingClientRect().width > 0;
        if (w <= 900 && !toggleVisible) issues.push('tombol menu harus terlihat di layar ' + w);
        if (w > 900 && toggleVisible) issues.push('tombol menu tidak perlu terlihat di layar ' + w);
        // menu geser di layar kecil: buka, pilih halaman, tertutup sendiri
        if (w <= 900) {
          c.doc.getElementById('menuToggle').click(); await sleep(300);
          if (!c.doc.getElementById('sidenav').classList.contains('is-open')) issues.push('menu tidak terbuka setelah tombol menu diklik (kelas is-open tidak aktif)');
          if (c.doc.getElementById('menuToggle').getAttribute('aria-expanded') !== 'true') issues.push('aria-expanded harus "true" saat menu terbuka');
          const sr = c.doc.getElementById('sidenav').getBoundingClientRect();
          if (sr.left < -1 || sr.right > w + 1) issues.push('menu geser keluar layar: ' + Math.round(sr.left) + '..' + Math.round(sr.right));
          c.doc.querySelector('[data-nav="data"]').click(); await sleep(300);
          if (c.doc.getElementById('sidenav').classList.contains('is-open')) issues.push('menu harus menutup setelah memilih halaman');
        }
        // dialog
        await c.go('#data');
        c.doc.getElementById('btnAdd').click(); await sleep(200);
        issues.push.apply(issues, dialogIssues(c, 'formDialog', 'form gerai'));
        c.doc.getElementById('formDialog').close();
        c.doc.querySelector('#tableBody [data-action="delete"]').click(); await sleep(150);
        issues.push.apply(issues, dialogIssues(c, 'deleteDialog', 'hapus'));
        c.doc.getElementById('deleteDialog').close();
        await c.go('#network');
        c.doc.getElementById('btnNetAdd').click(); await sleep(200);
        issues.push.apply(issues, dialogIssues(c, 'netDialog', 'form network'));
        c.doc.getElementById('netDialog').close();
        c.doc.getElementById('btnNetClear').click(); await sleep(150);
        issues.push.apply(issues, dialogIssues(c, 'netClearDialog', 'hapus semua network'));
        c.doc.getElementById('netClearDialog').close();
        c.doc.getElementById('btnChangePw').click(); await sleep(150);
        issues.push.apply(issues, dialogIssues(c, 'pwDialog', 'ganti password'));
        c.doc.getElementById('pwDialog').close();
        // tema terang juga diperiksa
        c.doc.getElementById('themeToggle').click(); await sleep(150);
        for (const p of ['#dashboard', '#data']) { await c.go(p); issues.push.apply(issues, overflowIssues(c, 'terang ' + p)); }
        c.doc.documentElement.setAttribute('data-theme', 'dark');
        T.eq(errorToasts(c), [], 'error tak terduga');
      } finally { c.close(); }
      T.eq(issues, []);
    });
  });

  [320, 375, 768, 1366].forEach((w) => {
    T.test('layar login/pembuatan akun muat di lebar ' + w + ' px dan berfungsi', async () => {
      const c = await openApp({ width: w, height: 700, noAuth: true });
      try {
        T.ok(c.doc.body.classList.contains('is-locked'), 'aplikasi harus terkunci');
        T.eq(overflowIssues(c, 'login'), []);
        const set = (id, v) => { c.doc.getElementById(id).value = v; };
        set('authName', 'X'); set('authUser', 'adm'); set('authPass', 'Abcdefg1'); set('authPass2', 'Beda12345');
        c.doc.getElementById('authForm').requestSubmit(); await sleep(500);
        T.ok(/tidak sama/i.test(c.doc.getElementById('authError').textContent), c.doc.getElementById('authError').textContent);
        T.ok(c.doc.body.classList.contains('is-locked'), 'tetap terkunci');
        set('authPass2', 'Abcdefg1');
        c.doc.getElementById('authForm').requestSubmit(); await sleep(1500);
        T.ok(!c.doc.body.classList.contains('is-locked'), 'berhasil masuk setelah akun dibuat: ' + c.doc.getElementById('authError').textContent);
      } finally { c.close(); }
    }, { skipIf: () => !auth.cryptoAvailable() });
  });

  // ======================================================================
  T.group('16. Struktur proyek');

  T.test('semua <script>/<link>/<img> di index.html menunjuk file yang ada', async () => {
    const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
    const refs = [];
    const re = /(?:src|href)="((?!https?:|#|data:)[^"]+)"/g;
    let m;
    while ((m = re.exec(html))) refs.push(m[1]);
    T.ok(refs.length > 20, 'jumlah referensi: ' + refs.length);
    const missing = [];
    for (const ref of Array.from(new Set(refs))) {
      const res = await fetch('../' + ref, { cache: 'no-store' });
      if (!res.ok) missing.push(ref);
    }
    T.eq(missing, []);
  });

  T.test('urutan script: modul yang dibutuhkan selalu dimuat sebelum pemakainya', async () => {
    const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
    const order = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map((m) => m[1].split('/').pop());
    const before = (a, b) => order.indexOf(a) > -1 && order.indexOf(b) > -1 && order.indexOf(a) < order.indexOf(b);
    const rules = [['config.js', 'utils.js'], ['utils.js', 'store.js'], ['storage.js', 'store.js'], ['store.js', 'validation.js'], ['store.js', 'csv.js'], ['csv.js', 'excel.js'], ['csv.js', 'ui-network.js'], ['net-store.js', 'ui-network.js'], ['ui-nav.js', 'ui-auth.js'], ['data-awal.js', 'app.js']];
    const broken = rules.filter(([a, b]) => !before(a, b)).map((r) => r.join(' < '));
    T.eq(broken, []);
    T.eq(order[order.length - 1], 'app.js', 'app.js harus paling akhir');
  });

  // ======================================================================
  T.group('17. Kontrol negatif (membuktikan pendeteksi benar-benar bisa mendeteksi)');

  T.test('pendeteksi halaman melebar memang menandai elemen yang melebihi layar', async () => {
    const c = await openApp({ width: 360, height: 700, records: genRecords(5) });
    try {
      T.eq(overflowIssues(c, 'sebelum'), [], 'kondisi awal harus bersih');
      const st = c.doc.createElement('style');
      st.textContent = '.page-head { width: 900px !important; } .kpi { min-width: 800px !important; }';
      c.doc.head.appendChild(st);
      await sleep(200);
      const issues = overflowIssues(c, 'sesudah');
      T.ok(issues.length >= 2, 'pendeteksi harus menandai kerusakan buatan: ' + issues.length);
    } finally { c.close(); }
  });

  T.test('pendeteksi XSS memang menangkap payload bila HTML tidak di-escape', async () => {
    const c = await openApp({ records: genRecords(3) });
    try {
      c.doc.getElementById('statTotal').innerHTML = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
      // Event onerror gambar bersifat asinkron (menunggu 404 dari server): tunggu sampai terjadi, jangan menebak waktu.
      await waitFor(() => c.win.__xss === 1, 5000, 'payload kontrol (tanpa escape) tereksekusi');
      T.ok(c.win.__xss === 1, 'payload tidak sengaja yang tidak di-escape harus tereksekusi (bukti kontrol berfungsi)');
      T.ok(c.doc.querySelectorAll('img[src="x"], [onerror]').length > 0, 'selektor pemindai harus menemukan elemen berbahaya');
    } finally { c.close(); }
  });

  T.test('pembersihan akhir', () => { wipe(); T.ok(true); });
})();
