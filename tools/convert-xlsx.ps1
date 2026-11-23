# PERHATIAN PRIVASI: hasil skrip ini (js/data/data-awal.js) berisi DATA ASLI. Di repositori, berkas itu hanya
# boleh berupa template KOSONG. Jangan commit hasil konversi ke repositori Public (pre-commit hook menolaknya);
# untuk mengembalikan template kosong: git checkout js/data/data-awal.js
# Konversi Internet.xlsx -> js/data/data-awal.js (data awal yang dimuat otomatis oleh web).
# Pakai:  powershell -ExecutionPolicy Bypass -File tools\convert-xlsx.ps1 [-Year 2026]
# Ulangi perintah ini setiap kali Internet.xlsx diperbarui, lalu hapus data di web (lihat README) agar terisi ulang.
# Tujuan: membaca sheet1 Internet.xlsx (tanpa Excel/modul tambahan; xlsx = zip berisi XML) lalu menulis js\data\data-awal.js.
# Parameter -Year = tahun untuk kunci payments (kolom L..R diisi ke tahun ini).
# Keamanan: skrip hanya membaca xlsx dan menulis satu file js\data\data-awal.js; folder sementara di %TEMP% dihapus di akhir.
# ExecutionPolicy: -ExecutionPolicy Bypass hanya berlaku untuk proses ini; kebijakan sistem tidak diubah.
# Pemetaan kolom Excel (sheet1, data mulai baris 4):
#   A = kodeInduk, B = po ("-" dianggap kosong), C = namaGerai (wajib), D = alamat,
#   E = akhirSewa (tanggal serial Excel), G = status (Inactive/selain itu Active),
#   H = idPelanggan, I = vendor (lewat alias), J = remark (Existing/Takeout + catatan),
#   K = catatan tambahan, L..R = pembayaran Juni..Desember. Kolom F tidak dipakai.
# TROUBLESHOOT: hasil kosong/semua dilewati = cek baris >= 4, kolom C terisi, dan kolom I cocok dengan alias vendor; lihat daftar "Dilewati".
# TROUBLESHOOT: skrip diblokir = jalankan dengan perintah Bypass di atas atau Unblock-File pada skrip ini.
# TROUBLESHOOT: galat "file tidak ditemukan"/gagal ekstrak = Internet.xlsx harus ada di folder data\ (data\Internet.xlsx), dan tutup dulu di Excel.
param([string]$Year = '2026')

# Hentikan di galat pertama agar tidak menulis data-awal.js yang setengah jadi.
$ErrorActionPreference = 'Stop'
# Jalur: root proyek (induk folder tools), xlsx sumber, js keluaran, folder ekstrak sementara bernama acak.
$root = Split-Path $PSScriptRoot -Parent
$xlsx = Join-Path $root 'data\Internet.xlsx'
$out  = Join-Path $root 'js\data\data-awal.js'
$tmp  = Join-Path $env:TEMP ('xlsx_' + [guid]::NewGuid().ToString('N'))

