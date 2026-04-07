param(
  [string]$OutDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) 'build')
)

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$publicDir = Join-Path $projectRoot 'public'

Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2

  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()

  return $path
}

function New-RayPoints {
  param(
    [float]$CenterX,
    [float]$CenterY,
    [float]$InnerRadius,
    [float]$OuterRadius,
    [float]$AngleDegrees,
    [float]$SpreadDegrees
  )

  $startAngle = ($AngleDegrees - $SpreadDegrees / 2) * [Math]::PI / 180
  $midAngle = $AngleDegrees * [Math]::PI / 180
  $endAngle = ($AngleDegrees + $SpreadDegrees / 2) * [Math]::PI / 180

  return [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(
      [float]($CenterX + [Math]::Cos($startAngle) * $InnerRadius),
      [float]($CenterY + [Math]::Sin($startAngle) * $InnerRadius)
    ),
    [System.Drawing.PointF]::new(
      [float]($CenterX + [Math]::Cos($midAngle) * $OuterRadius),
      [float]($CenterY + [Math]::Sin($midAngle) * $OuterRadius)
    ),
    [System.Drawing.PointF]::new(
      [float]($CenterX + [Math]::Cos($endAngle) * $InnerRadius),
      [float]($CenterY + [Math]::Sin($endAngle) * $InnerRadius)
    )
  )
}

function New-Point {
  param(
    [float]$X,
    [float]$Y
  )

  return [System.Drawing.PointF]::new($X, $Y)
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path $publicDir | Out-Null

$baseSize = 256
$size = 512
$bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

$scale = $size / $baseSize
$graphics.ScaleTransform($scale, $scale)

$shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(56, 0, 0, 0))
$graphics.FillEllipse($shadowBrush, 34, 198, 188, 24)

$bodyPath = New-RoundedRectPath -X 18 -Y 18 -Width 220 -Height 220 -Radius 54
$bodyGradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(28, 22)),
  (New-Object System.Drawing.Point(228, 234)),
  [System.Drawing.Color]::FromArgb(255, 15, 8, 7),
  [System.Drawing.Color]::FromArgb(255, 58, 24, 14)
)
$graphics.FillPath($bodyGradient, $bodyPath)

$topGlow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 255, 191, 121))
$graphics.FillEllipse($topGlow, 30, 20, 190, 72)
$cornerGlow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 255, 122, 55))
$graphics.FillEllipse($cornerGlow, 136, 30, 82, 82)

$trailBrushDark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(228, 156, 52, 22))
$trailBrushMid = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(238, 232, 114, 42))
$trailBrushLight = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(244, 255, 202, 88))

$graphics.FillPolygon(
  $trailBrushDark,
  [System.Drawing.PointF[]]@(
    (New-Point 30 192),
    (New-Point 122 126),
    (New-Point 144 142),
    (New-Point 72 214)
  )
)
$graphics.FillPolygon(
  $trailBrushMid,
  [System.Drawing.PointF[]]@(
    (New-Point 26 154),
    (New-Point 120 94),
    (New-Point 148 112),
    (New-Point 60 180)
  )
)
$graphics.FillPolygon(
  $trailBrushLight,
  [System.Drawing.PointF[]]@(
    (New-Point 40 118),
    (New-Point 110 72),
    (New-Point 132 86),
    (New-Point 78 136)
  )
)

$rayCenterX = 156
$rayCenterY = 112
$rayInnerRadius = 64
$rayOuterRadius = 106
$raySpread = 16

for ($index = 0; $index -lt 10; $index++) {
  $angle = -96 + ($index * 36)
  $rayPoints = New-RayPoints -CenterX $rayCenterX -CenterY $rayCenterY -InnerRadius $rayInnerRadius -OuterRadius $rayOuterRadius -AngleDegrees $angle -SpreadDegrees $raySpread
  $rayColor = if ($index % 2 -eq 0) {
    [System.Drawing.Color]::FromArgb(255, 255, 208, 94)
  } else {
    [System.Drawing.Color]::FromArgb(255, 255, 121, 47)
  }
  $rayBrush = New-Object System.Drawing.SolidBrush($rayColor)
  $graphics.FillPolygon($rayBrush, $rayPoints)
  $rayBrush.Dispose()
}

$sunGlow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(72, 255, 171, 78))
$graphics.FillEllipse($sunGlow, 90, 42, 132, 132)

$ballGradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(104, 54)),
  (New-Object System.Drawing.Point(208, 170)),
  [System.Drawing.Color]::FromArgb(255, 255, 189, 83),
  [System.Drawing.Color]::FromArgb(255, 221, 86, 28)
)
$graphics.FillEllipse($ballGradient, 102, 58, 108, 108)

$ballRimPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 255, 232, 200), 6)
$graphics.DrawEllipse($ballRimPen, 105, 61, 102, 102)

$accentRingPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 255, 245, 228), 2)
$graphics.DrawEllipse($accentRingPen, 98, 54, 116, 116)

$seamPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(216, 46, 22, 18), 7)
$seamPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$seamPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawArc($seamPen, 112, 70, 88, 88, 206, 128)
$graphics.DrawArc($seamPen, 112, 70, 88, 88, 26, 128)
$graphics.DrawArc($seamPen, 122, 62, 68, 102, 108, 146)
$graphics.DrawArc($seamPen, 112, 92, 88, 62, 10, 172)

$trackPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(164, 255, 229, 195), 4)
$trackPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$trackPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawBezier($trackPen, (New-Point 64 160), (New-Point 86 144), (New-Point 108 138), (New-Point 136 140))
$graphics.DrawBezier($trackPen, (New-Point 58 128), (New-Point 86 112), (New-Point 104 108), (New-Point 128 112))

$flareBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(54, 255, 255, 255))
$graphics.FillEllipse($flareBrush, 122, 72, 34, 16)

$ballCoreBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(156, 255, 237, 214))
$graphics.FillEllipse($ballCoreBrush, 138, 98, 20, 20)

$pngPath = Join-Path $OutDir 'icon.png'
$icoPath = Join-Path $OutDir 'icon.ico'
$publicPngPath = Join-Path $publicDir 'app-icon.png'

$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
[System.IO.File]::Copy($pngPath, $publicPngPath, $true)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Flush()
$writer.Dispose()
$stream.Dispose()

$ballCoreBrush.Dispose()
$flareBrush.Dispose()
$trackPen.Dispose()
$seamPen.Dispose()
$accentRingPen.Dispose()
$ballRimPen.Dispose()
$ballGradient.Dispose()
$sunGlow.Dispose()
$trailBrushLight.Dispose()
$trailBrushMid.Dispose()
$trailBrushDark.Dispose()
$cornerGlow.Dispose()
$topGlow.Dispose()
$bodyGradient.Dispose()
$bodyPath.Dispose()
$shadowBrush.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
