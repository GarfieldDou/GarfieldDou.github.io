window.__PRICE_DATA__ = {"updatedAt":"2026-10-15T04:00:34.815810Z","sourceUrl":"https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json","source":"portable","categories":["麵包蛋糕 / 穀類早餐 / 麵包醬","奶類及乳製品 / 大豆製品 / 蛋類","糖果 / 餅乾 / 小食","米 / 食油 / 罐頭 / 蔬果 / 肉類","粉麵 / 煮食用料 / 冷凍加工食品","飲品","奶粉 / 嬰兒用品","個人護理","家居用品 / 寵物食品及用品","酒類"],"subcategories":["麵包","蛋糕","穀類早餐","麵包醬","蜂蜜 / 蜜糖 / 糖漿","牛奶 / 牛奶飲品","忌廉","芝士 / 乳酪 / 乳酸產品","牛油 / 植物牛油","冰凍甜點","豆漿 / 豆奶 / 即沖豆漿","豆腐製品","蛋類","糖果 / 甜品","乾果","能量棒 / 營養棒 / 點心棒","餅乾","小食","米","食用油 / 煮食油","罐頭食品","無菌包裝食品","新鮮蔬菜","新鮮水果","冰鮮/新鮮肉類","急凍肉類","急凍海產","急凍蔬菜","乾貨","即食麵 / 快熟粉","烏冬麵","非即食中式粉麵 / 日式粉麵","非即食意式粉麵","調味 / 煮食用料","烘焙用料 / 麵粉","急凍加工食品 / 冷藏加工食品","汽水","咖啡 / 茶包 / 奶茶 / 鴛鴦","果汁類飲品","東方特色飲品","樽裝水 / 運動飲品 /  能量飲品","麥片飲品 / 麥芽飲品 / 朱古力飲品","嬰幼兒奶粉 / 兒童奶粉","孕婦奶粉","成人奶粉","嬰幼兒食品 / 嬰兒食品 / 幼兒食品","嬰兒用品","口腔護理","女士衛生用品","頭髮護理","沐浴露 / 皂液 / 肥皂","手部殺菌消毒","濕巾","皮膚護理","女士脫毛用品 / 除毛用品","男士護理","止汗/香體用品","藥品","保健食品 / 營養補充劑","急救用品","衛生防護用品","醫療設備","避孕","成人紙尿片 / 紙尿褲","洗衣用品","清潔用品","紙品","保鮮紙 / 食物袋 / \"錫紙\"","吸濕防霉","殺蟲用品","電器","電池","寵物食品","寵物用品","啤酒","仙地","紅酒","白酒","紹興酒","米酒"],"retailers":["PARKNSHOP","WELLCOME","JASONS"],"products":[]};
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