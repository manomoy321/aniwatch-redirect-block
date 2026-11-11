Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $PSScriptRoot "icons"
if (!(Test-Path $iconsDir)) {
    New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null
}

function Generate-Icon([int]$size, [string]$filename) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Background rounded rect gradient
    $pStart = New-Object System.Drawing.Point 0, 0
    $pEnd = New-Object System.Drawing.Point $size, $size
    $c1 = [System.Drawing.Color]::FromArgb(255, 16, 185, 129)
    $c2 = [System.Drawing.Color]::FromArgb(255, 6, 182, 212)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $pStart, $pEnd, $c1, $c2

    $pathObj = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = [Math]::Max(2, [int]($size * 0.22))
    $d = $r * 2
    $pathObj.AddArc(0, 0, $d, $d, 180, 90)
    $pathObj.AddArc(($size - 1 - $d), 0, $d, $d, 270, 90)
    $pathObj.AddArc(($size - 1 - $d), ($size - 1 - $d), $d, $d, 0, 90)
    $pathObj.AddArc(0, ($size - 1 - $d), $d, $d, 90, 90)
    $pathObj.CloseFigure()

    $g.FillPath($brush, $pathObj)

    # Dark checkmark / shield emblem
    $penWidth = [Math]::Max(1.5, [float]($size * 0.1))
    $penColor = [System.Drawing.Color]::FromArgb(255, 11, 15, 25)
    $pen = New-Object System.Drawing.Pen $penColor, $penWidth
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $pt1 = New-Object System.Drawing.PointF ([float]($size * 0.26)), ([float]($size * 0.50))
    $pt2 = New-Object System.Drawing.PointF ([float]($size * 0.44)), ([float]($size * 0.68))
    $pt3 = New-Object System.Drawing.PointF ([float]($size * 0.74)), ([float]($size * 0.34))
    $points = [System.Drawing.PointF[]]@($pt1, $pt2, $pt3)
    $g.DrawLines($pen, $points)

    $outPath = Join-Path $iconsDir $filename
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Saved $outPath"
}

Generate-Icon 16 "icon16.png"
Generate-Icon 48 "icon48.png"
Generate-Icon 128 "icon128.png"
Write-Output "All icons generated successfully!"
