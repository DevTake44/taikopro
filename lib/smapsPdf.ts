// SMAPS(イオンの購買システム)の「取引詳細」画面をブラウザで印刷したPDFから、
// 受注に必要な項目を読み取る。PDFから取り出した文字(位置付き)を受け取って解析する純粋関数。
//
// 画面の構成(2026-11時点で確認):
// 1ページ目 左列: 取引通番・取引区分・取引タイトル・希望納期・納期確定日・商品合計金額・
//   運搬費合計・設置費/作業費・請求書送付先(企業・部署)・コメント
// 1ページ目 右列(x≒350以降): 会社・会社担当・店舗・店舗担当・納品先(〒・住所・店名等)・
//   受入担当・TEL・Fax・携帯電話
// 明細: 「No. 商品名 品番 導入場所」の見出し行の下に、1商品ずつ
//   (No・商品名・イオン品番・導入場所・型番:)(サイズ:)(単価:)(数量:)(合計:)(税区:) が並ぶ。

export type PdfTextItem = { str: string; x: number; y: number };
export type PdfPage = PdfTextItem[];

export type SmapsPdfItem = {
  no: string;
  name: string;
  aeonCode: string;
  place: string;
  model: string;
  size: string;
  unitPrice: number | null;
  qty: number | null;
  amount: number | null;
  confirmedDate: string;
};

export type SmapsPdf = {
  tradeNo: string;
  tradeType: string;
  title: string;
  company: string;
  companyContact: string;
  store: string;
  storeContact: string;
  desiredDate: string;
  confirmedDate: string;
  deliveryPostalCode: string;
  deliveryAddress: string;
  deliveryPlace: string;
  receiver: string;
  tel: string;
  fax: string;
  mobile: string;
  goodsTotal: number | null;
  freightTotal: number | null;
  installTotal: number | null;
  billingCompany: string;
  billingDept: string;
  comments: string[];
  items: SmapsPdfItem[];
};

// ⾒(康熙部首)などをふつうの漢字に、全角英数を半角にそろえる。
export function norm(s: string): string {
  return s.normalize("NFKC").replace(/\u2027/g, "・").replace(/\s+/g, " ").trim();
}

type Line = { y: number; items: PdfTextItem[] };

function toLines(page: PdfPage): Line[] {
  const items = page.filter((i) => i.str.trim() !== "").slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of items) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - it.y) <= 3) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

// 文字片を左から連結する。間が大きく空いている所だけ空白を入れる(1文字ずつ分かれて
// 出てくる日本語をつなげるため)。
function joinItems(items: PdfTextItem[]): string {
  let out = "";
  let prevEnd: number | null = null;
  for (const it of items) {
    if (prevEnd !== null && it.x - prevEnd > 12) out += " ";
    out += it.str;
    prevEnd = it.x + Math.max(it.str.length, 1) * 6.5;
  }
  return norm(out);
}

