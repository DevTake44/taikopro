import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 顧客実績: 電話対応中に「このお客様の過去実績」をすぐ見るための検索API。
// 速度の実測が目的なので、各処理の所要時間(ms)を timings として一緒に返す。
// ?q=会社名の一部 or 顧客コード → 顧客候補の一覧
// ?code=顧客コード             → 実績サマリー(直近明細・年別売上・よく買う商品)

type Timings = Record<string, number>;

async function timed<T>(timings: Timings, key: string, p: PromiseLike<T>): Promise<T> {
  const t0 = performance.now();
  const r = await p;
  timings[key] = Math.round(performance.now() - t0);
  return r;
}

const MONTHS_FOR_SUMMARY = 24;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const code = (searchParams.get("code") ?? "").trim();
  const supabase = getSupabaseServerClient();
  const timings: Timings = {};
  const t0 = performance.now();

  try {
    if (code !== "") {
      const since = new Date();
      since.setMonth(since.getMonth() - MONTHS_FOR_SUMMARY);
      const sinceStr = since.toISOString().slice(0, 10);

      const [master, recent, summaryRows] = await Promise.all([
        timed(
          timings,
          "顧客マスタ",
          supabase.from("customer_master").select("*").eq("customer_code", code).limit(1)
        ),
        timed(
          timings,
          "直近明細50件",
          supabase
            .from("sales_lines")
            .select(
              "order_no, order_line, order_date, delivery_date, item_code, item_name, qty, sell_price, rep_code, project_name, delivery_dest_name"
            )
            .eq("customer_code", code)
            .order("order_date", { ascending: false })
            .limit(50)
        ),
        timed(
          timings,
          `過去${MONTHS_FOR_SUMMARY}ヶ月の集計用データ取得`,
          fetchAllPagesConcurrent<{
            order_date: string | null;
            item_code: string | null;
            item_name: string | null;
            qty: number | null;
            sell_price: number | null;
          }>((from, to) =>
            supabase
              .from("sales_lines")
              .select("order_date, item_code, item_name, qty, sell_price")
              .eq("customer_code", code)
              .gte("order_date", sinceStr)
              .order("id")
              .range(from, to)
          )
        ),
      ]);
      if (master.error) throw new Error(master.error.message);
      if (recent.error) throw new Error(recent.error.message);

      const byMonth = new Map<string, number>();
      const byItem = new Map<string, { item_code: string; item_name: string | null; amount: number; qty: number; count: number }>();
      for (const r of summaryRows) {
        const amount = (Number(r.qty) || 0) * (Number(r.sell_price) || 0);
        if (r.order_date) {
          const m = r.order_date.slice(0, 7);
          byMonth.set(m, (byMonth.get(m) ?? 0) + amount);
        }
        const k = r.item_code ?? "";
        const cur = byItem.get(k) ?? { item_code: k, item_name: r.item_name, amount: 0, qty: 0, count: 0 };
        cur.amount += amount;
        cur.qty += Number(r.qty) || 0;
        cur.count += 1;
        byItem.set(k, cur);
      }

      timings["合計(サーバー内)"] = Math.round(performance.now() - t0);
      return NextResponse.json({
        customer: master.data?.[0] ?? null,
        recent: recent.data ?? [],
        monthly: [...byMonth.entries()].sort().map(([month, amount]) => ({ month, amount })),
        topItems: [...byItem.values()].sort((a, b) => b.amount - a.amount).slice(0, 10),
        summaryRowCount: summaryRows.length,
        timings,
      });
    }

    if (q === "") return NextResponse.json({ candidates: [], timings });

    const safe = q.replace(/[%,()]/g, " ");
    const { data, error } = await timed(
      timings,
      "顧客検索",
      supabase
        .from("customer_master")
        .select("customer_code, customer_name, address")
        .eq("is_deleted", false)
        .or(`customer_code.eq.${safe},customer_name.ilike.%${safe}%`)
        .limit(20)
    );
    if (error) throw new Error(error.message);
    timings["合計(サーバー内)"] = Math.round(performance.now() - t0);
    return NextResponse.json({ candidates: data ?? [], timings });
  } catch (e) {
    return NextResponse.json(
      { error: "検索中にエラーが発生しました: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 }
    );
  }
}
