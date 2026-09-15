// Supabaseから大量の行を取得するための共通ヘルパー。
// 1件ずつ順番に(逐次)ページを取りに行くと、ページ数が多いテーブル(数万件超)では
// リクエストの往復時間が積み重なって、Vercelの関数タイムアウト(504)を起こすことがある。
// そのため、複数ページを同時並行(concurrency件ずつ)でリクエストして待ち時間を大きく減らす。

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllPagesConcurrent<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts?: { pageSize?: number; concurrency?: number }
): Promise<T[]> {
  const pageSize = opts?.pageSize ?? 1000;
  const concurrency = opts?.concurrency ?? 8;

  const rows: T[] = [];
  let nextFrom = 0;
  let done = false;

  while (!done) {
    const batch: PromiseLike<PageResult<T>>[] = [];
    for (let i = 0; i < concurrency; i++) {
      const from = nextFrom + i * pageSize;
      const to = from + pageSize - 1;
      batch.push(fetchPage(from, to));
    }
    nextFrom += concurrency * pageSize;

    const results = await Promise.all(batch);
    for (const { data, error } of results) {
      if (error) {
        throw new Error(error.message);
      }
      if (!data || data.length === 0) {
        done = true;
        continue;
      }
      rows.push(...data);
      if (data.length < pageSize) done = true; // これが最後のページ
    }
  }

  return rows;
}