function amount(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[,，円¥￥\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 「取引通番 94301」のような行から、ラベルを除いた値を取り出す(ラベル部分は空白なしで比較)。
function valueOf(text: string, label: string): string | null {
  const compact = text.replace(/\s/g, "");
  if (!compact.startsWith(label)) return null;
  let i = 0;
  let seen = 0;
  while (i < text.length && seen < label.length) {
    if (!/\s/.test(text[i])) seen++;
    i++;
  }
  return text.slice(i).trim();
}

export function parseSmapsPdf(pages: PdfPage[]): SmapsPdf {
  const r: SmapsPdf = {
    tradeNo: "",
    tradeType: "",
    title: "",
    company: "",
    companyContact: "",
    store: "",
    storeContact: "",
    desiredDate: "",
    confirmedDate: "",
    deliveryPostalCode: "",
    deliveryAddress: "",
    deliveryPlace: "",
    receiver: "",
    tel: "",
    fax: "",
    mobile: "",
    goodsTotal: null,
    freightTotal: null,
    installTotal: null,
    billingCompany: "",
    billingDept: "",
    comments: [],
    items: [],
  };

  const RIGHT_X = 350;
  let state: "head" | "billing" | "comment" | "items" = "head";
  let deliveryMode = false;
  let colCode = 0;
  let colPlace = 0;
  let current: SmapsPdfItem | null = null;

  for (const page of pages) {
    for (const line of toLines(page)) {
      const whole = joinItems(line.items);
      const compact = whole.replace(/\s/g, "");

      // 明細の見出し行(どのページにあっても、ここから明細)。
      if (/^No\.?商品名品番導入場所/.test(compact)) {
        state = "items";
        const xs = line.items;
        const codeIdx = xs.findIndex((i, k) => norm(i.str) === "品" && norm(xs[k + 1]?.str ?? "") === "番");
        colCode = codeIdx >= 0 ? xs[codeIdx].x : 240;
        const placeIdx = xs.findIndex((i) => norm(i.str) === "導");
        colPlace = placeIdx >= 0 ? xs[placeIdx].x : colCode + 30;
        continue;
      }

      if (state === "items") {
        const left = line.items.filter((i) => i.x < 320);
        const right = line.items.filter((i) => i.x >= 320 && i.x < 470);
        const leftText = joinItems(left);
        const rightText = joinItems(right).replace(/\s/g, "");
        const first = left[0];
        const isNewItem = first && first.x < 35 && /^\d+$/.test(norm(first.str));
        if (isNewItem) {
          const nameItems = left.filter((i) => i.x >= 35 && i.x < colCode - 5);
          const codeItems = left.filter((i) => i.x >= colCode - 5 && i.x < colPlace - 5);
          const placeItems = left.filter((i) => i.x >= colPlace - 5);
          current = {
            no: norm(first.str),
            name: joinItems(nameItems).trim(),
            aeonCode: joinItems(codeItems).replace(/\s/g, ""),
            place: joinItems(placeItems),
            model: "",
            size: "",
            unitPrice: null,
            qty: null,
            amount: null,
            confirmedDate: "",
          };
          r.items.push(current);
        } else if (current && leftText) {
          const d = leftText.match(/納期確定日[:：]\s*(\d{4}\/\d{1,2}\/\d{1,2})/);
          if (d) current.confirmedDate = d[1];
          else if (!/^コメント/.test(leftText.replace(/\s/g, ""))) current.name = norm(`${current.name} ${leftText}`);
        }
        if (current && rightText) {
          const m = joinItems(right).match(/^(型番|サイズ|単価|数量|合計|税区)\s*[:：]\s*(.*)$/);
          if (m) {
            const v = m[2].trim();
            if (m[1] === "型番") current.model = v === "-" ? "" : v;
            else if (m[1] === "サイズ") current.size = v === "-" ? "" : v;
            else if (m[1] === "単価") current.unitPrice = amount(v);
            else if (m[1] === "数量") current.qty = amount(v);
            else if (m[1] === "合計") current.amount = amount(v);
          } else if (current.size && !/コメント/.test(rightText)) {
            current.size = norm(current.size + rightText);
          }
        }
        continue;
      }

      const left = joinItems(line.items.filter((i) => i.x < RIGHT_X));
      const right = joinItems(line.items.filter((i) => i.x >= RIGHT_X));

      if (/^請求書送付先/.test(left.replace(/\s/g, ""))) {
        state = "billing";
        continue;
      }
      if (/^コメント→購買/.test(left.replace(/\s/g, ""))) {
        state = "comment";
        continue;
      }

      if (state === "billing") {
        const v1 = valueOf(left, "企業");
        if (v1 !== null) r.billingCompany = v1;
        const v2 = valueOf(left, "部署");
        if (v2 !== null) r.billingDept = v2;
      } else if (state === "comment") {
        if (whole) r.comments.push(whole);
      } else {
        const pick = (label: string) => valueOf(left, label);
        r.tradeNo = pick("取引通番") ?? r.tradeNo;
        r.tradeType = pick("取引区分") ?? r.tradeType;
        r.title = pick("取引タイトル") ?? r.title;
        r.desiredDate = pick("希望納期") ?? r.desiredDate;
        r.confirmedDate = pick("納期確定日") ?? r.confirmedDate;
        const goods = pick("商品合計金額");
        if (goods !== null) r.goodsTotal = amount(goods);
        const freight = pick("運搬費合計");
        if (freight !== null) r.freightTotal = amount(freight);
        const install = pick("設置費・作業費合計");
        if (install !== null) r.installTotal = amount(install);

        if (right) {
          const rv = (label: string) => valueOf(right, label);
          if (rv("会社住所") !== null) {
            deliveryMode = false;
          } else if (rv("会社担当") !== null) {
            r.companyContact = rv("会社担当") ?? "";
          } else if (rv("会社") !== null) {
            r.company = rv("会社") ?? "";
          } else if (rv("店舗担当") !== null) {
            r.storeContact = rv("店舗担当") ?? "";
          } else if (rv("店舗") !== null) {
            r.store = rv("店舗") ?? "";
          } else if (rv("納品先") !== null) {
            deliveryMode = true;
            r.deliveryPostalCode = (rv("納品先") ?? "").replace(/[〒\s]/g, "");
          } else if (rv("受入担当") !== null) {
            deliveryMode = false;
            r.receiver = rv("受入担当") ?? "";
          } else if (rv("TEL") !== null) {
            r.tel = rv("TEL") ?? "";
          } else if (rv("Fax") !== null) {
            r.fax = rv("Fax") ?? "";
          } else if (rv("携帯電話") !== null) {
            r.mobile = rv("携帯電話") ?? "";
          } else if (deliveryMode && right !== "Japan") {
            if (!r.deliveryAddress) r.deliveryAddress = right;
            else r.deliveryPlace = r.deliveryPlace ? `${r.deliveryPlace} ${right}` : right;
          }
        }
      }
    }
  }

  r.tradeNo = r.tradeNo.replace(/\s/g, "");
  return r;
}

