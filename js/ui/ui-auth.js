/* Layar login / pembuatan akun pertama, kotak pengguna di menu, ganti password, dan keluar. */
/*
 * ui-auth.js
 * Tujuan   : UI gerbang login: layar masuk / buat akun pertama, kotak pengguna di menu, dialog ganti
 *            password, dan tombol keluar. Aplikasi (start() di app.js) baru berjalan setelah gerbang terbuka.
 * Fitur    : autentikasi (logika ada di auth.js).
 * Dependensi: App.auth, App.toast, App.nav.closeMenu (dipakai saat klik "ganti password").
 * Diekspos : { gate(callback) } -- dipanggil app.js pada DOMContentLoaded.
 *
 * Alur: DOMContentLoaded -> gate(start) -> [crypto tidak ada: pesan "Browser tidak didukung", berhenti]
 *       -> [sesi valid: unlock()] atau [tampilkan form login/setup -> submit() -> unlock()] -> onReady() = start().
 *
 * TROUBLESHOOT: layar login tidak muncul / aplikasi tampak kosong atau terkunci -> body punya class is-locked
 *   dan #authScreen harus ada di index.html; cek console untuk error sebelum gate() (urutan script:
 *   auth.js, ui-toast.js, ui-nav.js sebelum ui-auth.js, app.js paling akhir). Error "null" -> id elemen
 *   berikut hilang: authScreen, authForm, authError, authTitle, authSub, authSubmit, authUser, authPass, authPass2,
 *   authName, authRemember, authShowPass, userName, userRole, userAvatar, btnLogout, btnChangePw, pwDialog,
 *   pwForm, pwOld, pwNew, pwNew2, pwError, pwSubmit, pwCancel, dan elemen berkelas .auth-setup/.auth-login.
 *   Aplikasi tidak jalan setelah login -> start() tidak terpanggil (onReady belum di-set oleh gate()).
 */