# Langkah 1: ekstrak xlsx (zip) ke folder sementara.
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($xlsx, $tmp)
try {
  # Langkah 2: muat tabel string bersama (teks sel bertipe t="s" merujuk indeks di sini) dan XML sheet1.
  [xml]$ss = Get-Content (Join-Path $tmp 'xl\sharedStrings.xml') -Raw -Encoding UTF8
  $strs = @(foreach ($si in $ss.sst.si) { $si.InnerText })
  [xml]$sh = Get-Content (Join-Path $tmp 'xl\worksheets\sheet1.xml') -Raw -Encoding UTF8

  # Alias vendor (kunci huruf kecil dari kolom I) -> nama baku; termasuk salah eja "fiberstar" -> Fiberstart.
  # Vendor yang tak ada di sini membuat baris dilewati.
  $vendorMap = @{ 'satu akses indonesia' = 'Satu ID'; 'satu id' = 'Satu ID'; 'astinet' = 'Astinet'; 'hsi' = 'HSI'; 'ats' = 'ATS'; 'moratel' = 'Moratel'; 'hsp' = 'HSP'; 'fiberstar' = 'Fiberstart'; 'fiberstart' = 'Fiberstart' }
  # records = baris valid; skipped = alasan baris dilewati (ditampilkan di akhir); seen = deteksi duplikat.
  $records = New-Object System.Collections.ArrayList
  $skipped = New-Object System.Collections.ArrayList
  $seen = @{}

  # Langkah 3: telusuri tiap baris sheet; $c = peta huruf kolom -> nilai teks sel.
  foreach ($r in $sh.worksheet.sheetData.row) {
    if ([int]$r.r -lt 4) { continue }   # baris 1-3 = judul/total/header
    $c = @{}
    foreach ($cell in $r.c) {
      $col = $cell.r -replace '\d', ''
      $v = $cell.v
      if ($cell.t -eq 's') { $v = $strs[[int]$v] }
      if ($null -ne $v) { $c[$col] = ([string]$v).Trim() }
    }
    # Lewati baris yang seluruh selnya kosong.
    if (-not ($c.Values | Where-Object { $_ -ne '' })) { continue }

    # Validasi: nama gerai (C) wajib, vendor (I) harus dikenal alias.
    $vendor = $vendorMap[("" + $c['I']).ToLower()]
    if (-not $c['C']) { [void]$skipped.Add("Baris $($r.r): nama gerai kosong"); continue }
    if (-not $vendor) { [void]$skipped.Add("Baris $($r.r): vendor kosong/tidak dikenal ($($c['C']))"); continue }

    # Duplikat = kombinasi vendor + ID pelanggan (H) + nama gerai; hanya dicek bila ID pelanggan terisi.
    $key = ("$vendor|$($c['H'])|$($c['C'])").ToLower()
    if ($c['H'] -and $seen.ContainsKey($key)) { [void]$skipped.Add("Baris $($r.r): duplikat ($($c['C']))"); continue }
    $seen[$key] = $true

    # Kolom E: tanggal serial Excel (5 digit, mis. 46000) -> yyyy-MM-dd; epoch Excel = 1899-12-30. Selain itu dikosongkan.
    $akhir = ''
    if ($c['E'] -match '^\d{5}(\.\d+)?$') { $akhir = ([datetime]'1899-12-30').AddDays([math]::Floor([double]$c['E'])).ToString('yyyy-MM-dd') }

    # Kolom J: diawali "existing"/"takeout" -> jadi remark (Title Case), sisa teks jadi catatan; selain itu remark bawaan Existing. Kolom K digabung di depan catatan.
    $remark = 'Existing'; $catatan = ''
    if ($c['J'] -match '^(?i)(existing|takeout)\b[\s:,-]*(.*)$') {
      $remark = (Get-Culture).TextInfo.ToTitleCase($Matches[1].ToLower()); $catatan = $Matches[2].Trim()
    }
    if ($c['K']) { $catatan = (@($c['K'], $catatan) | Where-Object { $_ }) -join ' - ' }

    # Status (G): hanya "inactive" yang jadi Inactive. PO (B): strip/dash saja dianggap kosong.
    $status = if ($c['G'] -match '(?i)^inactive$') { 'Inactive' } else { 'Active' }
    $po = if ($c['B'] -match '^[-–—]+$') { '' } else { "" + $c['B'] }

    # Kolom L..R = JUNE..DECEMBER (indeks bulan 5..11)
    $pays = [object[]]::new(12)   # (New-Object membungkus array sehingga JSON-nya rusak di PowerShell 5.1)
    $letters = 'L', 'M', 'N', 'O', 'P', 'Q', 'R'
    for ($i = 0; $i -lt 7; $i++) {
      $raw = $c[$letters[$i]]
      if ($raw -match '^\d+(\.\d+)?$') { $pays[5 + $i] = [double]$raw }
    }

    # Susun rekaman; nama properti harus cocok dengan yang dibaca js (data-awal -> app).
    [void]$records.Add([ordered]@{
      kodeInduk = "" + $c['A']; po = $po; namaGerai = $c['C']; alamat = "" + $c['D']
      akhirSewa = $akhir; status = $status; idPelanggan = "" + $c['H']; vendor = $vendor
      remark = $remark; catatan = $catatan; payments = @{ $Year = $pays }
    })
  }

  # Langkah 4: serialisasi ke JSON lalu bungkus sebagai js (App.seedData) dan tulis UTF-8 tanpa BOM.
  $json = ConvertTo-Json -InputObject @($records) -Depth 6 -Compress
  $js = "/* DIHASILKAN OTOMATIS oleh tools/convert-xlsx.ps1 dari Internet.xlsx - jangan diedit manual. */`r`nwindow.App = window.App || {};`r`nApp.seedData = { source: 'Internet.xlsx', year: '$Year', records: $json };`r`n"
  [IO.File]::WriteAllText($out, $js, (New-Object Text.UTF8Encoding($false)))

  # Ringkasan: jumlah baris tertulis dan daftar baris yang dilewati beserta alasannya.
  Write-Host "Selesai: $($records.Count) baris -> js\data\data-awal.js" -ForegroundColor Green
  Write-Host "PERINGATAN: berkas itu sekarang berisi DATA ASLI. Jangan di-commit ke repositori Public." -ForegroundColor Yellow
  if ($skipped.Count) { Write-Host "Dilewati ($($skipped.Count)):" -ForegroundColor Yellow; $skipped | ForEach-Object { Write-Host "  $_" } }
  # Bersihkan folder ekstrak sementara, berhasil maupun gagal.
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
