/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // PDF読み取り(pdfjs-dist)はサーバー側でそのままrequireして使う(バンドルすると
    // 任意依存のcanvasの解決で失敗するため)。ワーカーは実行時に読み込まれるので、
    // Vercelのデプロイに含まれるよう明示する。
    serverComponentsExternalPackages: ["pdfjs-dist"],
    outputFileTracingIncludes: {
      "/api/smaps-pdf": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.js"],
    },
  },
};

export default nextConfig;
