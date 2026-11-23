/* Dialog tambah / ubah gerai, termasuk input pembayaran per bulan.
 *
 * Fitur      : halaman Data Gerai (form di <dialog id="formDialog">; tabelnya ada di ui-table.js).
 * Dependensi : App.store (find/add/update/years/state), App.utils, App.config (statuses, vendors,
 *              remarks, months, monthsLong), App.validation (check), App.toast.
 * Diekspos   : { init, open } -> init(callback) dipasang sekali (callback dipanggil setelah simpan
 *              sukses, biasanya me-render ulang tabel); open(id) membuka form (tanpa id = tambah).
 *
 * TROUBLESHOOT: error null saat open()/init() -> id elemen tidak ada di index.html. Yang dipakai:
 * formDialog, gerForm, formTitle, formErrors, formCancel, formClose, payGrid, payTotal, fKodeInduk,
 * fPo, fNamaGerai, fAlamat, fAkhirSewa, fIdPelanggan, fStatus, fVendor, fRemark, fCatatan, fYear.
 * Input bulan dibuat dinamis oleh renderPayments() dengan id pay-0 .. pay-11.
 */
App.form = (function () {
  const { store, utils, config, validation, toast } = App;
  const esc = utils.escapeHtml;
  const $ = (id) => document.getElementById(id);

  // State form: editingId = id gerai yang diubah (null = mode tambah); working = salinan kerja pembayaran
  // semua tahun (agar pindah tahun di form tidak menghilangkan isian); formYear = tahun yang sedang
  // ditampilkan; onSaved = callback dari init().
  let editingId = null;
  let working = {};      // { '2026': [12 nilai] } salinan kerja pembayaran
  let formYear = '';
  let onSaved = function () {};

  // Isi <select> dari daftar `items`; opsi kosong di awal hanya bila ada `placeholder`.
  // `selected` menandai opsi terpilih (perbandingan persis).
  function fillSelect(el, items, selected, placeholder) {
    const opts = (placeholder ? ['<option value="">' + esc(placeholder) + '</option>'] : [])
      .concat(items.map((i) => '<option value="' + esc(i) + '"' + (i === selected ? ' selected' : '') + '>' + esc(i) + '</option>'));
    el.innerHTML = opts.join('');
  }

  // ---------- pembayaran per bulan ----------
  // Baca 12 input bulan (#pay-0..#pay-11) menjadi array angka. Return { arr, invalid }:
  // invalid = nama bulan yang nominalnya tidak valid (parseAmount mengembalikan undefined).
  // Efek samping: menambah/menghapus kelas `is-invalid` pada input terkait.
  // Asumsi: input sudah dirender oleh renderPayments(), kalau belum $('pay-i') bernilai null.
  function readPaymentInputs() {
    const arr = utils.emptyPayments();
    const invalid = [];
    config.months.forEach((_, i) => {
      const raw = $('pay-' + i).value;
      const n = utils.parseAmount(raw);
      if (n === undefined) { invalid.push(config.monthsLong[i]); $('pay-' + i).classList.add('is-invalid'); }
      else { arr[i] = n; $('pay-' + i).classList.remove('is-invalid'); }
    });
    return { arr, invalid };
  }

  // Gambar ulang 12 input bulan di #payGrid dari working[formYear] (kosong bila tahun belum ada;
  // null/undefined ditampilkan sebagai kolom kosong), lalu hitung ulang total.
  function renderPayments() {
    const arr = working[formYear] || utils.emptyPayments();
    $('payGrid').innerHTML = config.monthsLong.map((name, i) =>
      '<label class="pay-field"><span>' + name + '</span>' +
      '<input type="text" inputmode="numeric" id="pay-' + i + '" autocomplete="off" placeholder="0" value="' + (arr[i] == null ? '' : arr[i]) + '"></label>').join('');
    updateTotal();
  }

  // Jumlahkan input bulan dan tampilkan di #payTotal (format rupiah). Input tidak valid dihitung 0
  // di sini; peringatannya baru muncul saat submit.
  function updateTotal() {
    const total = config.months.reduce((t, _, i) => {
      const n = utils.parseAmount($('pay-' + i).value);
      return t + (typeof n === 'number' ? n : 0);
    }, 0);
    $('payTotal').textContent = utils.formatRupiah(total);
  }

  // ---------- dialog ----------
  // Tampilkan daftar error di #formErrors; array kosong = sembunyikan dan bersihkan kotak.
  function showErrors(list) {
    const box = $('formErrors');
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<strong>Periksa kembali isian berikut:</strong><ul>' + list.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>';
    box.scrollIntoView({ block: 'nearest' });
  }

  // Buka dialog. id = null -> tambah (default status 'Active', remark 'Existing'); id terisi -> ubah.
  // Efek samping: reset editingId/working, isi semua field & select, tahun awal = store.state.year,
  // render input pembayaran, showModal(), fokus ke Kode Induk.
  // TROUBLESHOOT: data pembayaran tidak muncul -> rec.payments harus berbentuk { 'tahun': [12 nilai] }.
  function open(id) {
    const rec = id ? store.find(id) : null;
    if (id && !rec) { toast.error('Data tidak ditemukan.'); return; }
    editingId = rec ? rec.id : null;
    working = {};
    if (rec) Object.keys(rec.payments).forEach((y) => { working[y] = rec.payments[y].slice(); });
    formYear = store.state.year;

    $('formTitle').textContent = rec ? 'Ubah Data Gerai' : 'Tambah Gerai';
    $('fKodeInduk').value = rec ? rec.kodeInduk : '';
    $('fPo').value = rec ? rec.po : '';
    $('fNamaGerai').value = rec ? rec.namaGerai : '';
    $('fAlamat').value = rec ? rec.alamat : '';
    $('fAkhirSewa').value = rec ? rec.akhirSewa : '';
    $('fIdPelanggan').value = rec ? rec.idPelanggan : '';
    fillSelect($('fStatus'), config.statuses, rec ? rec.status : 'Active');
    fillSelect($('fVendor'), config.vendors, rec ? rec.vendor : '', 'Pilih vendor…');
    fillSelect($('fRemark'), config.remarks, rec ? rec.remark : 'Existing');
    $('fCatatan').value = rec ? rec.catatan : '';
    fillSelect($('fYear'), store.years(), formYear);
    $('fYear').value = formYear;
    showErrors([]);
    renderPayments();
    $('formDialog').showModal();
    $('fKodeInduk').focus();
  }

  // Handler submit #gerForm. Alur: baca pembayaran tahun aktif -> simpan ke working -> kumpulkan data
  // form -> validation.check (aturan di App.validation; editingId dikecualikan dari cek duplikat) ->
  // store.add/update -> tutup dialog, toast, panggil onSaved(). Error pembayaran dan validasi digabung
  // dalam satu daftar. Bila gagal, dialog tetap terbuka.
  // TROUBLESHOOT: kolom baru tidak tersimpan -> tambahkan di objek `data` ini, di store, dan di open().
  function submit(e) {
    e.preventDefault();
    const { arr, invalid } = readPaymentInputs();
    const errors = [];
    if (invalid.length) errors.push('Nominal pembayaran tidak valid pada bulan: ' + invalid.join(', ') + ' (gunakan angka ≥ 0).');
    working[formYear] = arr;

    const data = {
      kodeInduk: utils.normalizeText($('fKodeInduk').value),
      po: utils.normalizeText($('fPo').value),
      namaGerai: utils.normalizeText($('fNamaGerai').value),
      alamat: utils.normalizeText($('fAlamat').value),
      akhirSewa: $('fAkhirSewa').value,
      status: $('fStatus').value,
      idPelanggan: utils.normalizeText($('fIdPelanggan').value),
      vendor: $('fVendor').value,
      remark: $('fRemark').value,
      catatan: utils.normalizeText($('fCatatan').value),
      payments: working
    };
    errors.push.apply(errors, validation.check(data, editingId));
    if (errors.length) { showErrors(errors); return; }

    const res = editingId ? store.update(editingId, data) : store.add(data);
    if (!res.ok) { showErrors([res.error]); return; }
    $('formDialog').close();
    toast.success(editingId ? 'Data gerai diperbarui.' : 'Gerai berhasil ditambahkan.');
    onSaved();
  }

  // Pasang listener dialog (panggil sekali). `callback` dijalankan setelah simpan sukses.
  // Listener #fYear: simpan dulu isian tahun lama ke working sebelum berganti tahun, agar tidak hilang.
  function init(callback) {
    onSaved = callback;
    $('gerForm').addEventListener('submit', submit);
    $('formCancel').addEventListener('click', () => $('formDialog').close());
    $('formClose').addEventListener('click', () => $('formDialog').close());
    $('payGrid').addEventListener('input', updateTotal);
    $('fYear').addEventListener('change', () => {
      working[formYear] = readPaymentInputs().arr;
      formYear = $('fYear').value;
      renderPayments();
    });
  }

  // API publik modul (lihat header file).
  return { init, open };
})();
