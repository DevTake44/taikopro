# 商品マスタCSVの定期自動取込スクリプト
#
# 社内共有フォルダの商品マスタ.csvを、taikoproアプリの取込口(API)に送信する。
# このスクリプトは、共有フォルダ(\\192.168.64.211\マスタcsv\)に読み取りアクセスできる
# 社内PC上で、Windowsのタスクスケジューラから毎朝9:00に実行することを想定している。
#
# ── セットアップ手順 ──────────────────────────────────────────
# 1. このスクリプトを実行する社内PCに、環境変数 SCHEDULED_IMPORT_TOKEN を設定する
#    (このスクリプトの中にトークンの値を直接書かないため。システムのプロパティ→
#     環境変数、または管理者権限のPowerShellで以下を1回実行する):
#      [Environment]::SetEnvironmentVariable("SCHEDULED_IMPORT_TOKEN", "ここに実際のトークン値", "Machine")
# 2. taikoproアプリ側(Vercelなどのホスティング先)の環境変数にも、同じ値を
#    SCHEDULED_IMPORT_TOKEN として設定する。
# 3. 下の $ApiUrl を、実際にデプロイされているtaikoproアプリのURLに書き換える。
# 4. タスクスケジューラで新しいタスクを作成する:
#      - トリガー: 毎日 9:00
#      - 操作: プログラムの開始
#        プログラム/スクリプト: powershell.exe
#        引数の追加: -ExecutionPolicy Bypass -File "このファイルのフルパス"
# ──────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# ここに実際にデプロイされているtaikoproアプリのURLを設定してください。
$ApiUrl = "https://<ここにtaikoproの本番URLを入れてください>/api/scheduled-import/product-master"

$SourcePath = "\\192.168.64.211\マスタcsv\商品マスタ.csv"

$LogPath = Join-Path $PSScriptRoot "import-product-master.log"

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
    Write-Output $line
}

try {
    $Token = [Environment]::GetEnvironmentVariable("SCHEDULED_IMPORT_TOKEN", "Machine")
    if ([string]::IsNullOrEmpty($Token)) {
        throw "環境変数 SCHEDULED_IMPORT_TOKEN が設定されていません(セットアップ手順1を参照)。"
    }

    if (-not (Test-Path $SourcePath)) {
        throw "ファイルが見つかりません: $SourcePath (共有フォルダへの接続・権限を確認してください)"
    }

    Write-Log "取込開始: $SourcePath"

    $bytes = [System.IO.File]::ReadAllBytes($SourcePath)

    $response = Invoke-WebRequest -Uri $ApiUrl -Method Post `
        -Headers @{ "X-Import-Token" = $Token } `
        -ContentType "application/octet-stream" `
        -Body $bytes `
        -UseBasicParsing

    Write-Log "完了: HTTP $($response.StatusCode) / $($response.Content)"
}
catch {
    Write-Log "エラー: $($_.Exception.Message)"
    # タスクスケジューラの履歴で失敗が分かるよう、異常終了コードで終える。
    exit 1
}
