/* Dashboard: persentase pembayaran tiap ISP (donut), grafik bar pembayaran, dan tabel rekap.
   SVG/HTML murni tanpa pustaka. Mengikuti tahun yang dipilih. */
/*
 * ui-charts.js
 * Tujuan   : grafik dan tabel rekap pembayaran per ISP per bulan (halaman "rekap"), tanpa pustaka grafik.
 * Fitur    : Rekap Pembayaran.
 * Dependensi: App.store (paymentStats, stats, state.year), App.utils (escapeHtml, formatRupiah,
 *            formatPercent, formatNumber, formatCompact, sumPayments), App.config (vendors, months, monthsLong).
 * Diekspos : { render, bindTooltip } -- bindTooltip dipanggil sekali (start() di app.js), render dipanggil
 *            ulang tiap data/tahun berubah, saat halaman rekap tampil, dan saat jendela di-resize.
 *
 * TROUBLESHOOT: grafik kosong / hanya tampil pesan kosong -> tidak ada nominal pembayaran pada tahun
 *   terpilih (grandTotal = 0): render() menyembunyikan elemen .needs-pay dan menampilkan #chartsEmpty.
 *   Ganti tahun di #yearSelect atau impor data pembayaran.
 *   Error "null" -> id elemen tidak ada di index.html: chartShare, chartBar, chartTable, chartTip,
 *   chartsSection, chartsEmpty, chartsTotal, chartsYear.
 *   Warna seri kosong/tidak sesuai -> variabel CSS --series-N (N = urutan vendor di config.vendors) belum didefinisikan.
 */