App.authUi = (function () {
  const { auth, toast } = App;
  const $ = (id) => document.getElementById(id);
  // Keadaan modul: mode form saat ini, callback start dari app.js, dan penanda start sekali saja.
  let mode = 'login';       // 'login' | 'setup'
  let onReady = function () {};
  let started = false;

  // ---------- Layar login / setup ----------

  /** Menampilkan/menyembunyikan kotak pesan error di layar login (#authError). Pesan kosong = sembunyikan. */
  function setError(msg) {
    const box = $('authError');
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  /**
   * Beralih antara mode 'login' dan 'setup' (buat akun pertama): ganti teks, tampilkan elemen
   * .auth-setup atau .auth-login, atur autocomplete dan atribut required (nama & konfirmasi hanya saat setup).
   */
  function setMode(next) {
    mode = next;
    const setup = mode === 'setup';
    $('authTitle').textContent = setup ? 'Buat Akun Admin' : 'Masuk';
    $('authSub').textContent = setup
      ? 'Belum ada akun. Buat akun admin pertama untuk mengamankan data pendataan ini.'
      : 'Masuk untuk membuka dashboard pendataan internet gerai.';
    $('authSubmit').textContent = setup ? 'Buat Akun & Masuk' : 'Masuk';
    document.querySelectorAll('.auth-setup').forEach((el) => { el.hidden = !setup; });
    document.querySelectorAll('.auth-login').forEach((el) => { el.hidden = setup; });
    $('authPass').autocomplete = setup ? 'new-password' : 'current-password';
    $('authName').required = setup;
    $('authPass2').required = setup;
    setError('');
  }

  /** Mengisi kotak pengguna di menu (nama, peran, inisial avatar) dari auth.currentUser(). */
  function fillUserBox() {
    const u = auth.currentUser();
    if (!u) return;
    $('userName').textContent = u.name;
    $('userRole').textContent = u.role + ' · @' + u.username;
    $('userAvatar').textContent = (u.name.trim()[0] || '?').toUpperCase();
  }

  /**
   * Buka kunci tampilan dan jalankan aplikasi (sekali saja).
   * Menghapus class is-locked dari body, menyembunyikan #authScreen, lalu memanggil onReady (start di app.js)
   * hanya pada pemanggilan pertama (flag started).
   */
  function unlock() {
    document.body.classList.remove('is-locked');
    $('authScreen').hidden = true;
    fillUserBox();
    if (!started) { started = true; onReady(); }
  }

  /**
   * Handler submit form login/setup. Mode setup: cocokkan konfirmasi, buat akun; lalu (kedua mode) verify()
   * -> startSession (centang "ingat saya" = sesi 7 hari) -> unlock(). Tombol dinonaktifkan selama proses
   * (PBKDF2 butuh waktu) dan diaktifkan lagi di finally. Error ditampilkan lewat setError().
   */
  async function submit(e) {
    e.preventDefault();
    const btn = $('authSubmit');
    const username = $('authUser').value;
    const password = $('authPass').value;
    setError('');
    if (!username.trim() || !password) { setError('Username dan password wajib diisi.'); return; }
    btn.disabled = true;
    try {
      if (mode === 'setup') {
        if (password !== $('authPass2').value) { setError('Konfirmasi password tidak sama.'); return; }
        const made = await auth.createAccount({ name: $('authName').value, username, password });
        if (!made.ok) { setError(made.error); return; }
      }
      const res = await auth.verify(username, password);
      if (!res.ok) { setError(res.error); $('authPass').value = ''; $('authPass').focus(); return; }
      auth.startSession(username, $('authRemember').checked);
      $('authPass').value = ''; $('authPass2').value = '';
      unlock();
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- ganti password ----------

  /** Membuka dialog modal ganti password dengan form bersih (memakai <dialog>.showModal()). */
  function openChangePassword() {
    $('pwForm').reset();
    $('pwError').hidden = true;
    $('pwDialog').showModal();
    $('pwOld').focus();
  }

  /** Submit dialog ganti password: cek konfirmasi, panggil auth.changePassword, tutup dialog + toast bila sukses. */
  async function submitChangePassword(e) {
    e.preventDefault();
    const err = (m) => { $('pwError').textContent = m; $('pwError').hidden = false; };
    const oldPw = $('pwOld').value, newPw = $('pwNew').value;
    if (newPw !== $('pwNew2').value) { err('Konfirmasi password baru tidak sama.'); return; }
    $('pwSubmit').disabled = true;
    try {
      const res = await auth.changePassword(oldPw, newPw);
      if (!res.ok) { err(res.error); return; }
      $('pwDialog').close();
      toast.success('Password berhasil diganti.');
    } finally {
      $('pwSubmit').disabled = false;
    }
  }

  /** Keluar: hapus sesi lalu muat ulang halaman supaya gerbang login tampil dan state aplikasi bersih. */
  function logout() {
    auth.logout();
    window.location.reload();
  }

  // ---------- gerbang ----------

  /**
   * Titik masuk modul. callback = start() dari app.js (dijalankan setelah login berhasil/sesi valid).
   * Memasang semua listener auth & dialog, lalu memutuskan tampilan: browser tanpa crypto -> pesan tidak didukung;
   * sudah login -> unlock(); selain itu -> form login (ada akun) atau setup (belum ada akun) + info kunci aktif.
   * TROUBLESHOOT: tombol/dialog tidak bereaksi -> salah satu getElementById di sini null sehingga gate() berhenti
   *   di tengah (listener setelahnya tidak terpasang, aplikasi tidak pernah start). Lihat console.
   *   Pesan "Browser tidak didukung" -> halaman dibuka lewat file:// atau http non-localhost (crypto.subtle butuh localhost/https).
   */
  function gate(callback) {
    onReady = callback;
    $('authForm').addEventListener('submit', submit);
    $('authShowPass').addEventListener('change', (e) => {
      $('authPass').type = e.target.checked ? 'text' : 'password';
      $('authPass2').type = e.target.checked ? 'text' : 'password';
    });
    $('btnLogout').addEventListener('click', logout);
    $('btnChangePw').addEventListener('click', () => { App.nav.closeMenu(); openChangePassword(); });
    $('pwForm').addEventListener('submit', submitChangePassword);
    $('pwCancel').addEventListener('click', () => $('pwDialog').close());
    $('pwDialog').addEventListener('mousedown', (e) => { if (e.target === $('pwDialog')) $('pwDialog').close(); });

    if (!auth.cryptoAvailable()) {
      $('authForm').hidden = true;
      $('authTitle').textContent = 'Browser tidak didukung';
      $('authSub').textContent = 'Login membutuhkan fitur enkripsi browser. Buka aplikasi lewat http://localhost (VS Code: Live Server / Ctrl+Shift+B) atau browser terbaru.';
      return;
    }
    if (auth.isAuthenticated()) { unlock(); return; }
    setMode(auth.hasAccount() ? 'login' : 'setup');
    $('authUser').focus();
    const wait = auth.lockRemaining();
    if (wait > 0) setError('Akun sedang dikunci. Coba lagi dalam ' + wait + ' detik.');
  }

  return { gate };
})();
