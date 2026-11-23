/*
 * excel.js - Ekspor / impor Excel (.xlsx, .xls) memakai pustaka SheetJS (window.XLSX).
 *
 * Bagian dari : fitur ekspor/impor data (pendamping csv.js untuk format Excel).
 * Dependensi  : App.csv (importRows) dan pustaka eksternal SheetJS `window.XLSX` yang dimuat lewat
 *               tag <script> (kemungkinan dari CDN) di index.html SEBELUM fungsi di sini dipanggil.
 * Diekspos    : `App.excel` = { download, importBuffer, importBufferWith }.
 *
 * TROUBLESHOOT: error "Pustaka Excel (SheetJS) belum termuat" -> tidak ada koneksi internet/CDN
 * diblokir; periksa tag <script> SheetJS di index.html dan tab Network di DevTools. Pengguna dapat
 * memakai CSV sebagai alternatif (tidak butuh pustaka).
 */
App.excel = (function () {
  const { csv } = App;

  // Pastikan SheetJS sudah ada; bila belum, lempar Error (pemanggil UI harus menangkap dan menampilkan pesan).
  function ensureLib() {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('Pustaka Excel (SheetJS) belum termuat. Periksa koneksi internet lalu muat ulang halaman, atau gunakan CSV.');
    }
  }

  // ---------- Konversi sel ----------

  /**
   * Sel tanggal Excel -> 'YYYY-MM-DD'; sel lain -> teks/angka apa adanya (null/undefined jadi '').
   * Date dari SheetJS (cellDates:true) bisa jatuh di tengah malam UTC sehingga tampil mundur sehari
   * di zona waktu lokal; menambah 12 jam (12 * 3600 * 1000 ms) memastikan tanggalnya tetap benar.
   * TROUBLESHOOT: tanggal bergeser 1 hari -> periksa offset 12 jam ini.
   */
  function cellValue(v) {
    if (v instanceof Date && !isNaN(v)) {
      const d = new Date(v.getTime() + 12 * 3600 * 1000); // kebal selisih zona waktu
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
    return v == null ? '' : v;
  }

  // ---------- Ekspor ----------

  /**
   * Tulis tabel (array of arrays, baris pertama = header) ke file .xlsx dan unduh.
   * Efek samping: memicu unduhan browser. Melempar Error bila SheetJS belum termuat.
   */
  function download(filename, rows, sheetName) {
    ensureLib();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Lebar kolom: kolom ke-4 (index 3, Alamat Gerai) selalu 38 karakter; lainnya minimal 12 atau
    // panjang header + 2. Mengasumsikan rows[0] adalah header dan susunan kolom dari csv.toRows.
    ws['!cols'] = rows[0].map((h, i) => ({ wch: i === 3 ? 38 : Math.max(12, String(h).length + 2) }));
    // Bekukan baris header (1 baris teratas). Catatan: pada SheetJS edisi komunitas properti ini
    // mungkin diabaikan, tanpa efek error.
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Data');
    XLSX.writeFile(wb, filename);
  }

  // ---------- Impor ----------

  /**
   * Baca file Excel (ArrayBuffer) -> {records, errors}. Memakai sheet pertama yang berisi data.
   * `year` = tahun tujuan kolom bulan; pemetaan baris->record didelegasikan ke csv.importRows.
   */
  function importBuffer(buffer, year) {
    return importBufferWith(buffer, (rows) => csv.importRows(rows, year));
  }

  /**
   * Sama seperti importBuffer, tetapi pemetaan baris->record ditentukan pemanggil (importFn(rows) -> {records, errors}).
   * Setiap sheet dicoba berurutan; sheet pertama yang menghasilkan minimal satu record langsung dipakai.
   * Bila tidak ada, dikembalikan hasil (berisi pesan error) dari sheet terakhir yang punya data.
   * cellDates:true membuat sel tanggal menjadi objek Date (dikonversi oleh cellValue).
   */
  function importBufferWith(buffer, importFn) {
    ensureLib();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    if (!wb.SheetNames.length) return { records: [], errors: ['File Excel tidak memiliki sheet.'] };
    // Hasil cadangan bila tak ada sheet yang menghasilkan record.
    let best = { records: [], errors: ['Tidak ada data pada file Excel.'] };
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      // header:1 = hasil array-of-arrays (tanpa pemetaan header otomatis); raw:true menjaga angka/tanggal asli;
      // defval:'' mengisi sel kosong dengan string kosong agar kolom tetap sejajar.
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
      // sheet_to_json mulai dari baris pertama yang berisi data; isi baris kosong di atasnya
      // agar nomor baris di pesan error sama dengan nomor baris di Excel.
      const startRow = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;
      const rows = new Array(startRow).fill(null).map(() => []).concat(grid.map((r) => r.map(cellValue)));
      if (rows.length < 2) continue;
      const result = importFn(rows);
      if (result.records.length) return result;
      best = result; // simpan pesan error sheet terakhir yang berisi data
    }
    return best;
  }

  // API publik App.excel.
  return { download, importBuffer, importBufferWith };
})();