App.charts = (function () {
  const { store, utils, config } = App;
  const esc = utils.escapeHtml;
  const $ = (id) => document.getElementById(id);

  // ---------- Pembantu: warna, skala, bentuk ----------

  /**
   * Warna mengikuti ISP (bukan peringkat): slot tetap sesuai urutan config.vendors.
   * Aturan: ISP ke-1 -> var(--series-1), ke-2 -> var(--series-2), dst. Vendor tak dikenal -> indexOf -1 -> var(--series-0).
   */
  const color = (vendor) => 'var(--series-' + (config.vendors.indexOf(vendor) + 1) + ')';

  // Kelipatan "enak dibaca" untuk batas atas sumbu Y (dikalikan pangkat 10 dari nilai maksimum).
  const NICE = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];

  /**
   * Membulatkan nilai maksimum ke atas ke angka "rapi" (mis. 356 jt -> 400 jt) agar 4 garis grid
   * bernilai bulat. Nilai <= 0 menghasilkan 1 supaya tidak terjadi pembagian nol.
   */
  function niceMax(max) {
    if (max <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    return NICE.map((n) => n * pow).find((v) => v >= max) || 10 * pow;
  }

  /**
   * Kolom dengan sudut atas membulat (4px), dasar menempel baseline.
   * Mengembalikan atribut "d" path SVG: (x,y) = pojok kiri atas, w/h = lebar/tinggi, r = radius sudut
   * (dibatasi setengah lebar dan tinggi agar kolom pendek tidak berbentuk aneh).
   */
  function roundedTop(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + rr) + 'Q' + x + ',' + y + ' ' + (x + rr) + ',' + y + 'H' + (x + w - rr) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + rr) + 'V' + (y + h) + 'Z';
  }

  /**
   * Data per ISP (urut dari pembayaran terbesar) lengkap dengan persentase dan jumlah gerai.
   * Param s = store.paymentStats(). ratio = porsi terhadap grandTotal (0 bila grandTotal 0).
   */
  function vendorRows(s) {
    const counts = store.stats().byVendor;
    return s.vendorTotals
      .map((r) => ({ vendor: r.vendor, total: r.total, ratio: s.grandTotal ? r.total / s.grandTotal : 0, stores: counts[r.vendor] || 0 }))
      .sort((a, b) => b.total - a.total);
  }

  // ---------- Persentase tiap ISP: grafik bar horizontal ----------
  // Mengisi #chartShare. Lebar bar relatif terhadap ISP terbesar (yang terbesar = 100% lebar track),
  // bukan terhadap 100% total. Teks tooltip disimpan di atribut data-tip (HTML ter-escape), dibaca bindTooltip().
  function renderShare(rows) {
    const top = rows.length ? rows[0].ratio : 0;
    $('chartShare').innerHTML = rows.map((row) => {
      const width = top ? (row.ratio / top) * 100 : 0;
      const tip = '<strong>' + esc(row.vendor) + '</strong><br>' + esc(utils.formatRupiah(row.total)) + '<br>' + utils.formatPercent(row.ratio) + ' dari total<br>' + utils.formatNumber(row.stores) + ' gerai';
      return '<div class="share-row" data-tip="' + esc(tip) + '">' +
        '<span class="share-name"><i class="dot" style="background:' + color(row.vendor) + '"></i>' + esc(row.vendor) + '</span>' +
        '<span class="share-track"><span class="share-bar" style="width:' + width.toFixed(2) + '%;background:' + color(row.vendor) + '"></span></span>' +
        '<span class="share-val"><strong>' + utils.formatPercent(row.ratio) + '</strong><small>' + esc(utils.formatCompact(row.total)) + '</small></span>' +
        '</div>';
    }).join('');
  }

  // ---------- Bar: total pembayaran per ISP ----------
  // Mengisi #chartBar dengan SVG (viewBox, ikut lebar wadah). Geometri: W x H = 640 x 300 unit;
  // L/R/T/B = margin kiri (ruang label sumbu Y), kanan, atas (ruang label nilai), bawah (label ISP);
  // pw/ph = area plot; y(v) memetakan nilai ke koordinat vertikal (0 di dasar, max di atas);
  // slot = lebar per ISP, bw = lebar bar (maks 56 atau 60% slot); 5 garis grid (i = 0..4) pada kelipatan max/4.
  // Setiap ISP punya <rect class="hit"> transparan seluas slot sebagai area hover tooltip.
  // TROUBLESHOOT: bar tidak tampil padahal ada data -> cek rows tidak kosong (rows.length = 0 membuat slot Infinity)
  //   dan CSS .grid-line/.tick/.vlabel/.xlabel/.axis/.hit.
  function renderBar(rows) {
    const W = 640, H = 300, L = 54, R = 8, T = 22, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const max = niceMax(Math.max.apply(null, rows.map((r) => r.total)));
    const y = (v) => T + ph - (v / max) * ph;
    const slot = pw / rows.length, bw = Math.min(56, slot * 0.6);

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Total pembayaran per ISP tahun ' + esc(store.state.year) + '">';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      svg += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="tick" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(i === 0 ? '0' : utils.formatCompact(v)) + '</text>';
    }
    rows.forEach((row, i) => {
      const cx = L + slot * i + slot / 2;
      const tip = '<strong>' + esc(row.vendor) + '</strong><br>' + esc(utils.formatRupiah(row.total)) + '<br>' + utils.formatPercent(row.ratio) + ' dari total';
      if (row.total > 0) {
        const h = Math.max(1, y(0) - y(row.total));
        svg += '<path d="' + roundedTop(cx - bw / 2, y(row.total), bw, h, 4) + '" fill="' + color(row.vendor) + '"/>' +
          '<text class="vlabel" x="' + cx + '" y="' + (y(row.total) - 6) + '" text-anchor="middle">' + esc(utils.formatCompact(row.total)) + '</text>';
      }
      svg += '<text class="xlabel" x="' + cx + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(row.vendor) + '</text>' +
        '<rect class="hit" x="' + (cx - slot / 2) + '" y="' + T + '" width="' + slot + '" height="' + ph + '" data-tip="' + esc(tip) + '"/>';
    });
    svg += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '"/></svg>';
    $('chartBar').innerHTML = svg;
  }

  // ---------- Tabel rekap ISP x bulan ----------
  // Lebar kolom dibagi rata (table-layout: fixed) supaya muat tanpa scroll samping. Angka penuh dipakai bila muat;
  // bila ada sel yang tidak muat, seluruh angka diringkas (mis. 356,1 jt) dan nilai penuh tetap ada di tooltip.
  //
  // buildRekap(s, compact): mengembalikan string HTML isi tabel (colgroup + thead + tbody + tfoot).
  // Param s = store.paymentStats(); compact=true memakai formatCompact. Tanpa efek samping DOM.
  // Catatan angka: kolom ISP 14% + 2 kolom akhir (Total, Porsi) 9,4% masing-masing -> sisa 67,2% dibagi
  // ke 12 bulan menurut bobot (bulan terisi = 1, kosong = 0,45). `heat` = intensitas warna sel (0..1)
  // relatif terhadap sel terbesar; bulan terbaik (is-best) hanya ditandai bila nominalnya > 0.
  function buildRekap(s, compact) {
    const fmt = (n) => (compact ? utils.formatCompact(n) : utils.formatNumber(n));
    let max = 0;
    config.vendors.forEach((v) => s.byVendor[v].forEach((n) => { if (n > max) max = n; }));
    const bestMonth = s.monthTotals.indexOf(Math.max.apply(null, s.monthTotals));

    // Bulan tanpa data diberi kolom lebih sempit; sisa lebar dipakai bulan yang terisi agar angka penuh tetap muat.
    const weights = s.monthTotals.map((n) => (n > 0 ? 1 : 0.45));
    const unit = 67.2 / weights.reduce((a, b) => a + b, 0);
    const cols = '<colgroup><col style="width:14%">' + weights.map((w) => '<col style="width:' + (w * unit).toFixed(2) + '%">').join('') + '<col style="width:9.4%"><col style="width:9.4%"></colgroup>';
    const head = '<tr><th>ISP</th>' + config.months.map((m, i) => '<th class="num' + (s.monthTotals[i] > 0 && i === bestMonth ? ' is-best' : '') + '" title="' + esc(config.monthsLong[i]) + '">' + m + '</th>').join('') + '<th class="num">Total</th><th class="num">Porsi</th></tr>';

    const body = config.vendors.map((v) => {
      const total = utils.sumPayments(s.byVendor[v]);
      const ratio = s.grandTotal ? total / s.grandTotal : 0;
      const cells = s.byVendor[v].map((n, i) => n > 0
        ? '<td class="num heat" style="--heat:' + (n / max).toFixed(3) + '" title="' + esc(config.monthsLong[i] + ': ' + utils.formatRupiah(n)) + '">' + fmt(n) + '</td>'
        : '<td class="num zero">–</td>').join('');
      return '<tr><td><i class="dot" style="background:' + color(v) + '"></i>' + esc(v) + '</td>' + cells +
        '<td class="num strong" title="' + esc(utils.formatRupiah(total)) + '">' + fmt(total) + '</td>' +
        '<td class="num"><div class="pcell"><span>' + utils.formatPercent(ratio) + '</span><i class="pbar"><b style="width:' + (ratio * 100).toFixed(1) + '%;background:' + color(v) + '"></b></i></div></td></tr>';
    }).join('');

    const foot = '<tr><td>Total</td>' + s.monthTotals.map((n, i) => n > 0
      ? '<td class="num' + (i === bestMonth ? ' is-best' : '') + '" title="' + esc(config.monthsLong[i] + ': ' + utils.formatRupiah(n)) + '">' + fmt(n) + '</td>'
      : '<td class="num zero">–</td>').join('') +
      '<td class="num" title="' + esc(utils.formatRupiah(s.grandTotal)) + '">' + fmt(s.grandTotal) + '</td><td class="num">100%</td></tr>';

    return cols + '<thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot>';
  }

  /**
   * True bila ada sel angka yang isinya lebih lebar dari kolomnya. Halaman tersembunyi dianggap muat.
   * TROUBLESHOOT: tabel selalu ringkas / selalu penuh -> pengukuran butuh halaman rekap sedang terlihat
   *   (clientWidth 0 saat tersembunyi); itu sebabnya ui-nav.js memanggil App.charts.render() setelah halaman tampil.
   */
  function rekapOverflows(table) {
    if (table.clientWidth === 0) return false;
    return Array.prototype.some.call(table.querySelectorAll('td.num, th.num'), (c) => c.scrollWidth > c.clientWidth + 1);
  }

  /** Mengisi #chartTable: coba angka penuh dulu; bila ada sel meluap, render ulang dalam mode ringkas. */
  function renderTable(s) {
    const table = $('chartTable');
    table.innerHTML = buildRekap(s, false);
    if (rekapOverflows(table)) table.innerHTML = buildRekap(s, true);
  }

  // ---------- Tooltip ----------
  // Satu tooltip (#chartTip) dipakai bersama: delegasi event pointer pada #chartsSection, mencari elemen
  // terdekat ber-atribut data-tip. place() menaruh tooltip 14px dari kursor dan membaliknya ke sisi lain
  // bila akan keluar layar (margin 8px). pointerdown disertakan agar berfungsi di layar sentuh.
  // TROUBLESHOOT: tooltip tidak muncul -> #chartTip/#chartsSection tidak ada, atau bindTooltip() tidak
  //   dipanggil (lihat start() di app.js); tooltip mengandung HTML dari atribut data-tip (sudah di-escape).
  function bindTooltip() {
    const tip = $('chartTip');
    const host = $('chartsSection');
    const place = (e) => {
      const pad = 14;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + pad, yy = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
      if (yy + h > window.innerHeight - 8) yy = e.clientY - h - pad;
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = Math.max(8, yy) + 'px';
    };
    const show = (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el) { tip.hidden = true; return; }
      tip.innerHTML = el.getAttribute('data-tip');
      tip.hidden = false;
      place(e);
    };
    host.addEventListener('pointermove', show);
    host.addEventListener('pointerdown', show);
    host.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  // ---------- Titik masuk ----------

  /**
   * Merender tabel rekap lalu (bila ada pembayaran tahun terpilih) grafik share dan bar.
   * Bila grandTotal = 0: tampilkan #chartsEmpty, sembunyikan .needs-pay, dan berhenti lebih awal.
   * Tabel tetap dirender walau kosong.
   */
  function render() {
    const s = store.paymentStats();
    renderTable(s);
    const empty = s.grandTotal === 0;
    $('chartsEmpty').hidden = !empty;
    document.querySelectorAll('.needs-pay').forEach((el) => { el.hidden = empty; });
    if (empty) return;
    $('chartsTotal').textContent = utils.formatRupiah(s.grandTotal);
    $('chartsYear').textContent = '· Tahun ' + store.state.year;
    const rows = vendorRows(s);
    renderShare(rows);
    renderBar(rows);
  }

  return { render, bindTooltip };
})();