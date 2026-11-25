/* Halaman Data Network: tabel, form tambah/ubah, hapus, impor/ekspor Excel & CSV.
 *
 * Fitur      : halaman "Data Network" (lapisan tampilan/event; data & validasi ada di net-store.js).
 * Dependensi : App.netStore (ns), App.store (data gerai, untuk autofill/kerangka/datalist), App.utils,
 *              App.config, App.toast, App.csv (parse, rowsToCsv, download, matchVendor),
 *              App.excel (download, importBufferWith).
 * Diekspos   : { init, render, setQuery } -> init() dipanggil sekali saat start; render() untuk
 *              menggambar ulang; setQuery(q) dipanggil kotak cari global (#searchInput).
 *
 * TROUBLESHOOT: error "Cannot read properties of null (addEventListener)" saat init() -> ada id elemen
 * yang tidak ada di index.html (lihat daftar $('...') di file ini, mis. netBody, netHead, netForm,
 * netDialog, netDeleteDialog, netFilter*, netPage*, btnNet*, netImportFile, nXxx pada form).
 */
App.network = (function () {
  const { netStore: ns, store, utils, config, toast, csv } = App;
  const esc = utils.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const FIELDS = ns.FIELDS;
  // Kolom TAMPILAN tabel (urutan = urutan <td> di rowHtml). Berbeda dengan FIELDS (kolom DATA untuk ekspor/impor):
  // "Rasio" dan "Bandwidth" ditampilkan sebagai satu kolom, dan kolom terakhir = Status Gerai (bukan Aksi).
  // sort: true -> header berupa tombol urut (key = nama field di net-store.js; kolom gabungan diurutkan menurut rasio).
  const TABLE_COLUMNS = [
    { key: 'codeAnalytic', label: 'Code Analytic', sort: true },
    { key: 'namaGerai', label: 'Nama Gerai', sort: true },
    { key: 'fungsi', label: 'Function', sort: true },
    { key: 'alamat', label: 'Alamat' },
    { key: 'vendor', label: 'Nama ISP', sort: true },
    { key: 'rasio', label: 'Rasio / Bandwidth', sort: true },
    { key: 'ssid', label: 'SSID' },
    { key: 'ipGateway', label: 'IP Gateway' },
    { key: 'ipAddress', label: 'IP Address' },
    { key: 'dns', label: 'DNS' },
    { key: 'mikrotikType', label: 'Mikrotik Type' },
    { key: 'snMikrotik', label: 'SN Mikrotik' },
    { key: 'statusGerai', label: 'Status Gerai', sort: true }
  ];
  // Jumlah kolom untuk colspan baris kosong.
  const COL_COUNT = TABLE_COLUMNS.length;
  // id rekaman yang sedang diubah di form (null = mode tambah).
  let editingId = null;
  // id rekaman yang menunggu konfirmasi hapus di dialog.
  let pendingDeleteId = null;

  // ---------- render ----------
  // Isi kartu ringkasan (#netStats) dan badge jumlah di menu (#navNetCount) dari ns.stats().
  // Kartu "Belum lengkap" diberi kelas `warn` bila > 0.
  function renderStats() {
    const s = ns.stats();
    $('navNetCount').textContent = s.total;
    // Tombol "Hapus Semua" hanya aktif bila ada data.
    $('btnNetClear').disabled = !s.total;
    const item = (label, value, cls) => '<div class="net-stat ' + (cls || '') + '"><span>' + label + '</span><strong>' + utils.formatNumber(value) + '</strong></div>';
    $('netStats').innerHTML = item('Total Data Network', s.total) + item('Function LM', s.lm) + item('Function LM + FM', s.lmfm) +
      item('Belum lengkap (IP / SN kosong)', s.incomplete, s.incomplete ? 'warn' : '');
  }

  // Bangun header tabel (#netHead). Kolom di SORTABLE berupa tombol `data-sort="<key>"` + ikon panah
  // (▲ naik, ▼ turun, ↕ netral) dan aria-sort. Klik ditangani delegasi di init() pada #netHead.
  function renderHead() {
    const { key: sKey, dir } = ns.state.sort;
    const cells = TABLE_COLUMNS.map((f) => {
      if (!f.sort) return '<th scope="col">' + esc(f.label) + '</th>';
      const active = sKey === f.key;
      const arrow = active ? (dir === 'asc' ? '▲' : '▼') : '↕';
      return '<th scope="col" aria-sort="' + (active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="th-sort' + (active ? ' is-active' : '') + '" data-sort="' + f.key + '">' + esc(f.label) + ' <span aria-hidden="true">' + arrow + '</span></button></th>';
    });
    $('netHead').innerHTML = '<tr>' + cells.join('') + '</tr>';
  }

  // Sel teks yang di-escape; nilai kosong ditampilkan sebagai tanda "–" redup.
  function cell(v) { return v ? esc(v) : '<span class="muted">–</span>'; }

  // HTML satu baris tabel. Urutan <td> HARUS sama dengan urutan FIELDS (+ kolom Aksi di akhir).
  // Kelas CSS: `nw` = nowrap (cegah teks pendek terpotong ke baris baru); `brk` = boleh patah di
  // mana saja (teks panjang tanpa spasi seperti kode/SSID/SN); `mono` = font monospace untuk IP/SN;
  // `addr` = kolom alamat lebar fleksibel.
  // Tombol Ubah/Hapus memakai `data-net` + `data-id` untuk delegasi event di #netBody (lihat init()).
  // TROUBLESHOOT: kolom bergeser/judul tidak sejajar -> jumlah & urutan <td> tidak sama dengan FIELDS.
  // Semua nilai dari data pengguna wajib lewat esc()/cell() agar tidak ada injeksi HTML.
  function rowHtml(r) {
    const fungsi = r.fungsi ? '<span class="badge ' + (r.fungsi === 'LM' ? 'badge-info' : 'badge-ok') + '">' + esc(r.fungsi) + '</span>' : '<span class="muted">–</span>';
    // Kolom gabungan: lencana rasio + bandwidth di sampingnya (masing-masing "–" bila kosong).
    const rasio = r.rasio ? '<span class="badge badge-muted">' + esc(r.rasio) + '</span>' : '<span class="muted">–</span>';
    const rasioBw = rasio + ' <span class="bw">' + cell(r.bandwidth) + '</span>';
    // Status Gerai: dropdown langsung di tabel (ubah = tersimpan seketika; ditangani delegasi 'change' di init()).
    // Kelas st-<status> hanya untuk warna. Nilai di luar daftar tidak mungkin (normalize() memaksa ke daftar).
    const stOptions = config.netStatuses.map((s) => '<option value="' + esc(s) + '"' + (s === r.statusGerai ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
    const statusSel = '<select class="status-select st-' + esc(String(r.statusGerai).toLowerCase()) + '" data-net-status data-id="' + esc(r.id) + '" aria-label="Status gerai ' + esc(r.namaGerai) + '">' + stOptions + '</select>';
    return '<tr>' +
      '<td class="brk">' + cell(r.codeAnalytic) + '</td>' +
      // Nama gerai = tombol "ubah": klik membuka form ubah (menggantikan kolom Aksi); hapus ada di dalam form itu.
      '<td class="strong"><button type="button" class="link-btn" data-net="edit" data-id="' + esc(r.id) + '" title="Klik untuk mengubah / menghapus data ini">' + esc(r.namaGerai) + '</button></td>' +
      '<td class="nw">' + fungsi + '</td>' +
      '<td class="addr">' + cell(r.alamat) + '</td>' +
      '<td><span class="vendor">' + cell(r.vendor) + '</span></td>' +
      '<td class="nw">' + rasioBw + '</td>' +
      '<td class="brk">' + cell(r.ssid) + '</td>' +
      '<td class="mono nw">' + cell(r.ipGateway) + '</td>' +
      '<td class="mono nw">' + cell(r.ipAddress) + '</td>' +
      '<td class="mono">' + cell(r.dns) + '</td>' +
      '<td>' + cell(r.mikrotikType) + '</td>' +
      '<td class="mono brk">' + cell(r.snMikrotik) + '</td>' +
      '<td class="nw">' + statusSel + '</td></tr>';
  }

  // Baris pengganti saat tidak ada baris untuk ditampilkan. Dua kasus:
  //  1) totalAll === 0  : data benar-benar kosong -> tombol tambah / buat dari Data Gerai / template.
  //  2) selain itu      : filter terlalu ketat -> tombol Reset Filter.
  // Tombol memakai `data-net` = add | skeleton | template-xlsx | reset (ditangani di init()).
  // TROUBLESHOOT: tabel selalu tampak kosong -> cek apakah storage ter-load (lihat toast error init())
  // atau ada filter aktif (kasus 2).
  function emptyHtml(v) {
    if (v.totalAll === 0) {
      const fromGerai = store.all().length
        ? '<button type="button" class="btn" data-net="skeleton">Buat dari Data Gerai (' + utils.formatNumber(store.all().length) + ' gerai)</button> '
        : '';
      return '<tr><td colspan="' + COL_COUNT + '"><div class="empty"><h3>Belum ada Data Network</h3>' +
        '<p>Tambahkan satu per satu, impor dari Excel/CSV, atau buat kerangka data dari Data Gerai lalu lengkapi detail jaringannya.</p>' +
        '<div class="empty-actions"><button type="button" class="btn btn-primary" data-net="add">+ Tambah Data Network</button> ' + fromGerai +
        '<button type="button" class="btn" data-net="template-xlsx">Unduh Template Excel</button></div></div></td></tr>';
    }
    return '<tr><td colspan="' + COL_COUNT + '"><div class="empty"><h3>Tidak ada data yang cocok</h3><p>Ubah kata kunci atau filter yang sedang aktif.</p>' +
      '<div class="empty-actions"><button type="button" class="btn" data-net="reset">Reset Filter</button></div></div></td></tr>';
  }

  // Perbarui teks info ("Menampilkan a–b dari n data"), label halaman, dan status tombol Sebelumnya/Berikutnya.
  // Elemen: #netPagerInfo, #netPagePrev, #netPageNext, #netPageLabel.
  function renderPager(v) {
    const from = v.total === 0 ? 0 : v.start + 1;
    const to = Math.min(v.start + ns.state.pageSize, v.total);
    $('netPagerInfo').textContent = v.total === 0 ? 'Tidak ada data' : 'Menampilkan ' + from + '–' + to + ' dari ' + v.total + ' data' + (v.total !== v.totalAll ? ' (difilter dari ' + v.totalAll + ')' : '');
    $('netPagePrev').disabled = v.page <= 1;
    $('netPageNext').disabled = v.page >= v.pages;
    $('netPageLabel').textContent = 'Hal. ' + v.page + ' / ' + v.pages;
  }

  // Gambar ulang seluruh halaman (statistik, header, isi tabel, pager) dan isi <datalist id="geraiList">
  // dengan nama gerai dari Data Gerai (saran untuk input Nama Gerai). Panggil setelah setiap perubahan data/filter.
  function render() {
    const v = ns.view();
    renderStats();
    renderHead();
    $('netBody').innerHTML = v.rows.length ? v.rows.map(rowHtml).join('') : emptyHtml(v);
    renderPager(v);
    $('geraiList').innerHTML = store.all().map((g) => '<option value="' + esc(g.namaGerai) + '"></option>').join('');
  }

  // ---------- form ----------
  // Isi <select> dengan opsi dari daftar `items` (opsi pertama kosong bila ada `placeholder`);
  // opsi yang sama dengan `selected` ditandai terpilih.
  function fillSelect(el, items, selected, placeholder) {
    el.innerHTML = (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') +
      items.map((i) => '<option value="' + esc(i) + '"' + (i === selected ? ' selected' : '') + '>' + esc(i) + '</option>').join('');
  }

  // Pemetaan field teks -> id <input> di form dialog (index.html). Field select (fungsi, vendor, rasio)
  // ditangani terpisah: #nFungsi, #nVendor, #nRasio.
  // TROUBLESHOOT: openForm()/readForm() error "null.value" -> salah satu id ini tidak ada di index.html.
  const FORM_IDS = { codeAnalytic: 'nCode', namaGerai: 'nGerai', alamat: 'nAlamat', bandwidth: 'nBandwidth', ssid: 'nSsid', ipGateway: 'nGateway', ipAddress: 'nIp', dns: 'nDns', mikrotikType: 'nMtType', snMikrotik: 'nMtSn' };

  // Tampilkan/sembunyikan kotak error form (#netFormErrors). Array kosong = sembunyikan dan bersihkan.
  function showErrors(list) {
    const box = $('netFormErrors');
    box.hidden = !list.length;
    box.innerHTML = list.length ? '<strong>Periksa kembali isian berikut:</strong><ul>' + list.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '';
    if (list.length) box.scrollIntoView({ block: 'nearest' });
  }

  // Buka dialog #netDialog. id = null -> mode tambah (form kosong); id terisi -> mode ubah (diisi dari rekaman).
  // Efek samping: set editingId, isi semua input & select, kosongkan error, showModal(), fokus ke #nCode.
  function openForm(id) {
    const rec = id ? ns.find(id) : null;
    if (id && !rec) { toast.error('Data tidak ditemukan.'); return; }
    editingId = rec ? rec.id : null;
    $('netFormTitle').textContent = rec ? 'Ubah Data Network' : 'Tambah Data Network';
    Object.keys(FORM_IDS).forEach((k) => { $(FORM_IDS[k]).value = rec ? rec[k] : ''; });
    fillSelect($('nFungsi'), config.netFunctions, rec ? rec.fungsi : '', 'Pilih function…');
    fillSelect($('nVendor'), config.vendors, rec ? rec.vendor : '', 'Pilih ISP…');
    fillSelect($('nRasio'), config.netRatios, rec ? rec.rasio : '', 'Pilih rasio…');
    // Status Gerai: data baru mulai dari bawaan ('Aktif'); tanpa opsi kosong karena selalu punya nilai.
    fillSelect($('nStatus'), config.netStatuses, rec ? rec.statusGerai : config.netStatuses[0]);
    // Tombol Hapus di form hanya ada saat MENGUBAH data (menggantikan tombol Hapus per baris yang dulu di kolom Aksi).
    $('netFormDelete').hidden = !rec;
    showErrors([]);
    $('netDialog').showModal();
    $('nCode').focus();
  }

  // Ambil nilai form menjadi objek data mentah (teks sudah dirapikan; select dibaca apa adanya).
  function readForm() {
    const data = {};
    Object.keys(FORM_IDS).forEach((k) => { data[k] = utils.normalizeText($(FORM_IDS[k]).value); });
    data.fungsi = $('nFungsi').value;
    data.vendor = $('nVendor').value;
    data.rasio = $('nRasio').value;
    data.statusGerai = $('nStatus').value;
    return data;
  }

  // Handler submit #netForm: validasi (ns.validate; editingId dikecualikan dari cek duplikat), simpan
  // via update/add, tutup dialog, toast, render. Bila gagal, dialog tetap terbuka dengan daftar error.
  function submitForm(e) {
    e.preventDefault();
    const data = readForm();
    const errors = ns.validate(data, editingId);
    if (errors.length) { showErrors(errors); return; }
    const res = editingId ? ns.update(editingId, data) : ns.add(data);
    if (!res.ok) { showErrors([res.error]); return; }
    $('netDialog').close();
    toast.success(editingId ? 'Data network diperbarui.' : 'Data network ditambahkan.');
    render();
  }

  /** Pilih nama gerai yang sudah ada di Data Gerai -> alamat & ISP terisi otomatis (bila masih kosong). */
  function autofillFromGerai() {
    const name = utils.normalizeText($('nGerai').value).toLowerCase();
    const g = store.all().find((x) => x.namaGerai.toLowerCase() === name);
    if (!g) return;
    if (!utils.normalizeText($('nAlamat').value)) $('nAlamat').value = g.alamat;
    if (!$('nVendor').value && config.vendors.includes(g.vendor)) $('nVendor').value = g.vendor;
  }

  // ---------- hapus ----------
  // Buka dialog konfirmasi hapus (#netDeleteDialog) dan tampilkan nama di #netDeleteName.
  // Penghapusan sebenarnya dilakukan tombol #netDeleteConfirm di init() memakai pendingDeleteId.
  function askDelete(id) {
    const rec = ns.find(id);
    if (!rec) { toast.error('Data tidak ditemukan.'); return; }
    pendingDeleteId = id;
    $('netDeleteName').textContent = rec.namaGerai + (rec.codeAnalytic ? ' (' + rec.codeAnalytic + ')' : '');
    $('netDeleteDialog').showModal();
  }

  // ---------- kerangka dari Data Gerai ----------
  // Buat rekaman kosong dari Data Gerai (hanya nama, alamat, vendor) untuk gerai yang belum ada di Data
  // Network (pembanding: nama gerai, tidak peka huruf besar/kecil). Function & Rasio sengaja kosong,
  // jadi baris ini tampil "Belum lengkap" sampai dilengkapi lewat Ubah. Tidak melewati validate().
  function createSkeleton() {
    const existing = new Set(ns.all().map((r) => r.namaGerai.toLowerCase()));
    const fresh = store.all().filter((g) => !existing.has(g.namaGerai.toLowerCase())).map((g) => ({ namaGerai: g.namaGerai, alamat: g.alamat, vendor: g.vendor }));
    if (!fresh.length) { toast.info('Semua gerai sudah ada di Data Network.'); return; }
    const res = ns.addMany(fresh);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(fresh.length + ' gerai dibuat sebagai kerangka. Lengkapi Function, Rasio, dan detail jaringannya lewat tombol Ubah.');
    render();
  }

  // ---------- ekspor / template / impor ----------
  // Ubah daftar rekaman menjadi matriks baris: baris pertama = label header FIELDS, sisanya data.
  // Dipakai ekspor dan template (list kosong -> hanya header). Urutan kolom = FIELDS = format impor.
  function tableRows(list) {
    return [FIELDS.map((f) => f.label)].concat(list.map((r) => FIELDS.map((f) => r[f.key] || '')));
  }

  // Unduh data (sesuai filter aktif) atau template kosong. format: 'xlsx' (App.excel) selain itu CSV.
  // Ekspor data dibatalkan dengan toast bila hasil filter kosong.
  // TROUBLESHOOT: unduhan Excel gagal -> pastikan pustaka di App.excel termuat (lihat urutan script di
  // index.html); error ditampilkan lewat toast.
  function exportData(templateOnly, format) {
    const list = templateOnly ? [] : ns.filtered();
    if (!templateOnly && !list.length) { toast.info('Tidak ada data untuk diekspor.'); return; }
    const base = templateOnly ? 'template-data-network' : 'data-network';
    try {
      if (format === 'xlsx') App.excel.download(base + '.xlsx', tableRows(list), 'Data Network');
      else csv.download(base + '.csv', csv.rowsToCsv(tableRows(list)));
    } catch (err) { toast.error(err.message); }
  }

  // Alias header file impor -> key field. Kunci alias ditulis huruf kecil tanpa spasi/simbol/angka
  // (lihat keyOf() di importRows), jadi "IP Gateway", "ip_gateway", "IP-Gateway" sama-sama 'ipgateway'.
  // Berisi ejaan umum yang salah (analitic, bandwith, geteway) agar file lama tetap terbaca.
  // TROUBLESHOOT: kolom tertentu tidak terimpor -> tambahkan ejaan header file itu di sini.
  const HEADER_ALIASES = {
    codeanalytic: 'codeAnalytic', codeanalitic: 'codeAnalytic', codeanalitik: 'codeAnalytic', kodeanalytic: 'codeAnalytic', kodeanalitik: 'codeAnalytic',
    namagerai: 'namaGerai', gerai: 'namaGerai', function: 'fungsi', fungsi: 'fungsi', alamat: 'alamat', alamatgerai: 'alamat',
    namaisp: 'vendor', isp: 'vendor', vendor: 'vendor', rasio: 'rasio', ratio: 'rasio',
    bandwidth: 'bandwidth', bandwith: 'bandwidth', bw: 'bandwidth', ssid: 'ssid',
    ipgateway: 'ipGateway', ipgeteway: 'ipGateway', gateway: 'ipGateway', geteway: 'ipGateway',
    ipaddress: 'ipAddress', ipaddres: 'ipAddress', ip: 'ipAddress', dns: 'dns',
    mikrotiktype: 'mikrotikType', typemikrotik: 'mikrotikType', tipemikrotik: 'mikrotikType', mikrotik: 'mikrotikType',
    snmikrotik: 'snMikrotik', serialnumbermikrotik: 'snMikrotik', sn: 'snMikrotik',
    statusgerai: 'statusGerai', status: 'statusGerai', statustoko: 'statusGerai'
  };

  /**
   * Ubah matriks baris file (Excel/CSV) menjadi rekaman valid + daftar error per baris.
   * Header dicari di 15 baris pertama (baris yang memuat kolom "Nama Gerai"); baris di atasnya dilewati.
   * Per baris: bandwidth angka murni diberi " Mbps"; vendor dicocokkan lewat csv.matchVendor; Function
   * dinormalisasi; lalu ns.validate. Baris tidak valid atau Code Analytic dobel dalam file -> dilewati
   * dengan pesan "Baris N" (N = nomor baris di file, 1-based: headerAt + idx + 2). Baris kosong diabaikan.
   * TROUBLESHOOT: semua baris ditolak -> baca pesan error (biasanya Function/Rasio/ISP tidak sesuai
   * daftar config) atau header "Nama Gerai" tidak ada.
   * @returns {{records:Array, errors:string[]}}
   */
  function importRows(allRows) {
    // Pertahanan: input bukan tabel / baris bukan array dianggap kosong; jumlah baris dibatasi (config.maxImportRows).
    allRows = (Array.isArray(allRows) ? allRows : []).map((r) => (Array.isArray(r) ? r : []));
    if (allRows.length > config.maxImportRows) {
      return { records: [], errors: ['File terlalu besar: ' + allRows.length + ' baris (maksimal ' + config.maxImportRows + '). Pecah file menjadi beberapa bagian.'] };
    }
    const keyOf = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z]/g, '');
    let headerAt = allRows.slice(0, 15).findIndex((r) => r.some((h) => HEADER_ALIASES[keyOf(h)] === 'namaGerai'));
    if (headerAt < 0) return { records: [], errors: ['Kolom "Nama Gerai" tidak ditemukan di header file.'] };
    const map = allRows[headerAt].map((h) => HEADER_ALIASES[keyOf(h)] || null);
    const records = [];
    const errors = [];
    // Kode Analytic data tersimpan (dibangun sekali) -> cek dobel O(1) per baris, bukan memindai semua data.
    const seenCodes = ns.codeSet();
    allRows.slice(headerAt + 1).forEach((cols, idx) => {
      if (!cols.some((c) => utils.normalizeText(c) !== '')) return;
      const line = headerAt + idx + 2;
      const raw = {};
      map.forEach((field, i) => { if (field) raw[field] = utils.normalizeText(cols[i]); });
      if (raw.bandwidth && /^\d+(\.\d+)?$/.test(raw.bandwidth)) raw.bandwidth += ' Mbps';
      raw.vendor = csv.matchVendor(raw.vendor) || raw.vendor || '';
      raw.fungsi = ns.normFungsi(raw.fungsi) ? ns.normFungsi(raw.fungsi) : raw.fungsi;
      // Status Gerai: ejaan dikenal dibakukan; kosong -> otomatis 'Aktif'; tidak dikenal dibiarkan agar ditolak validate().
      raw.statusGerai = ns.normStatus(raw.statusGerai) || raw.statusGerai || '';
      const code = (raw.codeAnalytic || '').toLowerCase();
      // validate tidak diberi daftar kode: dobel terhadap data tersimpan DAN antar-baris file dicek di bawah lewat seenCodes.
      const problems = ns.validate(raw, null, new Set());
      if (code && seenCodes.has(code)) problems.push('Code Analytic ' + raw.codeAnalytic + ' sudah dipakai (data tersimpan atau baris lain di file ini).');
      if (problems.length) { errors.push('Baris ' + line + ': ' + problems.join(' ') + ' (dilewati)'); return; }
      if (code) seenCodes.add(code);
      records.push(raw);
    });
    return { records, errors };
  }

  // Baca file yang dipilih dari #netImportFile (.xlsx/.xls via App.excel, .csv/.txt via csv.parse),
  // proses dengan importRows, simpan rekaman valid via ns.addMany, dan laporkan lewat toast
  // (maks 4 pesan error ditampilkan). Baris valid tetap diimpor walau sebagian baris gagal.
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
        result = isExcel ? App.excel.importBufferWith(reader.result, importRows) : importRows(csv.parse(String(reader.result)));
      } catch (err) { toast.error('Gagal membaca file: ' + err.message); return; }
      const { records, errors } = result;
      if (records.length) {
        const res = ns.addMany(records);
        if (!res.ok) { toast.error(res.error); return; }
        toast.success(records.length + ' baris Data Network berhasil diimpor.');
        render();
      }
      if (errors.length) toast.error(errors.slice(0, 4).join('\n') + (errors.length > 4 ? '\n…dan ' + (errors.length - 4) + ' masalah lain.' : ''));
      if (!records.length && !errors.length) toast.info('Tidak ada data yang diimpor.');
    };
    if (isExcel) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  }

  // ---------- filter & event ----------
  // Set satu filter/kata kunci di state, kembali ke halaman 1, lalu render.
  function setFilter(key, value) { ns.state[key] = value; ns.state.page = 1; render(); }

  // Titik masuk pencarian dari kotak cari global (dipanggil modul lain).
  function setQuery(q) { setFilter('query', q); }

  // Kosongkan semua filter + kotak cari (#searchInput, milik halaman global) dan dropdown filter, lalu render.
  // Urutan (sort) dan ukuran halaman tidak ikut direset.
  function resetFilters() {
    Object.assign(ns.state, { query: '', vendor: '', fungsi: '', rasio: '', statusGerai: '', page: 1 });
    $('netFilterVendor').value = ''; $('netFilterFungsi').value = ''; $('netFilterRasio').value = ''; $('netFilterStatus').value = '';
    $('searchInput').value = '';
    render();
  }

  // Inisialisasi halaman (panggil sekali): muat data, isi dropdown filter/ukuran halaman, pasang semua
  // event listener, lalu render pertama. Listener dipasang sekali, jadi jangan panggil init() dua kali
  // (handler akan dobel).
  // TROUBLESHOOT: tombol tidak bereaksi -> cek id elemen di index.html dan atribut `data-*` yang dipakai
  // delegasi: `data-sort` (header #netHead), `data-net` (isi #netBody: edit/delete/add/skeleton/
  // template-xlsx/reset), `data-net-file` + `data-format` (tombol ekspor/template: template|data, xlsx|csv).
  function init() {
    const res = ns.init();
    if (!res.ok) toast.error(res.error);

    const opts = (list, first) => '<option value="">' + first + '</option>' + list.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
    $('netFilterVendor').innerHTML = opts(config.vendors, 'Semua ISP');
    $('netFilterFungsi').innerHTML = opts(config.netFunctions, 'Semua function');
    $('netFilterRasio').innerHTML = opts(config.netRatios, 'Semua rasio');
    $('netFilterStatus').innerHTML = opts(config.netStatuses, 'Semua status gerai');
    $('netPageSize').innerHTML = config.pageSizes.map((n) => '<option value="' + n + '">' + n + ' / halaman</option>').join('');

    $('netFilterVendor').addEventListener('change', (e) => setFilter('vendor', e.target.value));
    $('netFilterFungsi').addEventListener('change', (e) => setFilter('fungsi', e.target.value));
    $('netFilterRasio').addEventListener('change', (e) => setFilter('rasio', e.target.value));
    $('netFilterStatus').addEventListener('change', (e) => setFilter('statusGerai', e.target.value));
    $('netPageSize').addEventListener('change', (e) => { ns.state.pageSize = Number(e.target.value); ns.state.page = 1; render(); });
    $('netPagePrev').addEventListener('click', () => { ns.state.page--; render(); });
    $('netPageNext').addEventListener('click', () => { ns.state.page++; render(); });

    $('btnNetAdd').addEventListener('click', () => openForm(null));
    $('btnNetImport').addEventListener('click', () => $('netImportFile').click());
    $('netImportFile').addEventListener('change', (e) => { handleImport(e.target.files[0]); e.target.value = ''; });
    document.querySelectorAll('[data-net-file]').forEach((btn) => {
      btn.addEventListener('click', () => exportData(btn.dataset.netFile === 'template', btn.dataset.format));
    });

    $('netHead').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sort]');
      if (!btn) return;
      const s = ns.state.sort;
      ns.state.sort = { key: btn.dataset.sort, dir: s.key === btn.dataset.sort && s.dir === 'asc' ? 'desc' : 'asc' };
      render();
    });

    $('netBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-net]');
      if (!btn) return;
      const a = btn.dataset.net;
      if (a === 'edit') openForm(btn.dataset.id);
      else if (a === 'delete') askDelete(btn.dataset.id);
      else if (a === 'add') openForm(null);
      else if (a === 'skeleton') createSkeleton();
      else if (a === 'template-xlsx') exportData(true, 'xlsx');
      else if (a === 'reset') resetFilters();
    });

    // Ubah Status Gerai langsung dari dropdown di tabel: simpan seketika; bila gagal (mis. kuota penuh),
    // tampilan dikembalikan ke nilai tersimpan lewat render().
    $('netBody').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-net-status]');
      if (!sel) return;
      const rec = ns.find(sel.dataset.id);
      if (!rec) { toast.error('Data tidak ditemukan.'); render(); return; }
      const res = ns.update(rec.id, Object.assign({}, rec, { statusGerai: sel.value }));
      if (res.ok) toast.success('Status ' + rec.namaGerai + ' diubah menjadi ' + sel.value + '.');
      else toast.error(res.error);
      render();
    });

    // Tombol Hapus di dalam form ubah: tutup form lalu buka dialog konfirmasi hapus (askDelete).
    $('netFormDelete').addEventListener('click', () => {
      const id = editingId;
      $('netDialog').close();
      if (id) askDelete(id);
    });

    $('netForm').addEventListener('submit', submitForm);
    $('nGerai').addEventListener('change', autofillFromGerai);
    $('netCancel').addEventListener('click', () => $('netDialog').close());
    $('netClose').addEventListener('click', () => $('netDialog').close());
    // ----- Hapus SEMUA Data Network (dialog konfirmasi #netClearDialog) -----
    $('btnNetClear').addEventListener('click', () => {
      const n = ns.all().length;
      if (!n) { toast.info('Data Network sudah kosong.'); return; }
      $('netClearCount').textContent = utils.formatNumber(n);
      $('netClearDialog').showModal();
    });
    // Cadangan: SEMUA data (bukan hanya hasil filter) diunduh sebagai Excel sebelum dihapus.
    $('netClearBackup').addEventListener('click', () => {
      try { App.excel.download('data-network-cadangan.xlsx', tableRows(ns.all()), 'Data Network'); }
      catch (err) { toast.error(err.message); }
    });
    $('netClearCancel').addEventListener('click', () => $('netClearDialog').close());
    $('netClearConfirm').addEventListener('click', () => {
      const n = ns.all().length;
      const res = ns.clear();
      $('netClearDialog').close();
      if (res.ok) {
        ns.state.page = 1;
        toast.success(utils.formatNumber(n) + ' Data Network dihapus. Data Gerai tidak ikut terhapus.');
        render();
      } else toast.error(res.error);
    });
    $('netDeleteCancel').addEventListener('click', () => $('netDeleteDialog').close());
    // Konfirmasi hapus: ns.remove(pendingDeleteId); pendingDeleteId selalu direset dan dialog ditutup.
    $('netDeleteConfirm').addEventListener('click', () => {
      const res = pendingDeleteId ? ns.remove(pendingDeleteId) : { ok: false, error: 'Data tidak ditemukan.' };
      if (res.ok) { toast.success('Data network dihapus.'); render(); } else toast.error(res.error);
      pendingDeleteId = null;
      $('netDeleteDialog').close();
    });
    // Klik pada area latar (backdrop) <dialog> menutupnya: target mousedown = elemen dialog itu sendiri.
    ['netDialog', 'netDeleteDialog', 'netClearDialog'].forEach((id) => {
      $(id).addEventListener('mousedown', (e) => { if (e.target === $(id)) $(id).close(); });
    });
    render();
  }

  // API publik modul (lihat header file).
  return { init, render, setQuery };
})();
