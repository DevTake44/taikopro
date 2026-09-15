"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StockDetailData, StockSupplierRow, StockProductRow } from "@/lib/buildStockDetail";
import type { StockMovementData, StockMovementItem } from "@/lib/buildStockMovement";
import { yen, jpn, monL } from "@/lib/format";
import TrendChart from "./TrendChart";

// 「不動在庫チェック」画面(社内DX)。sales-dashboardの旧ダッシュボードの「在庫」タブを
// そのまま独立したページに移設したもの(ロジックは変更していない)。
export default function StockCheckClient({
  stockDetail,
  stockMovement,
  stockMovementError,
}: {
  stockDetail: StockDetailData;
  stockMovement: StockMovementData | null;
  stockMovementError: string | null;
}) {
  const sd = stockDetail;
  const up = sd.yoy_pct_same != null && sd.yoy_pct_same > 0;
  const chartConfig = useMemo(() => buildStockDetailConfig(sd), [sd]);
  const [topN, setTopN] = useState<15 | 30 | 50>(30);
  const [sortMode, setSortMode] = useState<"amount" | "yoy_up" | "yoy_down">("amount");

  const sortRows = <T extends { cur: number; diff: number }>(rows: T[]): T[] => {
    const arr = [...rows];
    if (sortMode === "yoy_up") arr.sort((a, b) => b.diff - a.diff);
    else if (sortMode === "yoy_down") arr.sort((a, b) => a.diff - b.diff);
    else arr.sort((a, b) => b.cur - a.cur);
    return arr;
  };
  const sortedSuppliers = useMemo(() => sortRows(sd.suppliers), [sd.suppliers, sortMode]);
  const sortedProducts = useMemo(() => sortRows(sd.products), [sd.products, sortMode]);
  const sortModeLabel = sortMode === "amount" ? "仕入額順" : sortMode === "yoy_up" ? "昨対比 増加順" : "昨対比 減少順";

  const monthlyRows = sd.monthly.map((m) => ({ ...m, diff: m.cur - m.prev }));

  return (
    <div className="wrap">
      <header className="top">
        <div className="title">
          <h1>不動在庫チェック</h1>
          <p>在庫仕入(拠点90・91)の内訳と、出荷実績との突き合わせによる不動在庫候補の一覧です。</p>
        </div>
        <div className="maintabs">
          <Link href="/dx" className="ghost-btn-inline" style={{ padding: "8px 18px" }}>
            ← 社内DXメニュー
          </Link>
        </div>
      </header>

      <div className="page active">
        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          <KpiCard
            label="今期 在庫仕入(累計)"
            value={yen(sd.cur_total)}
            foot={`${sd.n_cur_months}ヶ月ぶん・拠点90/91`}
            primary
          />
          <KpiCard label="前期 同期間" value={yen(sd.prev_same)} foot={`前期の同じ${sd.n_cur_months}ヶ月`} />
          <KpiCard
            label="昨対(在庫仕入)"
            value={sd.yoy_pct_same != null ? `${sd.yoy_pct_same >= 0 ? "+" : ""}${sd.yoy_pct_same}%` : "―"}
            foot={up ? "前期より増加(要注意)" : "前期より圧縮"}
            status={up ? "miss" : "hit"}
            badge={up ? "△ 増えています" : "✓ 減っています"}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h2>月別推移(今期 vs 前期)</h2>
          </div>
          <div className="legend">
            <span><i className="dot" style={{ background: "#e08a1e" }} />今期 在庫仕入</span>
            <span><i className="dot" style={{ background: "#9aa3b2" }} />前期 在庫仕入</span>
          </div>
          <div className="chart-box">
            <TrendChart config={chartConfig} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>月別の内訳</h2>
          </div>
          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th className="namecol">月度</th>
                  <th>前期</th>
                  <th>今期</th>
                  <th>増減</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((m) => {
                  const hasAny = m.cur !== 0 || m.prev !== 0;
                  return (
                    <tr key={m.ym}>
                      <td className="namecol">{monL(m.ym)}</td>
                      <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{yen(m.prev)}</span></td>
                      <td><span className="cell-s">{yen(m.cur)}</span></td>
                      <td>
                        {hasAny ? (
                          <span className={`cell-s ${m.diff >= 0 ? "val-neg" : "val-pos"}`}>
                            {m.diff >= 0 ? "+" : ""}{yen(m.diff)}
                          </span>
                        ) : (
                          <span className="cell-s" style={{ color: "#c8ccd4" }}>―</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="mat-foot">
                <tr>
                  <td className="namecol">合計</td>
                  <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{yen(sd.prev_total)}</span></td>
                  <td><span className="cell-s">{yen(sd.cur_total)}</span></td>
                  <td>
                    <span className={`cell-s ${sd.diff_same >= 0 ? "val-neg" : "val-pos"}`}>
                      {sd.diff_same >= 0 ? "+" : ""}{yen(sd.diff_same)}(前期同期間比)
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
            「前期」列は参考として全月表示していますが、表の一番下の増減(前期同期間比)は、今期データがある月度分だけで比較しています。
          </p>
        </div>

        <div className="tabs" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "var(--ink-faint)", marginRight: 8, alignSelf: "center" }}>
            表示件数:
          </span>
          {[15, 30, 50].map((n) => (
            <button key={n} className={topN === n ? "active" : ""} onClick={() => setTopN(n as 15 | 30 | 50)}>
              {n}件
            </button>
          ))}
        </div>
        <div className="tabs" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "var(--ink-faint)", marginRight: 8, alignSelf: "center" }}>
            並び順:
          </span>
          <button className={sortMode === "amount" ? "active" : ""} onClick={() => setSortMode("amount")}>
            仕入額順
          </button>
          <button className={sortMode === "yoy_up" ? "active" : ""} onClick={() => setSortMode("yoy_up")}>
            昨対比 増加順
          </button>
          <button className={sortMode === "yoy_down" ? "active" : ""} onClick={() => setSortMode("yoy_down")}>
            昨対比 減少順
          </button>
        </div>
        <SupplierTable title={`仕入先別 内訳(今期・${sortModeLabel}・上位${Math.min(topN, sortedSuppliers.length)}件)`} rows={sortedSuppliers.slice(0, topN)} />
        <ProductTable title={`商品別 内訳(今期・${sortModeLabel}・上位${Math.min(topN, sortedProducts.length)}件)`} rows={sortedProducts.slice(0, topN)} />

        <h2 className="blk">不動在庫チェック(出荷実績との突合)</h2>
        <StockMovementSection stockMovement={stockMovement} stockMovementError={stockMovementError} />

        <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "0 20px 16px" }}>
          このページの「今期の在庫仕入額」は今期・前期の比較を表示しています。「不動在庫チェック」は、仕入と出荷実績を商品ごとに突き合わせて、現在も残っていると推定される在庫と、その在庫期間を計算しています。在庫商品ごとの詳しい売上推移(伸びている/落ちている等)は、今後の課題として残っています。
        </p>
      </div>
    </div>
  );
}

