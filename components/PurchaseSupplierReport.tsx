"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { yen, jpn } from "@/lib/format";
import { fiscalYearLabel, quarterShortLabel } from "@/lib/period";
import { branchNameOnly } from "@/lib/branch-names";
import type { PurchaseSupplierMatrixRow, SupplierQuarterCell } from "@/app/api/purchase-supplier-quarter/route";
import type { PurchaseBreakdownRow } from "@/app/api/purchase-supplier-detail/route";

type SortKey = "code" | "name" | "total" | "diff";

function diffValue(row: PurchaseSupplierMatrixRow): number {
  return row.total_amount - (row.cmp?.total_amount ?? 0);
}

export default function PurchaseSupplierReport({ years }: { years: number[] }) {
  // yearsは期首の西暦年(新しい順)
  const [baseYear, setBaseYearState] = useState<number>(years[0] ?? new Date().getFullYear());
  const [compareYear, setCompareYear] = useState<number | "none">(
    years.includes(baseYear - 1) ? baseYear - 1 : "none"
  );

  // 表示年度を変える時は、対比年度(前年、無ければ対比なし)も同じイベント内で
  // 一緒に更新する。以前は別のuseEffectで後追いしていたため、表示年度だけが
  // 変わり対比年度が古い値(=新しい表示年度と同じ値になることもある)のまま
  // 一瞬問い合わせが飛び、対比が出ないことがあった。
  function setBaseYear(y: number) {
    setBaseYearState(y);
    setCompareYear(years.includes(y - 1) ? y - 1 : "none");
  }

  const [rows, setRows] = useState<PurchaseSupplierMatrixRow[]>([]);
  const [quarterEnds, setQuarterEnds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selected, setSelected] = useState<PurchaseSupplierMatrixRow | null>(null);
  const [detail, setDetail] = useState<{
    byLocation: PurchaseBreakdownRow[];
    byProduct: PurchaseBreakdownRow[];
    byCustomer: PurchaseBreakdownRow[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelected(null);
    setDetail(null);
    const params = new URLSearchParams({ year: String(baseYear) });
    if (compareYear !== "none") params.set("compareYear", String(compareYear));
    fetch(`/api/purchase-supplier-quarter?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
          setRows([]);
        } else {
          setRows(json.rows ?? []);
          setQuarterEnds(json.quarterEnds ?? []);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [baseYear, compareYear]);

  const filteredSorted = useMemo(() => {
    const ql = query.trim().toLowerCase();
    let list = rows;
    if (ql) {
      list = list.filter(
        (r) => r.supplier_code.toLowerCase().includes(ql) || r.supplier_name.toLowerCase().includes(ql)
      );
    }
    return [...list].sort((a, b) => {
      if (sortKey === "code") {
        return sortDir === "asc" ? a.supplier_code.localeCompare(b.supplier_code) : b.supplier_code.localeCompare(a.supplier_code);
      }
      if (sortKey === "name") {
        return sortDir === "asc" ? a.supplier_name.localeCompare(b.supplier_name, "ja") : b.supplier_name.localeCompare(a.supplier_name, "ja");
      }
      if (sortKey === "diff") {
        return sortDir === "asc" ? diffValue(a) - diffValue(b) : diffValue(b) - diffValue(a);
      }
      return sortDir === "asc" ? a.total_amount - b.total_amount : b.total_amount - a.total_amount;
    });
  }, [rows, query, sortKey, sortDir]);

  function onSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "name" || k === "code" ? "asc" : "desc");
    }
  }

  function selectSupplier(row: PurchaseSupplierMatrixRow) {
    setSelected(row);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    fetch(`/api/purchase-supplier-detail?supplier_code=${encodeURIComponent(row.supplier_code)}&year=${baseYear}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setDetailError(json.error);
        else setDetail(json);
      })
      .catch((e) => setDetailError(String(e)))
      .finally(() => setDetailLoading(false));
  }

  const sortArrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  const hasCompare = compareYear !== "none";

  // 列合計(フィルタ後の表示対象のみ)
  const colTotals = Array.from({ length: 4 }, () => ({ amount: 0, cmpAmount: 0 }));
  filteredSorted.forEach((r) => {
    r.quarters.forEach((c, i) => {
      colTotals[i].amount += c.amount;
      if (r.cmp) colTotals[i].cmpAmount += r.cmp.quarters[i].amount;
    });
  });
  const grandTotal = filteredSorted.reduce((a, r) => a + r.total_amount, 0);
  const grandCmpTotal = filteredSorted.reduce((a, r) => a + (r.cmp?.total_amount ?? 0), 0);

  return (
    <div className="wrap" style={{ maxWidth: 1400 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>仕入先別 仕入額 昨対比</h1>
          <p>四半期(9/20決算)ごとの仕入先別仕入額を、仕入額・昨対差額・増減率セットで確認します。</p>
        </div>
        <Link href="/management" className="ghost-btn-inline">
          ← 経営管理
        </Link>
      </header>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 12.5 }}>
            表示年度:{" "}
            <select value={baseYear} onChange={(e) => setBaseYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {fiscalYearLabel(y)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12.5 }}>
            対比年度:{" "}
            <select
              value={compareYear}
              onChange={(e) => setCompareYear(e.target.value === "none" ? "none" : Number(e.target.value))}
            >
              <option value="none">対比なし</option>
              {years.map((y) => (
                <option key={y} value={y} disabled={y === baseYear}>
                  {fiscalYearLabel(y)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12.5 }}>
            並び順:{" "}
            <select
              value={`${sortKey}_${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split("_") as [SortKey, "asc" | "desc"];
                setSortKey(k);
                setSortDir(d);
              }}
            >
              <option value="total_desc">トータル仕入額(多い順)</option>
              <option value="total_asc">トータル仕入額(少ない順)</option>
              <option value="diff_desc">昨対差額(増加が多い順)</option>
              <option value="diff_asc">昨対差額(減少が多い順)</option>
              <option value="code_asc">仕入先コード順</option>
              <option value="name_asc">仕入先名(あいうえお順)</option>
            </select>
          </label>

          <input
            type="text"
            placeholder="仕入先コード・仕入先名で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: "1 1 220px", minWidth: 180, padding: "6px 10px", fontSize: 12.5 }}
          />
          {query && (
            <button className="ghost-btn-inline" onClick={() => setQuery("")}>
              クリア
            </button>
          )}
        </div>
      </div>

      {error && <p style={{ color: "var(--direct)" }}>{error}</p>}
      {loading && <p className="cell-sub">読み込み中...</p>}

      {!loading && !error && (
        <div className="card" style={{ padding: 0, marginBottom: 16 }}>
          <div className="card-head">
            <h2>仕入先一覧</h2>
            <span className="sub">
              {filteredSorted.length.toLocaleString("ja-JP")}件 / 全{rows.length.toLocaleString("ja-JP")}件
            </span>
          </div>
          <div className="matwrap" style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <table className="mat">
              <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  <th className="codecol" rowSpan={2} onClick={() => onSort("code")}>
                    仕入先コード{sortArrow("code")}
                  </th>
                  <th className="namecol" rowSpan={2} onClick={() => onSort("name")}>
                    仕入先名{sortArrow("name")}
                  </th>
                  {quarterEnds.map((q) => (
                    <th key={q} colSpan={hasCompare ? 3 : 1} style={{ ...GROUP_BORDER, textAlign: "center" }}>
                      {quarterShortLabel(q)}
                    </th>
                  ))}
                  <th
                    className="totcol"
                    colSpan={hasCompare ? 3 : 1}
                    onClick={() => onSort("total")}
                    style={{ ...GROUP_BORDER, textAlign: "center" }}
                  >
                    トータル{sortArrow("total")}
                  </th>
                </tr>
                <tr>
                  {quarterEnds.map((q) => (
                    <SubHeaders key={q} hasCompare={hasCompare} />
                  ))}
                  <SubHeaders hasCompare={hasCompare} isTotal />
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((r) => (
                  <tr
                    key={r.supplier_code}
                    onClick={() => selectSupplier(r)}
                    style={{
                      cursor: "pointer",
                      background: selected?.supplier_code === r.supplier_code ? "#eef4ff" : undefined,
                    }}
                  >
                    <td className="codecol">{r.supplier_code}</td>
                    <td className="namecol">{r.supplier_name}</td>
                    {r.quarters.map((c, i) => (
                      <QuarterCells key={i} cell={c} cmp={r.cmp ? r.cmp.quarters[i] : null} hasCompare={hasCompare} />
                    ))}
                    <QuarterCells
                      cell={{ amount: r.total_amount, line_count: r.total_line_count }}
                      cmp={r.cmp ? { amount: r.cmp.total_amount, line_count: 0 } : null}
                      hasCompare={hasCompare}
                      isTotal
                    />
                  </tr>
                ))}
              </tbody>
              <tfoot className="mat-foot">
                <tr>
                  <td className="codecol" />
                  <td className="namecol">合計</td>
                  {colTotals.map((c, i) => (
                    <QuarterCells
                      key={i}
                      cell={{ amount: c.amount, line_count: 0 }}
                      cmp={hasCompare ? { amount: c.cmpAmount, line_count: 0 } : null}
                      hasCompare={hasCompare}
                    />
                  ))}
                  <QuarterCells
                    cell={{ amount: grandTotal, line_count: 0 }}
                    cmp={hasCompare ? { amount: grandCmpTotal, line_count: 0 } : null}
                    hasCompare={hasCompare}
                    isTotal
                  />
                </tr>
              </tfoot>
            </table>
          </div>
          <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
            行をクリックすると、その仕入先の拠点別・商品別・得意先別の内訳(表示年度ぶん)を表示します。
          </p>
        </div>
      )}

      {selected && (
        <div className="card" style={{ padding: 16 }}>
          <div className="card-head" style={{ padding: 0, marginBottom: 12 }}>
            <h2>
              {selected.supplier_name}({selected.supplier_code}) の内訳 — {fiscalYearLabel(baseYear)}
            </h2>
          </div>
          {detailLoading && <p className="cell-sub">読み込み中...</p>}
          {detailError && <p style={{ color: "var(--direct)" }}>{detailError}</p>}
          {detail && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              <BreakdownTable
                title="拠点別"
                rows={detail.byLocation}
                nameOf={(row) => branchNameOnly(row.code === "(不明)" ? null : row.code)}
              />
              <BreakdownTable title="商品別" rows={detail.byProduct} nameOf={(row) => row.name} />
              <BreakdownTable title="得意先別" rows={detail.byCustomer} nameOf={(row) => row.name} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 四半期ブロック(・トータルブロック)の境目を区切る縦線。既存の月別マトリクスの
// トータル列と同じ考え方(ブロックの先頭セルだけに左罫線を引く)を、各四半期の
// 先頭(仕入額)セルにも適用し、12列+トータルが壁のように見えないようにする。
const GROUP_BORDER: CSSProperties = { borderLeft: "2px solid var(--line)" };

function SubHeaders({ hasCompare, isTotal }: { hasCompare: boolean; isTotal?: boolean }) {
  const cls = isTotal ? "totcol" : undefined;
  if (!hasCompare) return <th className={cls} style={GROUP_BORDER}>仕入額</th>;
  return (
    <>
      <th className={cls} style={GROUP_BORDER}>
        仕入額
      </th>
      <th>昨対差額</th>
      <th>増減率</th>
    </>
  );
}

function QuarterCells({
  cell,
  cmp,
  hasCompare,
  isTotal,
}: {
  cell: SupplierQuarterCell;
  cmp: SupplierQuarterCell | null;
  hasCompare: boolean;
  isTotal?: boolean;
}) {
  const cls = isTotal ? "totcol" : undefined;
  if (!hasCompare) {
    return (
      <td className={cls} style={GROUP_BORDER}>
        {cell.amount ? yen(cell.amount) : "—"}
      </td>
    );
  }
  const cmpAmount = cmp?.amount ?? 0;
  const diff = cell.amount - cmpAmount;
  const rate = cmpAmount ? (diff / cmpAmount) * 100 : null;
  return (
    <>
      <td className={cls} style={GROUP_BORDER}>
        {cell.amount ? yen(cell.amount) : "—"}
      </td>
      <td style={{ color: diff < 0 ? "var(--direct)" : undefined }}>
        {diff === 0 ? "±0" : `${diff > 0 ? "+" : ""}${yen(diff)}`}
      </td>
      <td style={{ color: rate !== null && rate < 0 ? "var(--direct)" : undefined }}>
        {rate === null ? "—" : `${rate >= 0 ? "+" : ""}${rate.toFixed(1)}%`}
      </td>
    </>
  );
}

function BreakdownTable({
  title,
  rows,
  nameOf,
}: {
  title: string;
  rows: PurchaseBreakdownRow[];
  nameOf: (row: PurchaseBreakdownRow) => string;
}) {
  return (
    <div>
      <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>{title}</h3>
      <div className="matwrap" style={{ maxHeight: 320, overflowY: "auto" }}>
        <table className="mat">
          <thead>
            <tr>
              <th className="namecol">名称</th>
              <th>仕入額</th>
              <th>件数</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r) => (
              <tr key={r.code}>
                <td className="namecol">{nameOf(r)}</td>
                <td>{yen(r.amount)}</td>
                <td>{jpn(r.line_count)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="cell-sub">
                  データがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && <p className="cell-sub" style={{ marginTop: 4 }}>上位50件を表示(全{rows.length}件)</p>}
    </div>
  );
}
