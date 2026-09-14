param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][ValidateSet('x86_64', 'aarch64')][string]$Expected
)

$resolved = (Resolve-Path -LiteralPath $Path).Path
$stream = [System.IO.File]::OpenRead($resolved)
try {
  $reader = [System.IO.BinaryReader]::new($stream)
  if ($reader.ReadUInt16() -ne 0x5A4D) { throw "$resolved is not a PE executable." }
  $stream.Position = 0x3C
  $peOffset = $reader.ReadUInt32()
  $stream.Position = $peOffset
  if ($reader.ReadUInt32() -ne 0x00004550) { throw "$resolved has an invalid PE signature." }
  $machine = $reader.ReadUInt16()
} finally {
  $stream.Dispose()
}

$expectedMachine = if ($Expected -eq 'x86_64') { 0x8664 } else { 0xAA64 }
if ($machine -ne $expectedMachine) {
  throw "$resolved has PE machine 0x$($machine.ToString('X4')); expected $Expected (0x$($expectedMachine.ToString('X4')))."
}
Write-Host "Verified $Expected executable: $resolved"
