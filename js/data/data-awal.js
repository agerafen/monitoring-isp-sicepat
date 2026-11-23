/*
 * data-awal.js - TEMPLATE KOSONG data awal (aman untuk repositori Public).
 *
 * Berkas ini sengaja tidak berisi data. Bila dibiarkan kosong, aplikasi tidak mengisi data otomatis dan
 * tombol "Muat Data Internet.xlsx" tidak muncul; data dimasukkan lewat tombol Impor Excel/CSV.
 *
 * Untuk data awal otomatis di komputer sendiri: letakkan Internet.xlsx di folder data\ lalu jalankan
 * tools\convert-xlsx.ps1 - berkas ini akan ditimpa dengan DATA ASLI. JANGAN commit hasilnya ke repositori
 * Public (pre-commit hook di .githooks akan menolaknya). Untuk membatalkan: git checkout js/data/data-awal.js
 */
window.App = window.App || {};
App.seedData = { source: '', year: '', records: [] };
