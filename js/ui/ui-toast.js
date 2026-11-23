/* Notifikasi singkat (toast). */
/*
 * ui-toast.js
 * Tujuan   : notifikasi singkat yang muncul di wadah #toasts dan hilang otomatis.
 * Dependensi: tidak ada modul App lain (CSS .toast, .toast-info/-success/-error, .toast-out).
 * Diekspos : { info(msg), success(msg), error(msg) }.
 *
 * TROUBLESHOOT: toast tidak muncul -> elemen #toasts tidak ada di index.html (fungsi keluar diam-diam),
 *   atau CSS .toast belum dimuat. Pastikan script ini dimuat sebelum modul yang memanggil App.toast.
 */
App.toast = (function () {
  /**
   * Membuat elemen toast, menambahkannya ke #toasts, lalu menghapusnya setelah jeda.
   * type: 'info' (default) | 'success' | 'error'. Error memakai role=alert dan tampil lebih lama
   * (7000 ms vs 3500 ms); 300 ms terakhir = durasi animasi keluar (.toast-out).
   */
  function show(message, type) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 7000 : 3500);
  }
  return {
    info: (m) => show(m, 'info'),
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error')
  };
})();