function StockMovementSection({
  stockMovement,
  stockMovementError,
}: {
  stockMovement: StockMovementData | null;
  stockMovementError: string | null;
}) {
  if (stockMovementError) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>不動在庫チェック</h2>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", padding: "0 20px 20px", lineHeight: 1.8 }}>
          データの取得に失敗したため、この機能はまだ利用できません。
          <br />
          (詳細: {stockMovementError})
        </p>
      </div>
    );
  }

  if (!stockMovement) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>不動在庫チェック</h2>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", padding: "0 20px 20px" }}>データがありません。</p>
      </div>
    );
  }

  const sm = stockMovement;
  const deadItems = sm.items.filter((i) => i.isDead);
  const showItems = deadItems.slice(0, 50);

  return (
    <>
      {sm.dataStartDate && (
        <div className="card" style={{ background: "#fff8ec", border: "1px solid #f0ddb8" }}>
          <p style={{ fontSize: 13, color: "#7a5c1e", padding: "14px 20px", lineHeight: 1.9, margin: 0 }}>
            この推定在庫金額は、出荷実績のデータが存在する{sm.dataStartDate}以降の仕入だけを対象に計算しています。
            <br />
            それより前に仕入れた分は、出荷実績と突き合わせる方法が無いため、この推定には含めていません(参考額:
            {" "}
            <b>{yen(sm.excludedPreRangeAmount)}</b>)。実際にはその多くが既に出荷済みと考えられます。
          </p>
        </div>
      )}

      {sm.turnoverMonthsActive != null && (
        <div className="card" style={{ background: "#eef4ff", border: "1px solid #cddcf7" }}>
          <p style={{ fontSize: 14, color: "#1d3f77", padding: "14px 20px", lineHeight: 1.9, margin: 0, fontWeight: 600 }}>
            今動いている在庫(流動在庫 {yen(sm.activeAmount)})は、直近の出荷ペースだと
            およそ<span style={{ fontSize: 17 }}>{sm.turnoverMonthsActive}ヶ月分</span>に相当します。
            <span style={{ fontWeight: 400, fontSize: 12, color: "#4d6da8" }}>
              (商品コードの有無などによる誤差はありますが、大まかな目安としてご覧ください)
            </span>
          </p>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <KpiCard
          label="推定在庫金額(全体)"
          value={yen(sm.totalAmountOnHand)}
          foot={`仕入から出荷分を引いた推定値・基準日 ${sm.asOf}`}
          primary
        />
        <KpiCard
          label="うち不動在庫候補"
          value={yen(sm.deadAmount)}
          foot={`最終出荷から${sm.deadThresholdDays}日以上動きなし・${sm.deadCount}商品`}
          status={sm.deadCount > 0 ? "miss" : "hit"}
          badge={sm.deadCount > 0 ? `${sm.deadCount}商品` : "✓ 該当なし"}
        />
        <KpiCard
          label="うち流動在庫(動いている在庫)"
          value={yen(sm.activeAmount)}
          foot="全体から不動在庫候補を除いた金額"
        />
        <KpiCard
          label="流動在庫の在庫回転月数"
          value={sm.turnoverMonthsActive != null ? `${sm.turnoverMonthsActive}ヶ月分` : "―"}
          foot={
            sm.avgMonthlyShipmentCostAmount != null
              ? `月平均の出荷額(原価換算) ${yen(sm.avgMonthlyShipmentCostAmount)} で割った値`
              : "出荷データが不足しているため計算できません"
          }
        />
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: 12 }}>
        <KpiCard label="在庫のある商品数" value={`${sm.totalItemsWithStock}商品`} foot={`基準日 ${sm.asOf}`} />
        <KpiCard
          label="不動在庫の割合"
          value={sm.totalItemsWithStock ? `${Math.round((sm.deadCount / sm.totalItemsWithStock) * 1000) / 10}%` : "―"}
          foot="在庫のある商品数に対する割合(金額ベースではなく件数ベース)"
        />
        <KpiCard
          label="在庫金額(全体)の在庫回転月数"
          value={sm.turnoverMonthsAll != null ? `${sm.turnoverMonthsAll}ヶ月分` : "―"}
          foot="不動在庫を含めた全体を月平均出荷額(原価換算)で割った値(参考)"
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>不動在庫候補 一覧(金額の多い順・上位{Math.min(50, deadItems.length)}件)</h2>
        </div>
        <div className="matwrap">
          <table className="mat">
            <thead>
              <tr>
                <th className="namecol">商品名</th>
                <th>在庫数量(推定)</th>
                <th>在庫金額(推定)</th>
                <th>最古の仕入日</th>
                <th>在庫期間</th>
                <th>最終出荷日</th>
                <th>最終出荷からの経過</th>
              </tr>
            </thead>
            <tbody>
              {showItems.length === 0 ? (
                <tr>
                  <td className="namecol" colSpan={7} style={{ color: "var(--ink-faint)" }}>
                    不動在庫候補はありませんでした。
                  </td>
                </tr>
              ) : (
                showItems.map((i) => <StockMovementRow key={i.key} item={i} />)
              )}
            </tbody>
          </table>
        </div>
        {deadItems.length > 50 && (
          <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
            不動在庫候補は他に{deadItems.length - 50}件あります(表示は金額上位50件のみ)。
          </p>
        )}
      </div>

      {sm.unmatchedShipmentQty > 0 && (
        <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "0 20px 16px" }}>
          参考: 手元の仕入データより前に仕入れたと思われ、対応する仕入ロットが見つからなかった出荷数量が
          約{jpn(sm.unmatchedShipmentQty)}個分あります(在庫期間の計算には含まれていません)。
        </p>
      )}
    </>
  );
}

