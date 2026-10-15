import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const publicDir = path.join(root, "public");
const outputDir = root;
const siteDataDir = path.join(root, "site-data");

const [htmlSource, css, clientSource, favicon, datasetSource] = await Promise.all([
  readFile(path.join(publicDir, "index.html"), "utf8"),
  readFile(path.join(publicDir, "styles.css"), "utf8"),
  readFile(path.join(publicDir, "app.js"), "utf8"),
  readFile(path.join(publicDir, "favicon.svg"), "utf8"),
  readFile(path.join(root, "data", "pricewatch-cache.json"), "utf8"),
]);

const dataset = JSON.parse(datasetSource);
dataset.source = "portable";
delete dataset.warning;

// Keep the public single-file build below GitHub's direct upload ceiling.
// These English aliases are not displayed; Chinese names, prices and offers remain intact.
for (const product of dataset.products) {
  delete product.brandEn;
  delete product.nameEn;
}

const categoryDictionary = [...new Set(dataset.products.map((product) => product.category))];
const subcategoryDictionary = [...new Set(dataset.products.map((product) => product.subcategory))];
const retailerDictionary = ["PARKNSHOP", "WELLCOME", "JASONS"];
const compactDataset = {
  updatedAt: dataset.updatedAt,
  sourceUrl: dataset.sourceUrl,
  source: dataset.source,
  categories: categoryDictionary,
  subcategories: subcategoryDictionary,
  retailers: retailerDictionary,
  products: dataset.products.map((product) => [
    product.code,
    product.brand,
    product.name,
    categoryDictionary.indexOf(product.category),
    subcategoryDictionary.indexOf(product.subcategory),
    product.prices.map((price) => [retailerDictionary.indexOf(price.retailer), price.price, price.offer]),
  ]),
};

const safeMetadata = JSON.stringify({ ...compactDataset, products: [] })
  .replaceAll("</script", "<\\/script")
  .replaceAll("<!--", "<\\!--");

const chunkSize = 100;
const productChunks = [];
for (let index = 0; index < compactDataset.products.length; index += chunkSize) {
  productChunks.push(compactDataset.products.slice(index, index + chunkSize));
}

const dataScripts = productChunks
  .map((_, index) => `<script src="./site-data/prices-${index}.js"></script>`)
  .join("");

const dataAdapter = `
<script>
window.__PRICE_DATA__ = ${safeMetadata};
window.__PRICE_DATA__.products = (window.__PRICE_CHUNKS__ || []).flat();
delete window.__PRICE_CHUNKS__;
const __allProducts = window.__PRICE_DATA__.products.map((product) => ({
  code: product[0],
  brand: product[1],
  name: product[2],
  category: window.__PRICE_DATA__.categories[product[3]],
  subcategory: window.__PRICE_DATA__.subcategories[product[4]],
  prices: product[5].map((price) => ({ retailer: window.__PRICE_DATA__.retailers[price[0]], price: price[1], offer: price[2] })),
}));
const __nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const requestUrl = String(input);
  if (!requestUrl.startsWith('/api/prices?')) return __nativeFetch(input, init);

  const params = new URL(requestUrl, 'https://portable.local').searchParams;
  const query = (params.get('q') || '').trim().toLocaleLowerCase('zh-Hant');
  const category = params.get('category') || '';
  const limit = Math.min(Math.max(Number(params.get('limit')) || 80, 1), 200);
  const allProducts = __allProducts;
  const categories = [...new Set(allProducts.map((product) => product.category))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const products = [];

  for (const product of allProducts) {
    if (category && product.category !== category) continue;
    if (!query && product.prices.length < 2) continue;
    if (query) {
      const haystack = [product.code, product.brand, product.brandEn, product.name, product.nameEn, product.category, product.subcategory]
        .join(' ')
        .toLocaleLowerCase('zh-Hant');
      if (!haystack.includes(query)) continue;
    }
    products.push(product);
    if (products.length >= limit) break;
  }

  return new Response(JSON.stringify({
    updatedAt: window.__PRICE_DATA__.updatedAt,
    source: 'portable',
    warning: null,
    totalProducts: allProducts.length,
    resultCount: products.length,
    categories,
    products,
  }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
};
</script>`;

const client = clientSource.replace(
  'const statusText = data.source === "live" ? "官方数据已同步" : data.source === "cache" ? "使用本机缓存" : "使用较早缓存";',
  'const statusText = data.source === "portable" ? "离线资料已载入" : data.source === "live" ? "官方数据已同步" : data.source === "cache" ? "使用本机缓存" : "使用较早缓存";'
);

const updatedAt = new Date(dataset.updatedAt);
const updateLabel = Number.isNaN(updatedAt.getTime())
  ? "资料时间未知"
  : `资料快照：${new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hong_Kong" }).format(updatedAt)}`;

const html = htmlSource
  .replace('href="/favicon.svg"', 'href="./public/favicon.svg"')
  .replace('href="/styles.css"', 'href="./public/styles.css"')
  .replace('正在连接数据', '正在载入离线资料')
  .replace('更新数据', '重新载入')
  .replace('价格只作个人参考，实际售价及优惠以零售商结账页面为准。', `价格只作个人参考，实际售价及优惠以零售商结账页面为准。${updateLabel}`)
  .replace('<script type="module" src="/app.js"></script>', `${dataScripts}<script src="./site-data/adapter.js"></script><script type="module" src="./site-data/app.js"></script>`);

await mkdir(outputDir, { recursive: true });
await mkdir(siteDataDir, { recursive: true });
await Promise.all(productChunks.map((chunk, index) => {
  const content = `window.__PRICE_CHUNKS__ = window.__PRICE_CHUNKS__ || [];window.__PRICE_CHUNKS__.push(${JSON.stringify(chunk)});`;
  return writeFile(path.join(siteDataDir, `prices-${index}.js`), content, "utf8");
}));
await writeFile(path.join(siteDataDir, "adapter.js"), dataAdapter.replace(/^\n?<script>\n?/, "").replace(/\n?<\/script>\s*$/, ""), "utf8");
await writeFile(path.join(siteDataDir, "app.js"), client, "utf8");

const outputPath = path.join(outputDir, "index.html");
await writeFile(outputPath, html, "utf8");

console.log(JSON.stringify({ outputPath, products: dataset.products.length, chunks: productChunks.length, bytes: Buffer.byteLength(html) }));
