# Server statis sederhana untuk menjalankan website secara lokal (tanpa instalasi tambahan).
# Pakai: powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 5500]
# Tujuan: menyajikan folder proyek lewat http://localhost:<Port>/ (sebagian fitur browser tidak jalan dari file://).
# Keamanan: hanya mendengarkan localhost (tidak terbuka ke jaringan) dan hanya melayani file di dalam folder proyek.
# ExecutionPolicy: -ExecutionPolicy Bypass hanya berlaku untuk proses ini; kebijakan sistem tidak diubah.
# TROUBLESHOOT: "Gagal memulai server" = port sedang dipakai; jalankan dengan -Port lain (mis. -Port 5600).
# TROUBLESHOOT: skrip diblokir/"running scripts is disabled" = pakai perintah Bypass di atas, atau Unblock-File serve.ps1.
# TROUBLESHOOT: halaman 404/kosong = pastikan skrip ada di folder induk yang berisi index.html (root = folder skrip).
param([int]$Port = 5500, [switch]$NoBrowser)   # -NoBrowser: jangan buka browser otomatis (dipakai tes otomatis)

# Folder akar situs = folder tempat skrip ini berada.
$root = $PSScriptRoot
# Tabel Content-Type per ekstensi; ekstensi lain dikirim sebagai application/octet-stream.
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js' = 'application/javascript; charset=utf-8'; '.json' = 'application/json'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}

# Langkah 1: siapkan HttpListener pada localhost:<Port>; gagal start (port dipakai) -> pesan galat lalu keluar.
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() }
catch { Write-Host "Gagal memulai server di port $Port : $($_.Exception.Message)" -ForegroundColor Red; exit 1 }

# Langkah 2: umumkan alamat dan buka browser bawaan secara otomatis.
$url = "http://localhost:$Port/"
Write-Host "Server berjalan di $url  (tekan Ctrl+C untuk berhenti)" -ForegroundColor Green
if (-not $NoBrowser) { Start-Process $url }

# Langkah 3: loop permintaan (satu per satu). Path URL -> path file; "/" dipetakan ke index.html.
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
    # Alamat folder (mis. /tests/) membuka index.html di folder itu.
    if ((Test-Path $file -PathType Container)) { $file = Join-Path $file 'index.html' }
    # Cegah akses di luar folder proyek (pemisah folder ditambahkan agar "ISP-lain" tidak lolos pencocokan awalan)
    if ($file.StartsWith($root + [IO.Path]::DirectorySeparatorChar) -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $type = $mime[[IO.Path]::GetExtension($file).ToLower()]
      $ctx.Response.ContentType = if ($type) { $type } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')   # selalu ambil file terbaru saat pengembangan
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      # File tidak ada atau di luar folder proyek -> 404.
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  }
# Selalu hentikan listener saat loop berakhir/Ctrl+C agar port dilepas.
} finally { $listener.Stop() }