function StockMovementRow({ item }: { item: StockMovementItem }) {
  return (
    <tr>
      <td className="namecol">{item.name}</td>
      <td><span className="cell-s">{jpn(item.qtyOnHand)}</span></td>
      <td><span className="cell-s">{yen(item.amountOnHand)}</span></td>
      <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{item.oldestLotDate}</span></td>
      <td><span className="cell-s val-neg">{jpn(item.ageDays)}日</span></td>
      <td>
        <span className="cell-s" style={{ color: "#9aa3b2" }}>
          {item.lastShipmentDate ?? "出荷実績なし"}
        </span>
      </td>
      <td>
        <span className="cell-s val-neg">
          {item.daysSinceShipment != null ? `${jpn(item.daysSinceShipment)}日` : "―"}
        </span>
      </td>
    </tr>
  );
}

function SupplierTable({ title, rows }: { title: string; rows: StockSupplierRow[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
      </div>
      <div className="matwrap">
        <table className="mat">
          <thead>
            <tr>
              <th className="namecol">仕入先名</th>
              <th>前期</th>
              <th>今期</th>
              <th>増減</th>
              <th className="namecol">一番多い商品</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="namecol" colSpan={5} style={{ color: "var(--ink-faint)" }}>
                  データがありません。
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isOpen = openKey === r.key;
                const mainRow = (
                  <tr
                    key={r.key}
                    onClick={() => setOpenKey(isOpen ? null : r.key)}
                    style={{ cursor: "pointer", background: isOpen ? "#f5f7fb" : undefined }}
                    title="クリックでこの仕入先の商品一覧を表示"
                  >
                    <td className="namecol">
                      <span style={{ color: "#2563d9" }}>{isOpen ? "▾ " : "▸ "}</span>
                      {r.name}
                    </td>
                    <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{yen(r.prev)}</span></td>
                    <td><span className="cell-s">{yen(r.cur)}</span></td>
                    <td>
                      <span className={`cell-s ${r.diff >= 0 ? "val-neg" : "val-pos"}`}>
                        {r.diff >= 0 ? "+" : ""}{yen(r.diff)}
                      </span>
                    </td>
                    <td className="namecol">{r.topProductName ?? "―"}</td>
                  </tr>
                );
                if (!isOpen) return mainRow;
                const detailRow = (
                  <tr key={`${r.key}-detail`}>
                    <td colSpan={5} style={{ padding: 0, background: "#fafbfc" }}>
                      <div style={{ padding: "10px 20px 16px 40px" }}>
                        <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 6 }}>
                          {r.name} の商品一覧(今期金額の多い順・{r.products.length}件)
                        </div>
                        <table className="mat" style={{ width: "100%" }}>
                          <thead>
                            <tr>
                              <th className="namecol">商品名</th>
                              <th>前期</th>
                              <th>今期</th>
                              <th>増減</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.products.map((p) => (
                              <tr key={p.key}>
                                <td className="namecol">{p.name}</td>
                                <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{yen(p.prev)}</span></td>
                                <td><span className="cell-s">{yen(p.cur)}</span></td>
                                <td>
                                  <span className={`cell-s ${p.diff >= 0 ? "val-neg" : "val-pos"}`}>
                                    {p.diff >= 0 ? "+" : ""}{yen(p.diff)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                );
                return [mainRow, detailRow];
              })
            )}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
        仕入先名をクリックすると、その仕入先から仕入れている商品の一覧を表示します。
      </p>
    </div>
  );
}

