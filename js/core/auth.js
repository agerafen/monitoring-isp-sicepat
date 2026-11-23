/* Autentikasi sisi-browser: akun admin, hash password (PBKDF2), sesi, dan pembatasan percobaan.
   CATATAN: tanpa server, ini hanya "gerbang" tampilan - bukan keamanan sungguhan. */
/*
 * auth.js
 * Tujuan   : logika autentikasi (tanpa UI): satu akun admin di localStorage, hash password PBKDF2-SHA256,
 *            sesi (sessionStorage / localStorage bila "ingat saya"), dan penguncian setelah gagal berulang.
 * Fitur    : login/gerbang aplikasi. UI-nya ada di ui-auth.js (App.authUi).
 * Dependensi: tidak memakai modul App lain; butuh Web Crypto (crypto.subtle) dan btoa/atob.
 * Diekspos : { cryptoAvailable, hasAccount, createAccount, verify, startSession, isAuthenticated, logout,
 *              currentUser, changePassword, lockRemaining, MIN_PASSWORD }.
 *
 * Key penyimpanan:
 *   localStorage  'isp-auth-v1'     -> akun {name, username, role, salt, iterations, hash}
 *   localStorage  'isp-auth-lock'   -> {fails, until} (penghitung gagal & waktu buka kunci, ms epoch)
 *   sessionStorage/localStorage 'isp-session-v1' -> {u: username, exp: ms epoch, 0 = berakhir saat tab ditutup}
 *
 * TROUBLESHOOT: lupa password -> tidak ada reset; hapus key 'isp-auth-v1' dan 'isp-session-v1' dari
 *   localStorage/sessionStorage (DevTools > Application) agar layar "Buat Akun Admin" muncul lagi.
 *   Login selalu diminta lagi -> storage diblokir (mode privat) atau sesi kedaluwarsa (exp).
 *   "butuh localhost/https" -> crypto.subtle tidak tersedia di http non-localhost / file://; buka lewat localhost.
 *   Terkunci -> tunggu LOCK_SECONDS atau hapus key 'isp-auth-lock'.
 */
