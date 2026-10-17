# ==========================================
# GC TECH DEMO — SERVIDOR LOCAL
# Serve a pasta do protótipo em http://localhost:8080 (sem internet, sem instalar nada).
# Abrindo pelo servidor, as janelas do navegador se avisam quando os dados mudam
# (portal <-> RCM, chat, Agent Requests), o que não acontece abrindo os arquivos direto do disco.
#
# Uso: duplo clique em "Start GC Tech Demo.bat" (na pasta do projeto).
# Deixe esta janela aberta durante a demo. Para parar: feche a janela ou Ctrl+C.
# ==========================================

param([switch]$NoBrowser)   # -NoBrowser: só liga o servidor (usado em testes)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';  '.js'  = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'; '.csv' = 'text/csv; charset=utf-8'
  '.png'  = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'
  '.svg'  = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.webp' = 'image/webp'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'; '.pdf' = 'application/pdf'
}

# Porta fixa (os dados da demo ficam guardados por endereço). Se a 8080 estiver ocupada, tenta as próximas.
$listener = $null
$port = $null
foreach ($p in 8080..8090) {
  $candidate = New-Object System.Net.HttpListener
  $candidate.Prefixes.Add("http://localhost:$p/")
  try { $candidate.Start(); $listener = $candidate; $port = $p; break }
  catch { $candidate.Close() }
}
if (-not $listener) {
  Write-Host 'Could not start the demo server: ports 8080-8090 are all in use.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

$url = "http://localhost:$port/"
$Host.UI.RawUI.WindowTitle = "GC Tech Demo - $url"
Write-Host ''
Write-Host '  GC TECH DEMO SERVER' -ForegroundColor DarkYellow
Write-Host "  Running at $url" -ForegroundColor Green
if ($port -ne 8080) { Write-Host '  Note: port 8080 was busy, so demo data saved on 8080 is not visible here.' -ForegroundColor Yellow }
Write-Host '  Keep this window open during the presentation. Close it to stop.' -ForegroundColor Gray
Write-Host ''

# Abre no Chrome (se não estiver instalado, usa o navegador padrão)
if (-not $NoBrowser) {
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($chrome) { Start-Process $chrome $url } else { Start-Process $url }
}

function Send-Bytes($ctx, [int]$status, [byte[]]$bytes, [string]$type) {
  $res = $ctx.Response
  $res.StatusCode = $status
  $res.ContentType = $type
  $res.Headers['Cache-Control'] = 'no-store'   # sempre a versão mais nova dos arquivos
  $res.ContentLength64 = $bytes.Length
  if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  $res.OutputStream.Close()
}

try {
  while ($listener.IsListening) {
    # Espera assíncrona em fatias curtas para o Ctrl+C funcionar
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(300)) { }
    $ctx = $task.GetAwaiter().GetResult()
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($path -eq '' -or $path.EndsWith('/')) { $path += 'index.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $root $path))

      # Só arquivos dentro da pasta do projeto
      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Bytes $ctx 404 ([Text.Encoding]::UTF8.GetBytes("Not found: /$path")) 'text/plain; charset=utf-8'
        continue
      }
      $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
      $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      Send-Bytes $ctx 200 ([IO.File]::ReadAllBytes($full)) $type
    }
    catch {
      # Navegador cancelou o pedido (troca de página rápida): ignora
      try { $ctx.Response.Abort() } catch { }
    }
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