function ProductTable({ title, rows }: { title: string; rows: StockProductRow[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
      </div>
      <div className="matwrap">
        <table className="mat">
          <thead>
            <tr>
              <th className="namecol">商品名</th>
              <th>前期</th>
              <th>今期</th>
              <th>増減</th>
              <th className="namecol">主な仕入先</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="namecol" colSpan={5} style={{ color: "var(--ink-faint)" }}>
                  データがありません。
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key}>
                  <td className="namecol">{r.name}</td>
                  <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{yen(r.prev)}</span></td>
                  <td><span className="cell-s">{yen(r.cur)}</span></td>
                  <td>
                    <span className={`cell-s ${r.diff >= 0 ? "val-neg" : "val-pos"}`}>
                      {r.diff >= 0 ? "+" : ""}{yen(r.diff)}
                    </span>
                  </td>
                  <td className="namecol">{r.topSupplierName ?? "―"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  foot,
  primary,
  status,
  badge,
}: {
  label: string;
  value: string;
  foot: string;
  primary?: boolean;
  status?: "hit" | "miss";
  badge?: string;
}) {
  return (
    <div className={`kpi ${primary ? "primary" : ""} ${status ?? ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {badge && <div className={`badge ${status === "hit" ? "b-hit" : "b-miss"}`}>{badge}</div>}
      <div className="foot">{foot}</div>
    </div>
  );
}

function buildStockDetailConfig(sd: StockDetailData) {
  return {
    type: "bar" as const,
    data: {
      labels: sd.cur_months.map(monL),
      datasets: [
        { type: "bar" as const, label: "今期 在庫仕入", data: sd.monthly.map((m) => m.cur), backgroundColor: "#e6a23c", borderRadius: 5, barPercentage: 0.7, categoryPercentage: 0.75, order: 2 },
        { type: "line" as const, label: "前期 在庫仕入", data: sd.monthly.map((m) => m.prev), borderColor: "#9aa3b2", borderDash: [5, 4], borderWidth: 2, tension: 0.3, pointRadius: 0, order: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c: { dataset: { label?: string }; raw: unknown }) =>
              `${c.dataset.label}: ${c.raw == null ? "―" : yen(c.raw as number)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#9aa3b2", font: { size: 11 } } },
        y: {
          grid: { color: "#eef1f5" },
          ticks: {
            color: "#9aa3b2",
            font: { size: 11 },
            callback: (value: number | string) => {
              const v = typeof value === "string" ? parseFloat(value) : value;
              return "¥" + (v / 1e6).toFixed(0) + "M";
            },
          },
        },
      },
    },
  };
}
