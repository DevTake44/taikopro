// 「SMAPS登録 全商品」Excel(営業が管理しているイオン品番の一覧)を、smaps_aeon_itemsの行に変換する。
// 見出し行(「イオン品番」を含む行)を探し、見出し名で列を決める(列の並びが多少変わっても読める)。
// - イオン品番が空の行は、直前のセット商品の構成部材(305-1 など)として components にまとめる
// - 同じイオン品番が複数行ある場合(752・12729 のセット商品)は1件にまとめ、2行目以降は構成部材にする
// - 新販売価格の欄に「廃番」「ダブリ抹消(…)」などの文字が入っている行は status に入れる

export type AeonItemRow = {
  aeon_code: string;
  list_no: string | null;
  name: string | null;
  new_price: number | null;
  current_price: number | null;
  status: string | null;
  new_cost: number | null;
  supplier: string | null;
  model: string | null;
  maker_code: string | null;
  size: string | null;
  color: string | null;
  note: string | null;
  components: string | null;
};

type Cell = string | number | boolean | null | undefined;

function text(v: Cell): string | null {
  if (v == null) return null;
  const s = String(v).replace(/　/g, " ").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

function num(v: Cell): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = text(v);
  if (!s) return null;
  const n = Number(s.replace(/[,，¥￥円]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function codeText(v: Cell): string | null {
  if (typeof v === "number") return String(Math.round(v));
  return text(v)?.normalize("NFKC").replace(/\s/g, "") ?? null;
}

export function parseAeonItemSheet(rows: Cell[][]): { items: AeonItemRow[]; skipped: number } {
  const headerIdx = rows.findIndex((r) => r.some((c) => text(c) === "イオン品番"));
  if (headerIdx < 0) throw new Error("「イオン品番」の見出しが見つかりません。SMAPS登録 全商品のExcelか確認してください。");
  const header = rows[headerIdx].map((c) => (text(c) ?? "").normalize("NFKC").replace(/\s/g, ""));
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
  const C = {
    listNo: col("通番"),
    aeon: col("イオン品番"),
    name: col("商品名"),
    newPrice: col("新販売価格"),
    curPrice: col("現販売価格"),
    newCost: col("最新仕入価格(2026", "最新仕入価格"),
    supplier: col("仕入先"),
    model: col("型番"),
    note: col("備考"),
    maker: col("メーカー品番", "ﾒｰｶｰ品番"),
    size: col("サイズ"),
    color: col("カラー"),
  };
  if (C.aeon < 0 || C.name < 0) throw new Error("「イオン品番」「商品名」の列が見つかりません。");
  const at = (r: Cell[], i: number): Cell => (i >= 0 ? r[i] : null);

  const byCode = new Map<string, AeonItemRow>();
  const order: string[] = [];
  let last: AeonItemRow | null = null;
  let skipped = 0;

  const addComponent = (target: AeonItemRow, r: Cell[]) => {
    const part = [text(at(r, C.listNo)), text(at(r, C.name)), num(at(r, C.newPrice)) != null ? `@${num(at(r, C.newPrice))}` : null]
      .filter(Boolean)
      .join(" ");
    if (part) target.components = target.components ? `${target.components} / ${part}` : part;
  };

  for (const r of rows.slice(headerIdx + 1)) {
    const code = codeText(at(r, C.aeon));
    const name = text(at(r, C.name));
    if (!code) {
      if (name && last) addComponent(last, r);
      else skipped++;
      continue;
    }
    const existing = byCode.get(code);
    if (existing) {
      addComponent(existing, r);
      last = existing;
      continue;
    }
    const newPriceCell = at(r, C.newPrice);
    const newPrice = num(newPriceCell);
    const item: AeonItemRow = {
      aeon_code: code,
      list_no: text(at(r, C.listNo)),
      name,
      new_price: newPrice,
      current_price: num(at(r, C.curPrice)),
      status: newPrice == null ? text(newPriceCell) : null,
      new_cost: num(at(r, C.newCost)),
      supplier: text(at(r, C.supplier)),
      model: text(at(r, C.model)),
      maker_code: text(at(r, C.maker)),
      size: text(at(r, C.size)),
      color: text(at(r, C.color)),
      note: text(at(r, C.note)),
      components: null,
    };
    byCode.set(code, item);
    order.push(code);
    last = item;
  }
  return { items: order.map((c) => byCode.get(c) as AeonItemRow), skipped };
}

// 廃番・ダブリ抹消など、もう使わない品番か
export function isDiscontinued(status: string | null | undefined): boolean {
  return !!status && /廃|抹消/.test(status);
}
