// 複数の画面(経営レポート・売上ダッシュボード明細・不動在庫チェック・集計明細対比)で
// 共通して使う「期選択」部品。今期・前期だけでなく、データとして存在する会計年度を
// 全て選べるようにする(2026-10-01、びっきぃの指示でDX系の画面にも展開)。

// 会計年度→表示ラベル(今期/前期/前々期/それ以前)を作る
export function fiscalYearLabel(year: number, CUR: number): string {
  if (year === CUR) return "今期";
  if (year === CUR - 1) return "前期";
  if (year === CUR - 2) return "前々期";
  return `${year}年度`;
}

export function PeriodSelect({
  years,
  trueCUR,
  selectedYear,
  onChange,
}: {
  years: number[];
  trueCUR: number;
  selectedYear: number;
  onChange: (y: number) => void;
}) {
  return (
    <div style={{ marginBottom: 14, fontSize: 12.5 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        期選択:
        <select
          value={selectedYear}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid #d7dbe2" }}
        >
          {[...years].reverse().map((y) => (
            <option key={y} value={y}>
              {fiscalYearLabel(y, trueCUR)}({y}年度)
            </option>
          ))}
        </select>
      </label>
      {selectedYear !== trueCUR && (
        <span style={{ marginLeft: 10, color: "var(--ink-faint)" }}>
          ※ {fiscalYearLabel(selectedYear, trueCUR)}({selectedYear}年度)を「今期」として表示しています
        </span>
      )}
    </div>
  );
}
