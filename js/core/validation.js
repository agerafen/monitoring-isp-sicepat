/*
 * validation.js - Validasi data gerai. Mengembalikan daftar pesan error (kosong = valid).
 *
 * Bagian dari : form tambah/edit gerai (dipanggil UI sebelum menyimpan ke store).
 * Dependensi  : App.config (daftar vendor/status/remark), App.utils (normalizeText, parseDate),
 *               App.store (isDuplicate). Semua harus dimuat sebelum file ini.
 * Diekspos    : `App.validation` = { check }.
 *
 * TROUBLESHOOT: pesan "sudah terdaftar" muncul tak terduga -> aturan duplikat ada di
 * store.isDuplicate (vendor + ID pelanggan + nama gerai, tanpa peduli huruf besar/kecil).
 * Saat mengedit, pastikan `ignoreId` diisi id record yang sedang diedit.
 */
App.validation = (function () {
  const { config, utils, store } = App;

  /**
   * Periksa satu data gerai (objek hasil form). ignoreId = id record yang sedang diedit (null bila baru).
   * Return array pesan error berbahasa Indonesia; array kosong berarti valid. Tidak mengubah data.
   */
  function check(data, ignoreId) {
    const errors = [];
    // Pasangan [nama field, label untuk pesan error] untuk field teks wajib.
    const required = [
      ['namaGerai', 'Nama Gerai'],
      ['alamat', 'Alamat Gerai']
    ];
    required.forEach(([field, label]) => {
      if (!utils.normalizeText(data[field])) errors.push(label + ' wajib diisi.');
    });
    // Pilihan dropdown harus persis salah satu nilai di App.config (case-sensitive).
    if (!config.vendors.includes(data.vendor)) errors.push('Nama Vendor wajib dipilih.');
    if (!config.statuses.includes(data.status)) errors.push('Status wajib dipilih.');
    if (!config.remarks.includes(data.remark)) errors.push('Remark wajib dipilih.');
    // Akhir sewa opsional; bila diisi harus format YYYY-MM-DD dan tanggal nyata.
    if (data.akhirSewa && !utils.parseDate(data.akhirSewa)) errors.push('Tanggal akhir sewa tidak valid.');

    // Cek duplikat hanya bila vendor dan ID pelanggan terisi (ID kosong tidak dianggap duplikat).
    const idp = utils.normalizeText(data.idPelanggan);
    if (data.vendor && idp && store.isDuplicate(data.vendor, idp, utils.normalizeText(data.namaGerai), ignoreId)) {
      errors.push('Gerai ini dengan ID Pelanggan ' + idp + ' sudah terdaftar pada vendor ' + data.vendor + '.');
    }
    return errors;
  }

  // API publik App.validation.
  return { check };
})();
