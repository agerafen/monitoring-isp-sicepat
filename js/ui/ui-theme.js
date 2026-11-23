/* Pengalih tema gelap / terang (tersimpan di localStorage; tema awal diterapkan di <head>). */
/*
 * ui-theme.js
 * Tujuan   : tombol pengalih tema gelap/terang. Atribut data-theme pada <html> dipakai CSS.
 * Dependensi: tidak ada modul App lain. Diekspos: { init }.
 * Catatan  : tema awal dibaca dari localStorage oleh skrip inline di <head> index.html (mencegah kedipan);
 *            file ini hanya menangani klik dan penyimpanan.
 *
 * TROUBLESHOOT: tombol tidak bereaksi -> id #themeToggle tidak ada di index.html atau init() belum dipanggil.
 *   Tema tidak diingat -> localStorage key 'isp-theme' diblokir, atau skrip di <head> tidak membacanya.
 *   Tidak ada data-theme = dianggap 'dark' (lihat current()).
 */
App.theme = (function () {
  // Key localStorage tema ('dark' | 'light'); harus sama dengan yang dibaca skrip di <head>.
  const KEY = 'isp-theme';

  /** Tema aktif dari atribut data-theme; nilai selain 'light' dianggap 'dark'. */
  function current() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  /** Menerapkan tema ke <html> lalu menyimpannya ke localStorage (efek samping DOM + storage). */
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { window.localStorage.setItem(KEY, theme); } catch (e) { /* abaikan: tema tetap berlaku di sesi ini */ }
  }

  /** Memasang listener klik pada #themeToggle untuk membalik tema. Panggil sekali dari app.js. */
  function init() {
    document.getElementById('themeToggle').addEventListener('click', () => apply(current() === 'dark' ? 'light' : 'dark'));
  }

  return { init };
})();
