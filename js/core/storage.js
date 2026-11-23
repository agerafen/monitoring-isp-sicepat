/*
 * storage.js - Lapisan penyimpanan (localStorage) dengan penanganan error.
 *
 * Bagian dari : persistensi data (gerai dan jaringan memakai fungsi yang sama dengan key berbeda).
 * Dependensi  : App.config (storageKey). config.js harus dimuat sebelum file ini.
 * Diekspos    : `App.storage` = { load, save }. Keduanya tidak melempar error; hasil berupa
 *               objek { ok, ... } sehingga pemanggil wajib memeriksa `ok`.
 *
 * TROUBLESHOOT: data tidak tersimpan / hilang saat reload -> cek DevTools > Application >
 * Local Storage (key 'isp-pendataan-v1' / 'isp-network-v1'), mode private/incognito,
 * kuota penuh (~5MB), atau browser memblokir storage (file:// di beberapa browser).
 */
App.storage = (function () {
  // Key bawaan bila pemanggil tidak memberi key (data gerai).
  const defaultKey = App.config.storageKey;

  // ---------- Baca ----------

  /**
   * Baca array record dari localStorage. Kosong/belum ada -> { ok:true, data:[] }.
   * JSON rusak atau bukan array -> { ok:false, data:[], error }. Isi rusak disalin dulu ke key
   * "<key>.rusak-<waktu>" (lihat blok catch) karena penyimpanan berikutnya akan menimpa key aslinya.
   * @returns {{ok:boolean, data:Array, error?:string}}
   */
  function load(key) {
    const useKey = key || defaultKey;
    let raw = null;
    try {
      raw = window.localStorage.getItem(useKey);
      if (!raw) return { ok: true, data: [] };
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Format data tersimpan tidak dikenali.');
      return { ok: true, data: parsed };
    } catch (err) {
      // Data rusak: simpan salinannya di key lain sebelum aplikasi sempat menimpanya, agar masih bisa
      // dipulihkan manual (DevTools > Application > Local Storage). Gagal menyalin diabaikan.
      let backupKey = '';
      try {
        if (raw) { backupKey = useKey + '.rusak-' + Date.now(); window.localStorage.setItem(backupKey, raw); }
      } catch (e) { backupKey = ''; }
      return {
        ok: false,
        data: [],
        error: 'Gagal membaca data tersimpan: ' + err.message + (backupKey ? ' Salinan data rusak disimpan di "' + backupKey + '".' : '')
      };
    }
  }

  // ---------- Tulis ----------

  /**
   * Simpan array record sebagai JSON ke localStorage (menimpa seluruh isi key).
   * Gagal (kuota penuh / storage diblokir) -> { ok:false, error }. Fungsi ini sendiri tidak mengubah memori;
   * store.js/net-store.js (applyChange) membatalkan perubahan di memori bila hasilnya ok:false, dan UI
   * menampilkan pesan error agar pengguna tahu perubahan belum tersimpan.
   * @returns {{ok:boolean, error?:string}}
   */
  function save(records, key) {
    try {
      window.localStorage.setItem(key || defaultKey, JSON.stringify(records));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Gagal menyimpan data (penyimpanan browser penuh atau diblokir): ' + err.message };
    }
  }

  // API publik App.storage.
  return { load, save };
})();
