/*
 * csv.js - Ekspor / impor CSV (pemisah koma atau titik koma saat impor).
 *
 * Bagian dari : fitur ekspor/impor data gerai. Juga dipakai excel.js (toRows, importRows) dan
 *               kemungkinan fitur jaringan (matchVendor, parse, rowsToCsv, download).
 * Dependensi  : App.config, App.utils, App.store (yearPayments, isDuplicate).
 * Diekspos    : `App.csv` = { toRows, toCsv, rowsToCsv, parse, matchVendor, download, importText, importRows }.
 *
 * Alur impor : teks -> parse() -> importRows() -> { records, errors }; baris bermasalah dilewati dan
 *              dilaporkan di `errors` ("Baris N: ..."), nomor baris sesuai nomor baris di file/Excel.
 *
 * TROUBLESHOOT: impor "kolom wajib tidak ditemukan" -> header harus memuat Nama Gerai & Vendor
 * (lihat FIELD_MAP; huruf non-a-z diabaikan saat mencocokkan). Karakter aneh di Excel -> pastikan
 * file ekspor memakai BOM UTF-8 di awal. Kolom bulan terbaca kosong -> nama kolom harus diawali
 * singkatan bulan (jan, feb, ... / inggris: may, aug, oct, dec).
 */
App.csv = (function () {
  const { config, utils, store } = App;

  // ---------- Ekspor ----------

  // Header kolom tetap (11 kolom) sebelum 12 kolom bulan. Urutan harus sama dengan isi baris di toRows().
  // Kolom "Sisa Masa Sewa / Hari" hanya informasi saat ekspor; saat impor dipakai bila Akhir Sewa kosong.
  const BASE_HEADERS = ['Kode Induk', 'PO', 'Nama Gerai', 'Alamat Gerai', 'Akhir Sewa (YYYY-MM-DD)', 'Sisa Masa Sewa / Hari', 'Status', 'ID Pelanggan', 'Nama Vendor', 'Remark', 'Keterangan Remark'];

  // Escape satu sel CSV: bila memuat kutip, koma, titik koma, atau baris baru -> bungkus dengan "..."
  // dan gandakan kutip di dalamnya (aturan standar CSV). Titik koma ikut di-quote agar aman di Excel lokal ID.
  function cell(v) {
    let s = String(v == null ? '' : v);
    // Keamanan "CSV/formula injection": teks yang diawali = + - @ (atau tab/CR) dieksekusi Excel sebagai rumus saat
    // file dibuka. Diawali tanda petik tunggal agar dibaca sebagai teks. Angka sungguhan (mis. -12, 1500) tidak diubah.
    // Pengecualian: angka murni (mis. -12) dan strip tunggal/berderet ("-" = placeholder kosong) yang bukan rumus.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) && !/^-+$/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /**
   * Tabel (array of arrays) berisi header + data, dipakai bersama oleh ekspor CSV dan Excel.
   * `rows` = record yang diekspor, `year` = tahun pembayaran (string). Bulan kosong -> sel ''.
   */
  function toRows(rows, year) {
    const out = [BASE_HEADERS.concat(config.monthsLong)];
    rows.forEach((r) => {
      // Sisa hari dihitung saat ekspor (bukan disimpan di record).
      const d = utils.daysRemaining(r.akhirSewa);
      const pays = store.yearPayments(r, year).map((v) => (v == null ? '' : v));
      out.push([r.kodeInduk, r.po, r.namaGerai, r.alamat, r.akhirSewa, d == null ? '' : d, r.status, r.idPelanggan, r.vendor, r.remark, r.catatan].concat(pays));
    });
    return out;
  }

  // Record -> teks CSV lengkap. Diawali BOM UTF-8 agar Excel membaca huruf non-ASCII dengan benar;
  // baris dipisah CRLF dan pemisah kolom koma.
  function toCsv(rows, year) {
    return '﻿' + toRows(rows, year).map((line) => line.map(cell).join(',')).join('\r\n');
  }

  // Picu unduhan file CSV di browser lewat Blob + tautan <a> sementara (ditambah lalu dihapus dari body).
  // Efek samping DOM; URL objek dilepas setelah 1 detik. TROUBLESHOOT: unduhan tak muncul -> cek pemblokir popup/unduhan.
  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Parsing CSV ----------

  /**
   * Parser CSV dengan dukungan tanda kutip. Return array baris (array string); baris kosong dibuang.
   * Pemisah dideteksi dari baris pertama: jika titik koma lebih banyak daripada koma -> ';', selain itu ','.
   * Mesin keadaan: inQuotes true = di dalam "..." (kutip ganda "" = satu kutip literal; koma/baris baru
   * dianggap isi). CRLF dan LF sama-sama dianggap akhir baris. BOM di awal dibuang.
   */
  function parse(text) {
    const clean = text.replace(/^﻿/, '');
    const firstLine = clean.split(/\r?\n/, 1)[0] || '';
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      if (inQuotes) {
        if (c === '"' && clean[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && clean[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ''));
  }

  // ---------- Normalisasi nilai impor ----------

  /**
   * Ubah sel tanggal ke 'YYYY-MM-DD'. Return '' bila kosong, null bila tidak valid (baris dilewati).
   * Format diterima: ISO, nomor seri Excel, dan DD/MM/YYYY atau DD-MM-YYYY (hari dulu, gaya Indonesia).
   */
  function normalizeDate(v) {
    const s = utils.normalizeText(v);
    if (!s) return '';
    if (utils.parseDate(s)) return s;
    // Nomor seri tanggal Excel (mis. 46100) bila sel tidak berformat tanggal.
    // Trik tanggal serial Excel: epoch Excel = 30 Des 1899 (Date.UTC bulan 11 = Desember), satu hari = 86400000 ms.
    // Syarat 5 digit dan > 20000 (sekitar tahun 1954) agar angka biasa tidak salah dibaca sebagai tanggal.
    // Pakai komponen UTC supaya tidak bergeser sehari oleh zona waktu.
    if (/^\d{5}$/.test(s) && Number(s) > 20000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    // Regex DD/MM/YYYY atau DD-MM-YYYY: m[1]=hari, m[2]=bulan, m[3]=tahun. Format MM/DD/YYYY (AS) akan salah/ditolak.
    const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s);
    if (m) {
      const iso = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
      if (utils.parseDate(iso)) return iso;
    }
    return null; // tidak valid
  }

  // Pemetaan nama kolom header (sudah dikecilkan & hanya huruf a-z, lihat keyOf di importRows) -> field record.
  // Tambahkan alias header baru di sini. Kolom tak dikenal diabaikan (type 'skip').
  const FIELD_MAP = {
    kodeinduk: 'kodeInduk', po: 'po',
    namagerai: 'namaGerai', gerai: 'namaGerai',
    alamatgerai: 'alamat', alamat: 'alamat',
    status: 'status',
    idpelanggan: 'idPelanggan',
    namavendor: 'vendor', vendor: 'vendor',
    remark: 'remark', remarks: 'remark',
    keteranganremark: 'catatan', reasontakeout: 'catatan', keterangan: 'catatan'
  };
  // Nama bulan Indonesia & Inggris (dicocokkan dari awalan nama kolom).
  const MONTH_CODES = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
  const MONTH_CODES_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  // Nama vendor di file sumber -> nama baku di aplikasi.
  const VENDOR_ALIASES = { 'satu akses indonesia': 'Satu ID', 'satuid': 'Satu ID', 'fiberstar': 'Fiberstart' };

  // Cocokkan teks vendor ke nama baku (tanpa peduli huruf) atau alias; null bila tidak dikenal.
  // Nama baku selalu didahulukan dari VENDOR_ALIASES. Tambahkan variasi ejaan baru di VENDOR_ALIASES (huruf kecil).
  function matchVendor(value) {
    const v = utils.normalizeText(value).toLowerCase();
    return matchCase(v, config.vendors) || VENDOR_ALIASES[v] || null;
  }

  /**
   * Pisahkan "Takeout Nov 25" menjadi { remark: 'Takeout', catatan: 'Nov 25' }.
   * Regex: kata awal existing/takeout (tak peduli huruf) + pemisah opsional (spasi, titik dua, koma, minus)
   * + sisa teks sebagai catatan. Tanpa kata awal itu -> remark null dan seluruh teks jadi catatan.
   */
  function splitRemark(value) {
    const m = /^(existing|takeout)\b[\s:,-]*(.*)$/i.exec(utils.normalizeText(value));
    if (!m) return { remark: null, catatan: utils.normalizeText(value) };
    return { remark: matchCase(m[1], config.remarks), catatan: m[2].trim() };
  }

  // Cari elemen `list` yang sama dengan `value` tanpa peduli huruf; kembalikan bentuk baku dari list, atau null.
  function matchCase(value, list) {
    const v = utils.normalizeText(value).toLowerCase();
    return list.find((x) => x.toLowerCase() === v) || null;
  }

  // ---------- Impor ----------

  /**
   * Ubah teks CSV menjadi record siap simpan.
   * @returns {{records:Array, errors:string[]}}
   */
  function importText(text, year) {
    return importRows(parse(text), year);
  }

  /**
   * Impor dari tabel (array of arrays) — dipakai CSV maupun Excel.
   * `year` = tahun tujuan kolom bulan (semua nominal masuk ke tahun ini). Return { records, errors };
   * record belum punya id (diberikan store). Baris tidak valid dilewati dengan pesan di errors.
   * TROUBLESHOOT: seluruh file ditolak -> lihat pesan pertama di errors (header tidak ketemu / kolom wajib hilang).
   */
  function importRows(allRows, year) {
    const errors = [];
    // Pertahanan: input yang bukan tabel / baris yang bukan array dianggap kosong (jangan sampai crash),
    // dan jumlah baris dibatasi (config.maxImportRows) agar browser tidak membeku pada file raksasa.
    allRows = (Array.isArray(allRows) ? allRows : []).map((r) => (Array.isArray(r) ? r : []));
    if (allRows.length > config.maxImportRows) {
      return { records: [], errors: ['File terlalu besar: ' + allRows.length + ' baris (maksimal ' + config.maxImportRows + '). Pecah file menjadi beberapa bagian.'] };
    }
    // Normalisasi header: huruf kecil dan buang semua selain a-z ("Nama Gerai" -> "namagerai", "Akhir Sewa (YYYY-MM-DD)" -> "akhirsewayyyymmdd").
    const keyOf = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z]/g, '');
    // Header = baris pertama (dalam 15 baris awal) yang memuat kolom "Kode Induk".
    let headerAt = allRows.slice(0, 15).findIndex((r) => r.some((h) => keyOf(h) === 'kodeinduk'));
    if (headerAt < 0) headerAt = 0;
    const rows = allRows.slice(headerAt);
    if (rows.length < 2) return { records: [], errors: ['File kosong atau tidak memiliki baris data.'] };

    // Peta kolom: tiap kolom header -> jenis (akhirSewa | sisa | field | month | skip).
    // Urutan cek penting: 'akhir*' dan 'sisa*' diperiksa sebelum FIELD_MAP dan nama bulan.
    // Pencocokan bulan memakai awalan nama kolom (jadi "Januari" dan "Jan 2026" sama-sama bulan 0).
    const map = rows[0].map((h) => {
      const key = keyOf(h);
      if (key.startsWith('akhir')) return { type: 'akhirSewa' };
      if (key.startsWith('sisa')) return { type: 'sisa' };
      if (FIELD_MAP[key]) return { type: 'field', name: FIELD_MAP[key] };
      let mi = MONTH_CODES.findIndex((c) => key.startsWith(c));
      if (mi < 0) mi = MONTH_CODES_EN.findIndex((c) => key.startsWith(c));
      if (mi >= 0) return { type: 'month', index: mi };
      return { type: 'skip' };
    });

    // Kolom wajib minimal: Nama Gerai dan Vendor.
    const names = map.filter((m) => m.type === 'field').map((m) => m.name);
    const missing = ['namaGerai', 'vendor'].filter((n) => !names.includes(n));
    if (missing.length) return { records: [], errors: ['Kolom wajib tidak ditemukan di header: ' + missing.join(', ') + '.'] };

    const records = [];
    // Indeks duplikat O(1): berisi data tersimpan + baris yang sudah diterima dari file ini (dibangun sekali).
    const dup = store.duplicateIndex();
    rows.slice(1).forEach((cols, idx) => {
      if (!cols.some((c) => utils.normalizeText(c) !== '')) return; // lewati baris kosong
      // Nomor baris untuk pesan error (1-based, relatif ke file): offset header + indeks data + 2.
      const line = headerAt + idx + 2;
      const rec = { payments: {} };
      const pays = utils.emptyPayments();
      let sisaDays = null;
      // Pesan alasan baris ditolak (null = baris valid sejauh ini); hanya alasan pertama yang dicatat per tahap.
      let bad = null;
      map.forEach((m, i) => {
        const val = cols[i] == null ? '' : cols[i];
        if (m.type === 'field') rec[m.name] = utils.normalizeText(val);
        else if (m.type === 'akhirSewa') {
          const d = normalizeDate(val);
          if (d === null) bad = 'tanggal akhir sewa tidak valid';
          else rec.akhirSewa = d;
        } else if (m.type === 'sisa') {
          // Bila hanya ada "Sisa Masa Sewa / Hari", akhir sewa dihitung dari hari ini.
          const n = Number(utils.normalizeText(val).replace(/[^\d-]/g, ''));
          // Nilai tak masuk akal (mis. -46329 akibat sel akhir sewa kosong) diabaikan.
          if (utils.normalizeText(val) !== '' && Number.isInteger(n) && Math.abs(n) <= 5000) sisaDays = n;
        } else if (m.type === 'month') {
          // Sel hanya berisi tanda strip (-, en dash, em dash) berarti "belum bayar" -> null; selebihnya parseAmount
          // (undefined = tidak valid -> baris ditolak).
          const raw = utils.normalizeText(val);
          const n = /^[-–—]+$/.test(raw) ? null : utils.parseAmount(raw);
          if (n === undefined) bad = 'nominal bulan ' + config.monthsLong[m.index] + ' tidak valid';
          else pays[m.index] = n;
        }
      });
      // Pasca-proses per baris: turunkan akhirSewa dari sisa hari, baku-kan status & remark (default Active/Existing).
      if (!rec.akhirSewa && sisaDays !== null) rec.akhirSewa = utils.addDays(sisaDays);
      rec.status = matchCase(rec.status, config.statuses) || 'Active';
      const rm = splitRemark(rec.remark);
      rec.remark = rm.remark || (/take\s?out/i.test(rec.remark || '') ? 'Takeout' : 'Existing');
      // Gabungkan catatan dari kolom keterangan dan sisa teks kolom remark dengan pemisah " – " (en dash).
      rec.catatan = [utils.normalizeText(rec.catatan), rm.catatan].filter(Boolean).join(' – ');
      // PO berisi hanya strip = placeholder kosong dari sumber -> kosongkan.
      if (/^[-–—]+$/.test(rec.po || '')) rec.po = '';
      // Validasi akhir: nama gerai wajib, vendor harus dikenal (matchVendor), lalu cek duplikat.
      const vendor = matchVendor(rec.vendor);
      if (!bad && !rec.namaGerai) bad = 'Nama Gerai wajib diisi';
      if (!bad && !vendor) bad = 'vendor "' + (rec.vendor || '') + '" kosong atau tidak dikenal';
      if (!bad) {
        rec.vendor = vendor;
        // Duplikat = vendor + ID pelanggan + nama gerai sama (satu ID boleh dipakai beberapa gerai).
        if (rec.idPelanggan && dup.has(vendor, rec.idPelanggan, rec.namaGerai)) bad = 'data duplikat (' + vendor + ' / ' + rec.idPelanggan + ' / ' + rec.namaGerai + ')';
        else if (rec.idPelanggan) dup.add(vendor, rec.idPelanggan, rec.namaGerai);
      }
      // Baris bermasalah dilewati (tidak membatalkan impor); pembayaran disimpan pada tahun `year`.
      if (bad) { errors.push('Baris ' + line + ': ' + bad + ' (dilewati).'); return; }
      rec.payments[year] = pays;
      records.push(rec);
    });
    return { records, errors };
  }

  // ---------- Ekspor tabel generik ----------

  /** Tabel (array of arrays) -> teks CSV (dengan BOM agar terbaca benar di Excel). */
  function rowsToCsv(rows) {
    return '﻿' + rows.map((line) => line.map(cell).join(',')).join('\r\n');
  }

  // API publik App.csv.
  return { toRows, toCsv, rowsToCsv, parse, matchVendor, download, importText, importRows };
})();
