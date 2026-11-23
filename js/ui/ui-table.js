/* Render tabel data, header sortir, state kosong, dan paginasi.
 *
 * Fitur      : halaman Data Gerai / pembayaran (tabel utama; form ada di ui-form.js).
 * Dependensi : App.store (view, state, yearPayments), App.utils (formatNumber, formatRupiah,
 *              daysRemaining, sumPayments, escapeHtml), App.config (months, monthsLong, expiryWarnDays),
 *              App.seedData (opsional, hanya memengaruhi tombol "Muat Data Internet.xlsx").
 * Diekspos   : { render } -> menggambar ulang header, isi tabel, dan pager.
 *
 * TROUBLESHOOT: tabel tidak muncul -> cek id di index.html: tableHead, tableBody, pagerInfo,
 * pagePrev, pageNext, pageLabel. Klik tombol baris/kosong ditangani di modul lain (delegasi event
 * memakai atribut data-action dan data-id; data-sort pada header); modul ini hanya membuat markup-nya.
 */
App.table = (function () {
  const { store, utils, config } = App;
  const esc = utils.escapeHtml;
  const $ = (id) => document.getElementById(id);

  // Definisi kolom tetap di depan 12 kolom bulan: key = nama field untuk sortir (`data-sort`);
  // lines = judul dipecah per baris; sortable = apakah header berupa tombol sortir.
  // `flex` ditandai untuk kolom lebar fleksibel. Key 'sisa' dan 'total' adalah kolom turunan
  // (dihitung, bukan field asli) sehingga logika sortirnya harus ada di store.
  // TROUBLESHOOT: urutan <td> di rowHtml() harus sama dengan urutan COLUMNS ini.
  const COLUMNS = [
    { key: 'kodeInduk', lines: ['Kode', 'Induk'], sortable: true },
    { key: 'po', lines: ['PO'], sortable: true },
    { key: 'namaGerai', lines: ['Nama', 'Gerai'], sortable: true, flex: true },
    { key: 'alamat', lines: ['Alamat', 'Gerai'], sortable: false, flex: true },
    { key: 'sisa', lines: ['Sisa Masa', 'Sewa / Hari'], sortable: true },
    { key: 'status', lines: ['Status'], sortable: true },
    { key: 'idPelanggan', lines: ['ID', 'Pelanggan'], sortable: true },
    { key: 'vendor', lines: ['Nama', 'Vendor'], sortable: true },
    { key: 'remark', lines: ['Remark'], sortable: true }
  ];
  // Judul kolom: tiap baris di-escape lalu digabung dengan spasi.
  const labelHtml = (c) => c.lines.map(esc).join(' ');
  // Jumlah kolom total untuk colspan baris kosong; harus cocok dengan jumlah <th> di renderHead().
  const COL_COUNT = COLUMNS.length + 12 + 2; // + 12 bulan + total + aksi

  // Bangun header #tableHead: kolom COLUMNS (tombol sortir bila sortable), 12 kolom bulan (singkatan,
  // tooltip nama panjang), kolom Total (sortir `data-sort="total"`), dan Aksi. Ikon: ▲ naik, ▼ turun,
  // ↕ belum aktif; aria-sort ikut diperbarui.
  function renderHead() {
    const { key: sKey, dir } = store.state.sort;
    const sortHead = (c) => {
      if (!c.sortable) return '<th scope="col">' + labelHtml(c) + '</th>';
      const active = sKey === c.key;
      const aria = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
      const arrow = active ? (dir === 'asc' ? '▲' : '▼') : '↕';
      return '<th scope="col" aria-sort="' + aria + '"><button type="button" class="th-sort' + (active ? ' is-active' : '') + '" data-sort="' + c.key + '">' + labelHtml(c) + ' <span aria-hidden="true">' + arrow + '</span></button></th>';
    };
    const months = config.months.map((m, i) => '<th scope="col" class="num" title="' + config.monthsLong[i] + '">' + m + '</th>').join('');
    const totalActive = sKey === 'total';
    const totalHead = '<th scope="col" class="num" aria-sort="' + (totalActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="th-sort' + (totalActive ? ' is-active' : '') + '" data-sort="total">Total <span aria-hidden="true">' + (totalActive ? (dir === 'asc' ? '▲' : '▼') : '↕') + '</span></button></th>';
    $('tableHead').innerHTML = '<tr>' + COLUMNS.map(sortHead).join('') + months + totalHead + '<th scope="col">Aksi</th></tr>';
  }

  // Badge sisa masa sewa dari tanggal akhir (iso). daysRemaining null = tanggal belum diisi.
  // Merah: sudah lewat / berakhir hari ini; kuning: sisa <= config.expiryWarnDays; hijau: aman.
  function sisaBadge(iso) {
    const d = utils.daysRemaining(iso);
    if (d === null) return '<span class="badge badge-muted">Belum diisi</span>';
    if (d < 0) return '<span class="badge badge-danger" title="Berakhir ' + esc(iso) + '">Lewat ' + utils.formatNumber(-d) + ' hari</span>';
    if (d === 0) return '<span class="badge badge-danger" title="Berakhir ' + esc(iso) + '">Berakhir hari ini</span>';
    const cls = d <= config.expiryWarnDays ? 'badge-warn' : 'badge-ok';
    return '<span class="badge ' + cls + '" title="Berakhir ' + esc(iso) + '">' + utils.formatNumber(d) + ' hari</span>';
  }

  // Format angka pembayaran pada sel bulan (tanpa simbol Rp; versi lengkap ada di tooltip).
  const monthAmount = (v) => utils.formatNumber(v);

  // HTML satu baris gerai. Pembayaran diambil untuk tahun aktif (store.state.year); nilai null = belum
  // ada pembayaran (tampil "–"), beda dengan 0 yang tampil sebagai angka. Kelas `nw` = nowrap agar
  // sel pendek tidak patah baris; `addr` = kolom alamat yang boleh melipat. Tombol Ubah/Hapus memakai
  // `data-action` + `data-id` untuk delegasi event. Semua nilai pengguna lewat esc().
  function rowHtml(r) {
    const pays = store.yearPayments(r, store.state.year);
    const monthCells = pays.map((v, i) => {
      if (v == null) return '<td class="num pay pay-empty nw" title="' + config.monthsLong[i] + ': belum ada pembayaran">–</td>';
      return '<td class="num pay pay-paid nw" title="' + config.monthsLong[i] + ': ' + esc(utils.formatRupiah(v)) + '">' + monthAmount(v) + '</td>';
    }).join('');
    const statusCls = r.status === 'Active' ? 'badge-ok' : 'badge-muted';
    const remarkCls = r.remark === 'Takeout' ? 'badge-warn' : 'badge-info';
    return '<tr>' +
      '<td class="nw">' + esc(r.kodeInduk) + '</td>' +
      '<td class="nw">' + (esc(r.po) || '<span class="muted">–</span>') + '</td>' +
      '<td class="strong">' + esc(r.namaGerai) + '</td>' +
      '<td class="addr">' + esc(r.alamat) + '</td>' +
      '<td class="nw">' + sisaBadge(r.akhirSewa) + '</td>' +
      '<td class="nw"><span class="badge ' + statusCls + '">' + esc(r.status) + '</span></td>' +
      '<td class="nw">' + esc(r.idPelanggan) + '</td>' +
      '<td class="nw"><span class="vendor">' + esc(r.vendor) + '</span></td>' +
      '<td class="nw"><span class="badge ' + remarkCls + '">' + esc(r.remark) + '</span>' + (r.catatan ? ' <small class="muted">' + esc(r.catatan) + '</small>' : '') + '</td>' +
      monthCells +
      '<td class="num strong nw">' + utils.formatNumber(utils.sumPayments(pays)) + '</td>' +
      '<td class="actions nw">' +
      '<button type="button" class="btn btn-sm" data-action="edit" data-id="' + esc(r.id) + '" aria-label="Ubah ' + esc(r.namaGerai) + '">Ubah</button> ' +
      '<button type="button" class="btn btn-sm btn-danger-ghost" data-action="delete" data-id="' + esc(r.id) + '" aria-label="Hapus ' + esc(r.namaGerai) + '">Hapus</button></td>' +
      '</tr>';
  }

  // Baris pengganti saat tidak ada baris. totalAll === 0 -> data memang kosong (tombol tambah, muat
  // data Internet.xlsx bila App.seedData ada, muat data contoh: data-action add | seed | sample);
  // selain itu -> filter terlalu ketat (data-action reset).
  // TROUBLESHOOT: tombol "Muat Data Internet.xlsx" tidak muncul -> App.seedData belum dimuat (cek urutan script)
  // atau berisi records kosong (template data-awal.js di repositori memang kosong; lihat tools/convert-xlsx.ps1).
  function emptyHtml(v) {
    if (v.totalAll === 0) {
      return '<tr><td colspan="' + COL_COUNT + '"><div class="empty"><h3>Belum ada data gerai</h3>' +
        '<p>Mulai dengan menambahkan gerai pertama, mengimpor file CSV, atau memuat data contoh untuk mencoba fitur.</p>' +
        '<div class="empty-actions"><button type="button" class="btn btn-primary" data-action="add">+ Tambah Gerai</button> ' +
        (App.seedData && App.seedData.records && App.seedData.records.length ? '<button type="button" class="btn" data-action="seed">Muat Data Internet.xlsx</button> ' : '') +
        '<button type="button" class="btn" data-action="sample">Muat Data Contoh</button></div></div></td></tr>';
    }
    return '<tr><td colspan="' + COL_COUNT + '"><div class="empty"><h3>Tidak ada data yang cocok</h3>' +
      '<p>Ubah kata kunci atau filter yang sedang aktif.</p>' +
      '<div class="empty-actions"><button type="button" class="btn" data-action="reset">Reset Filter</button></div></div></td></tr>';
  }

  // Perbarui info rentang data, label halaman, dan status tombol Sebelumnya/Berikutnya dari hasil store.view().
  function renderPager(v) {
    const from = v.total === 0 ? 0 : v.start + 1;
    const to = Math.min(v.start + store.state.pageSize, v.total);
    $('pagerInfo').textContent = v.total === 0 ? 'Tidak ada data' : 'Menampilkan ' + from + '–' + to + ' dari ' + v.total + ' data' + (v.total !== v.totalAll ? ' (difilter dari ' + v.totalAll + ')' : '');
    $('pagePrev').disabled = v.page <= 1;
    $('pageNext').disabled = v.page >= v.pages;
    $('pageLabel').textContent = 'Hal. ' + v.page + ' / ' + v.pages;
  }

  // Titik masuk: ambil view dari store lalu gambar header, isi tabel (atau state kosong), dan pager.
  // Panggil setiap data, filter, urutan, halaman, atau tahun berubah.
  function render() {
    const v = store.view();
    renderHead();
    $('tableBody').innerHTML = v.rows.length ? v.rows.map(rowHtml).join('') : emptyHtml(v);
    renderPager(v);
  }
  // API publik modul (lihat header file).
  return { render };
})();
