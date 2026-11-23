/* Kartu KPI dashboard, donut Active/Inactive, daftar sewa segera berakhir, dan chip vendor. */
/*
 * ui-summary.js
 * Tujuan   : merender halaman Dashboard (kartu KPI, donut status, statistik pembayaran,
 *            daftar sewa segera berakhir, chip filter vendor).
 * Fitur    : Dashboard (page "dashboard" di ui-nav.js).
 * Dependensi: App.store (stats, paymentStats, expiringList, state), App.utils (escapeHtml,
 *            formatNumber, formatPercent, formatRupiah, formatCompact), App.config (vendors, monthsLong).
 * Diekspos : { render } -- dipanggil ulang setiap data/filter/tahun berubah (oleh app.js).
 *
 * TROUBLESHOOT: kartu kosong / error "Cannot set properties of null" -> salah satu id elemen
 *   (statTotal, statActive, statInactive, statExisting, statTakeout, statExpiring, statExpired,
 *   statSoon, statMid, statLong, donutStatus, legActive, legInactive, legPct, statPayment,
 *   statPaymentYear, statAvg, statBest, expiringCount, expiringList, vendorChips) tidak ada di index.html.
 *   Pastikan juga script ini dimuat setelah store/utils/config (lihat urutan <script> di index.html).
 */
App.summary = (function () {
  const { store, utils, config } = App;
  const esc = utils.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const num = (n) => utils.formatNumber(n);

  // ---------- Donut Active / Inactive ----------

  /**
   * Menggambar donut SVG (viewBox 120x120, pusat 60,60) di #donutStatus dan mengisi legenda.
   * Param s = hasil store.stats(). Panjang busur = rasio aktif x keliling lingkaran.
   * Trik: stroke-dasharray "panjangBusur keliling"; rotate(-90) agar busur mulai dari jam 12.
   * Bila total 0 maka hanya lingkaran latar (track) yang digambar.
   * TROUBLESHOOT: donut kosong -> cek apakah store.stats().total = 0 (data belum dimuat/filter terlalu ketat).
   */
  function renderDonut(s) {
    // r = 46 (jari-jari donut), c = keliling lingkaran.
    const r = 46, c = 2 * Math.PI * r;
    const ratio = s.total ? s.active / s.total : 0;
    const arc = ratio > 0
      ? '<circle class="donut-arc" cx="60" cy="60" r="' + r + '" stroke-dasharray="' + (ratio * c).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 60 60)"/>'
      : '';
    $('donutStatus').innerHTML = '<circle class="donut-track" cx="60" cy="60" r="' + r + '"/>' + arc +
      '<text class="donut-num" x="60" y="62" text-anchor="middle">' + num(s.total) + '</text>' +
      '<text class="donut-cap" x="60" y="76" text-anchor="middle">gerai</text>';
    $('legActive').textContent = num(s.active);
    $('legInactive').textContent = num(s.inactive);
    $('legPct').textContent = utils.formatPercent(ratio);
  }

  // ---------- Statistik pembayaran ----------

  /**
   * Mengisi kartu total pembayaran tahun terpilih, rata-rata per bulan terisi, dan bulan terbesar.
   * Rata-rata dihitung hanya atas bulan yang nominalnya > 0 (bulan kosong tidak ikut dibagi).
   * TROUBLESHOOT: semua nilai "Rp 0" / "–" -> tidak ada nominal pembayaran pada tahun
   *   terpilih (store.state.year); ganti tahun atau periksa data pembayaran per bulan di store.
   */
  function renderPayment() {
    const p = store.paymentStats();
    $('statPayment').textContent = utils.formatRupiah(p.grandTotal);
    $('statPaymentYear').textContent = store.state.year;
    const filled = p.monthTotals.map((v, i) => ({ v, i })).filter((x) => x.v > 0);
    if (!filled.length) { $('statAvg').textContent = '–'; $('statBest').textContent = '–'; return; }
    const best = filled.reduce((a, b) => (b.v > a.v ? b : a));
    $('statAvg').textContent = utils.formatRupiah(Math.round(p.grandTotal / filled.length));
    $('statBest').textContent = config.monthsLong[best.i] + ' · ' + utils.formatCompact(best.v);
  }

  // ---------- Sewa segera berakhir ----------

  /**
   * Mengembalikan string HTML badge sisa hari sewa.
   * days < 0 = sudah lewat, 0 = berakhir hari ini (keduanya merah/danger), > 0 = peringatan (warn).
   */
  function badge(days) {
    if (days < 0) return '<span class="badge badge-danger">Lewat ' + num(-days) + ' hari</span>';
    if (days === 0) return '<span class="badge badge-danger">Berakhir hari ini</span>';
    return '<span class="badge badge-warn">' + num(days) + ' hari</span>';
  }

  /**
   * Mengisi daftar maksimal 8 gerai dengan sewa paling dekat berakhir (store.expiringList(8)).
   * Teks kosong menyebut jendela 30 hari -- harus sinkron dengan ambang di store.
   * Nilai teks dari data di-escape (esc) karena dirangkai ke innerHTML.
   */
  function renderExpiring() {
    const { total, items } = store.expiringList(8);
    $('expiringCount').textContent = total ? '· ' + num(total) + ' gerai' : '';
    $('expiringList').innerHTML = items.length
      ? items.map((x) => '<li><div><strong>' + esc(x.rec.namaGerai) + '</strong><small>' + esc(x.rec.vendor) + (x.rec.idPelanggan ? ' · ' + esc(x.rec.idPelanggan) : '') + '</small></div>' + badge(x.days) + '</li>').join('')
      : '<li class="expiring-empty">Tidak ada sewa yang berakhir dalam 30 hari.</li>';
  }

  // ---------- Chip vendor ----------

  /**
   * Merender chip filter vendor ("Semua" + satu chip per config.vendors) beserta jumlah gerainya.
   * Chip aktif ditandai class is-active sesuai store.state.vendor ('' = semua).
   * Klik chip ditangani di app.js (bindEvents, delegasi event pada #vendorChips lewat atribut data-vendor).
   * TROUBLESHOOT: chip tidak bereaksi -> cek handler klik #vendorChips di app.js dan atribut data-vendor.
   */
  function renderChips(s) {
    const chips = ['<button type="button" class="chip' + (store.state.vendor === '' ? ' is-active' : '') + '" data-vendor="">Semua <span>' + s.total + '</span></button>']
      .concat(config.vendors.map((v) => {
        const active = store.state.vendor === v ? ' is-active' : '';
        return '<button type="button" class="chip' + active + '" data-vendor="' + esc(v) + '">' + esc(v) + ' <span>' + (s.byVendor[v] || 0) + '</span></button>';
      }));
    $('vendorChips').innerHTML = chips.join('');
  }

  // ---------- Titik masuk ----------

  /** Merender seluruh dashboard dari satu snapshot store.stats(); aman dipanggil berulang (idempoten). */
  function render() {
    const s = store.stats();
    $('statTotal').textContent = num(s.total);
    $('statActive').textContent = num(s.active);
    $('statInactive').textContent = num(s.inactive);
    $('statExisting').textContent = num(s.existing);
    $('statTakeout').textContent = num(s.takeout);
    $('statExpiring').textContent = num(s.expiring);
    $('statExpired').textContent = num(s.expired);
    $('statSoon').textContent = num(s.soon);
    $('statMid').textContent = num(s.mid);
    $('statLong').textContent = num(s.long);
    renderDonut(s);
    renderPayment();
    renderExpiring();
    renderChips(s);
  }

  return { render };
})();
