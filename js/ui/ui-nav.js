/* Navigasi halaman berbasis hash (#dashboard, #data, #rekap) + menu kiri yang bisa dibuka di layar kecil. */
/*
 * ui-nav.js
 * Tujuan   : router sederhana berbasis location.hash, judul halaman, menu samping (buka/tutup di
 *            layar kecil, ciut/lebar di layar besar).
 * Fitur    : navigasi seluruh aplikasi.
 * Dependensi: App.charts.render (dipanggil saat halaman rekap tampil / lebar konten berubah).
 * Diekspos : { init, go(id), current(), setCount(n), closeMenu() }.
 *
 * TROUBLESHOOT: halaman kosong / tidak berpindah -> pastikan tiap section punya atribut
 *   data-page="<id>" dan tiap link menu punya data-nav="<id>" di index.html, serta id elemen:
 *   sidenav, sidenavBackdrop, menuToggle, navCollapse, pageTitle, pageHeading, pageSub, navCount
 *   dan elemen .shell. Hash tidak dikenal otomatis jatuh ke 'dashboard'.
 */
App.nav = (function () {
  // ---------- Daftar halaman ----------
  // Kunci = nilai hash URL. Menambah halaman baru: tambah entri di sini + section data-page + link data-nav.
  const PAGES = {
    dashboard: { title: 'Dashboard', sub: 'Ringkasan pendataan internet gerai, pembayaran ISP, dan masa sewa.' },
    network: { title: 'Data Network', sub: 'Konfigurasi jaringan tiap gerai: function, rasio, bandwidth, IP, DNS, dan perangkat Mikrotik.' },
    data: { title: 'Data Gerai', sub: 'Daftar gerai, vendor ISP, status, masa sewa, dan pembayaran bulanan.' },
    rekap: { title: 'Rekap Pembayaran', sub: 'Total pembayaran tiap ISP per bulan.' }
  };
  const DEFAULT = 'dashboard';
  const $ = (id) => document.getElementById(id);

  // ---------- Penentuan & penampilan halaman ----------

  /** Id halaman aktif dari hash URL; hash kosong/tidak valid -> DEFAULT. */
  function current() {
    const id = window.location.hash.replace('#', '');
    return PAGES[id] ? id : DEFAULT;
  }

  /** Membuka/menutup menu samping mode layar kecil (class is-open + backdrop + aria-expanded). */
  function setMenu(open) {
    $('sidenav').classList.toggle('is-open', open);
    $('sidenavBackdrop').hidden = !open;
    $('menuToggle').setAttribute('aria-expanded', String(open));
  }

  /**
   * Menampilkan halaman sesuai hash: sembunyikan section lain, tandai menu aktif (aria-current),
   * perbarui judul/subjudul/document.title, tutup menu mobile, dan gulir ke atas.
   * Dipanggil saat init dan setiap event hashchange.
   */
  function show() {
    const id = current();
    document.querySelectorAll('[data-page]').forEach((el) => { el.hidden = el.dataset.page !== id; });
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('pageTitle').textContent = PAGES[id].title;
    $('pageHeading').textContent = PAGES[id].title;
    $('pageSub').textContent = PAGES[id].sub;
    document.title = PAGES[id].title + ' · Monitoring ISP Sicepat';
    setMenu(false);
    if (id === 'rekap') App.charts.render();   // ukur ulang lebar tabel rekap setelah halaman terlihat
    window.scrollTo(0, 0);
  }

  /** Pindah halaman dengan mengubah hash (memicu hashchange -> show). Tidak melakukan apa pun bila sudah di sana. */
  function go(id) {
    if (current() === id && window.location.hash === '#' + id) return;
    window.location.hash = id;
  }

  // ---------- Menu ciut / lebar (layar besar) ----------
  // localStorage key 'isp-nav-collapsed': '1' = ciut, '0' = lebar, tidak ada = belum pernah dipilih.
  const COLLAPSE_KEY = 'isp-nav-collapsed';

  /**
   * Menerapkan keadaan menu ciut (class nav-collapsed pada .shell) + atribut aksesibilitas tombol.
   * save=true menyimpan pilihan ke localStorage (gagal diam-diam bila storage diblokir).
   * Delay 280 ms setelah ini = perkiraan durasi animasi CSS menu; samakan bila transisi CSS diubah.
   */
  function setCollapsed(collapsed, save) {
    document.querySelector('.shell').classList.toggle('nav-collapsed', collapsed);
    const btn = $('navCollapse');
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? 'Lebarkan menu' : 'Ciutkan menu');
    if (save) { try { window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) { /* abaikan */ } }
    // Lebar konten berubah setelah animasi menu selesai: ukur ulang tabel rekap.
    setTimeout(() => { if (current() === 'rekap') App.charts.render(); }, 280);
  }

  /** Pilihan pengguna diingat; bila belum ada, menu otomatis diciutkan di layar < 1700px agar tabel muat tanpa scroll samping. */
  function initCollapse() {
    let saved = null;
    try { saved = window.localStorage.getItem(COLLAPSE_KEY); } catch (e) { /* abaikan */ }
    setCollapsed(saved === null ? window.innerWidth < 1700 : saved === '1', false);
    $('navCollapse').addEventListener('click', () => setCollapsed(!document.querySelector('.shell').classList.contains('nav-collapsed'), true));
  }

  // ---------- Inisialisasi & API publik ----------

  /** Memasang semua listener navigasi (hashchange, menu, Esc) lalu menampilkan halaman awal. Panggil sekali dari app.js. */
  function init() {
    initCollapse();
    window.addEventListener('hashchange', show);
    $('menuToggle').addEventListener('click', () => setMenu(!$('sidenav').classList.contains('is-open')));
    $('sidenavBackdrop').addEventListener('click', () => setMenu(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    show();
  }

  /** Menampilkan jumlah gerai pada lencana menu (#navCount). */
  function setCount(n) {
    $('navCount').textContent = n;
  }

  return { init, go, current, setCount, closeMenu: () => setMenu(false) };
})();
