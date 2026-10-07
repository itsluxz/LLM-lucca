Add-Type -AssemblyName System.Drawing
$assets = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apps/web/public/mascot'))

function Resize-Png([string]$source, [string]$destination, [int]$size) {
  $inputImage = [System.Drawing.Image]::FromFile($source)
  $outputImage = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($outputImage)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $graphics.DrawImage($inputImage, 0, 0, $size, $size)
    $outputImage.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $outputImage.Dispose()
    $inputImage.Dispose()
  }
}

Get-ChildItem -LiteralPath $assets -Filter 'mascot-*.png' | ForEach-Object {
  $temporary = Join-Path $assets ($_.BaseName + '.export.png')
  Resize-Png $_.FullName $temporary 500
  Move-Item -LiteralPath $temporary -Destination $_.FullName -Force
}
Resize-Png (Join-Path $assets 'mascot-idle.png') ([System.IO.Path]::GetFullPath((Join-Path $assets '../favicon.png'))) 64