App.auth = (function () {
  // ---------- Konstanta ----------
  // Key penyimpanan (lihat daftar di header).
  const ACCOUNT_KEY = App.config.authKeys.account;
  const SESSION_KEY = App.config.authKeys.session;
  const LOCK_KEY = App.config.authKeys.lock;
  // Jumlah putaran PBKDF2; makin besar makin lambat ditebak (dan lambat login). Disimpan per akun,
  // jadi mengubah nilai ini tidak merusak akun lama (verify memakai acc.iterations).
  const ITERATIONS = 150000;
  // Lama sesi bila centang "ingat saya" (hari).
  const REMEMBER_DAYS = 7;
  // Batas gagal login berturut-turut sebelum dikunci, dan lama kunci (detik).
  const MAX_FAILS = 5;
  const LOCK_SECONDS = 30;
  // Panjang minimal password (juga diekspos ke UI).
  const MIN_PASSWORD = 8;

  // ---------- util ----------
  // toB64/fromB64: konversi ArrayBuffer <-> string base64 untuk menyimpan salt & hash di JSON.
  const enc = new TextEncoder();
  const toB64 = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  /** True bila Web Crypto tersedia. Hanya ada di konteks aman (https atau localhost). */
  function cryptoAvailable() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
  }

  /**
   * Menurunkan hash PBKDF2 (SHA-256, 256 bit) dari password + salt (Uint8Array); hasil base64.
   * Async dan sengaja berat (iterations). Melempar error bila crypto.subtle tidak ada.
   */
  async function derive(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    return toB64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
  }

  /** Perbandingan string waktu-konstan (XOR semua karakter) agar tidak membocorkan posisi beda lewat waktu. */
  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  // Username dinormalisasi (trim + huruf kecil) sehingga login tidak peka huruf besar/kecil.
  const normUser = (u) => String(u || '').trim().toLowerCase();

  /** Baca & parse JSON dari storage; null bila kosong, rusak, atau storage diblokir. */
  function read(storage, key) {
    try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  // ---------- akun ----------
  // Hanya satu akun yang didukung (satu key). hasAccount() menentukan layar login vs buat-akun di ui-auth.js.
  const getAccount = () => read(window.localStorage, ACCOUNT_KEY);
  const hasAccount = () => !!getAccount();

  /** Validasi kekuatan password; return pesan error (string) atau null bila lolos. Aturan: min MIN_PASSWORD, ada huruf dan angka. */
  function checkPassword(pw) {
    // Hanya teks yang diterima (angka/objek/array dari pemanggil keliru ditolak) dan panjang dibatasi 256 karakter.
    if (typeof pw !== 'string') return 'Password harus berupa teks.';
    if (pw.length > 256) return 'Password terlalu panjang (maksimal 256 karakter).';
    if (!pw || pw.length < MIN_PASSWORD) return 'Password minimal ' + MIN_PASSWORD + ' karakter.';
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password harus mengandung huruf dan angka.';
    return null;
  }

  /** Membuat catatan kredensial baru: salt acak 16 byte + jumlah iterasi + hash. Dipakai saat buat akun & ganti password. */
  async function makeRecord(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { salt: toB64(salt), iterations: ITERATIONS, hash: await derive(password, salt, ITERATIONS) };
  }

  /**
   * Buat akun admin pertama. Hanya boleh bila belum ada akun.
   * Return { ok: true } atau { ok: false, error }. Efek samping: menulis localStorage[ACCOUNT_KEY].
   * Username: 3-32 karakter [a-z0-9._-] (setelah dinormalisasi). Nama tampilan default = username.
   * TROUBLESHOOT: "Akun sudah ada" padahal merasa belum -> key 'isp-auth-v1' tersisa di localStorage origin ini
   *   (origin berbeda, mis. localhost:5500 vs 127.0.0.1, punya storage terpisah).
   */
  async function createAccount({ name, username, password } = {}) {
    if (!cryptoAvailable()) return { ok: false, error: 'Browser ini tidak mendukung enkripsi (butuh localhost/https).' };
    if (hasAccount()) return { ok: false, error: 'Akun sudah ada. Silakan login.' };
    const user = normUser(username);
    if (!/^[a-z0-9._-]{3,32}$/.test(user)) return { ok: false, error: 'Username 3–32 karakter: huruf, angka, titik, strip, atau garis bawah.' };
    const pwErr = checkPassword(password);
    if (pwErr) return { ok: false, error: pwErr };
    try {
      const record = await makeRecord(password);
      window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(Object.assign({ name: String(name || '').trim() || user, username: user, role: 'Administrator' }, record)));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Gagal menyimpan akun: ' + err.message };
    }
  }

  // ---------- pembatasan percobaan ----------
  // Status kunci disimpan di localStorage (bertahan walau halaman dimuat ulang), {fails, until}.
  // Catatan: ini hanya hambatan tampilan; pengguna yang menghapus key 'isp-auth-lock' bisa melewatinya.
  function lockState() {
    const s = read(window.localStorage, LOCK_KEY) || { fails: 0, until: 0 };
    return s;
  }
  function saveLock(s) { try { window.localStorage.setItem(LOCK_KEY, JSON.stringify(s)); } catch (e) { /* abaikan */ } }
  /** Sisa detik kunci (dibulatkan ke atas); 0 bila tidak terkunci. */
  function lockRemaining() {
    const s = lockState();
    return Math.max(0, Math.ceil((s.until - Date.now()) / 1000));
  }

  /**
   * Verifikasi kredensial (tanpa membuat sesi). Return { ok } atau { ok:false, error }.
   * Alur: cek crypto -> cek kunci -> hash password dengan salt akun -> bandingkan waktu-konstan.
   * Berhasil: reset penghitung gagal. Gagal: fails++; mencapai MAX_FAILS -> kunci LOCK_SECONDS detik
   * dan penghitung di-reset. Pesan yang berawalan "Username" dipakai changePassword() untuk membedakan salah-password.
   */
  async function verify(username, password) {
    if (!cryptoAvailable()) return { ok: false, error: 'Browser ini tidak mendukung enkripsi (butuh localhost/https).' };
    const wait = lockRemaining();
    if (wait > 0) return { ok: false, error: 'Terlalu banyak percobaan gagal. Coba lagi dalam ' + wait + ' detik.' };
    const acc = getAccount();
    if (!acc) return { ok: false, error: 'Belum ada akun.' };
    let good = false;
    // Masukan bukan teks / terlalu panjang diperlakukan sebagai password salah (tetap dihitung sebagai percobaan gagal).
    if (typeof password !== 'string' || password.length > 256) password = '';
    try {
      const hash = await derive(password, fromB64(acc.salt), acc.iterations);
      good = normUser(username) === acc.username && safeEqual(hash, acc.hash);
    } catch (err) {
      return { ok: false, error: 'Gagal memeriksa password: ' + err.message };
    }
    if (good) { saveLock({ fails: 0, until: 0 }); return { ok: true }; }
    const s = lockState();
    s.fails += 1;
    if (s.fails >= MAX_FAILS) { s.fails = 0; s.until = Date.now() + LOCK_SECONDS * 1000; saveLock(s); return { ok: false, error: 'Terlalu banyak percobaan gagal. Akun dikunci ' + LOCK_SECONDS + ' detik.' }; }
    saveLock(s);
    return { ok: false, error: 'Username atau password salah. (' + (MAX_FAILS - s.fails) + ' percobaan tersisa)' };
  }

  // ---------- sesi ----------
  /**
   * Menyimpan sesi: remember=true -> localStorage dengan kedaluwarsa REMEMBER_DAYS hari (86400000 ms/hari);
   * false -> sessionStorage (exp 0 = hilang saat tab/browser ditutup). Sesi lama dibersihkan dari kedua storage.
   */
  function startSession(username, remember) {
    const payload = JSON.stringify({ u: normUser(username), exp: remember ? Date.now() + REMEMBER_DAYS * 86400000 : 0 });
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(SESSION_KEY);
      (remember ? window.localStorage : window.sessionStorage).setItem(SESSION_KEY, payload);
    } catch (e) { /* sesi tidak tersimpan: login diminta lagi saat muat ulang */ }
  }

  /**
   * True bila ada akun, sesi tersimpan milik username akun itu, dan belum kedaluwarsa.
   * Dipakai gate() di ui-auth.js untuk memutuskan langsung masuk atau tampilkan login.
   */
  function isAuthenticated() {
    const acc = getAccount();
    if (!acc) return false;
    const s = read(window.sessionStorage, SESSION_KEY) || read(window.localStorage, SESSION_KEY);
    if (!s || s.u !== acc.username) return false;
    return !s.exp || s.exp > Date.now();
  }

  /** Menghapus sesi dari sessionStorage dan localStorage (akun tidak dihapus). */
  function logout() {
    try { window.sessionStorage.removeItem(SESSION_KEY); window.localStorage.removeItem(SESSION_KEY); } catch (e) { /* abaikan */ }
  }

  /** Info akun untuk kotak pengguna di menu: { name, username, role } atau null bila belum ada akun. */
  function currentUser() {
    const acc = getAccount();
    return acc ? { name: acc.name, username: acc.username, role: acc.role || 'Administrator' } : null;
  }

  // ---------- ganti password ----------

  /**
   * Ganti password: verifikasi password lama (ikut kena aturan penguncian), validasi password baru,
   * lalu tulis ulang catatan hash+salt baru dengan mempertahankan data akun lain.
   * Return { ok } atau { ok:false, error }.
   */
  async function changePassword(oldPassword, newPassword) {
    const acc = getAccount();
    if (!acc) return { ok: false, error: 'Belum ada akun.' };
    const check = await verify(acc.username, oldPassword);
    if (!check.ok) return { ok: false, error: check.error.indexOf('Username') === 0 ? 'Password saat ini salah.' : check.error };
    const pwErr = checkPassword(newPassword);
    if (pwErr) return { ok: false, error: pwErr };
    try {
      const record = await makeRecord(newPassword);
      window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(Object.assign({}, acc, record)));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Gagal menyimpan password: ' + err.message };
    }
  }

  return { cryptoAvailable, hasAccount, createAccount, verify, startSession, isAuthenticated, logout, currentUser, changePassword, lockRemaining, MIN_PASSWORD };
})();
