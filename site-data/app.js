const RETAILERS = ["PARKNSHOP", "WELLCOME", "JASONS"];

const elements = {
  search: document.querySelector("#search"),
  category: document.querySelector("#category"),
  syncButton: document.querySelector("#syncButton"),
  priceRows: document.querySelector("#priceRows"),
  emptyState: document.querySelector("#emptyState"),
  resultSummary: document.querySelector("#resultSummary"),
  totalProducts: document.querySelector("#totalProducts"),
  updatedAt: document.querySelector("#updatedAt"),
  sourceStatus: document.querySelector("#sourceStatus"),
  notice: document.querySelector("#notice")
};

let categoriesLoaded = false;
let requestSequence = 0;
let searchTimer;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-HK", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function setLoading(isLoading) {
  elements.syncButton.disabled = isLoading;
  elements.syncButton.classList.toggle("loading", isLoading);
  if (isLoading && elements.priceRows.children.length === 0) {
    elements.priceRows.innerHTML = '<tr class="loading-row"><td colspan="5"><span class="spinner"></span>正在整理价格…</td></tr>';
  }
}

function setStatus(kind, text) {
  elements.sourceStatus.className = `live-pill ${kind}`;
  elements.sourceStatus.querySelector("span:last-child").textContent = text;
}

function priceCell(price, minimum) {
  if (!price) return '<span class="price-missing">—</span>';
  const isCheapest = price.price === minimum;
  const official = price.official;
  const sourceLine = official
    ? `<a class="official-price" href="${escapeHtml(official.url)}" target="_blank" rel="noreferrer">官网 $${official.price.toFixed(2)}</a>
       <small class="source-time">${escapeHtml(official.sourceLabel)} · ${formatDate(official.observedAt)}</small>
       <small class="benchmark-price">消委会基准 $${price.price.toFixed(2)}</small>`
    : `<small class="source-time">消委会 · 每日更新</small>`;
  return `
    <span class="price ${isCheapest ? "cheapest" : ""}">$${price.price.toFixed(2)}</span>
    ${price.offer ? `<small class="offer">${escapeHtml(price.offer)}</small>` : ""}
    ${sourceLine}
  `;
}

function renderProducts(products) {
  elements.emptyState.classList.toggle("hidden", products.length > 0);
  elements.priceRows.closest(".table-shell").classList.toggle("hidden", products.length === 0);

  if (products.length === 0) {
    elements.priceRows.innerHTML = "";
    return;
  }

  elements.priceRows.innerHTML = products.map((product) => {
    const byRetailer = new Map(product.prices.map((price) => [price.retailer, price]));
    const values = product.prices.map((price) => price.price);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const spread = maximum - minimum;

    return `
      <tr>
        <td>
          <div class="product-brand">${escapeHtml(product.brand || "未标示品牌")}</div>
          <div class="product-name">${escapeHtml(product.name)}</div>
          <div class="product-meta">${escapeHtml(product.subcategory)} · ${escapeHtml(product.code)}</div>
        </td>
        ${RETAILERS.map((retailer) => `<td>${priceCell(byRetailer.get(retailer), minimum)}</td>`).join("")}
        <td><span class="spread ${spread > 0 ? "has-saving" : ""}">${spread > 0 ? `省 $${spread.toFixed(2)}` : "同价"}</span></td>
      </tr>
    `;
  }).join("");
}

function populateCategories(categories) {
  if (categoriesLoaded) return;
  elements.category.insertAdjacentHTML(
    "beforeend",
    categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")
  );
  categoriesLoaded = true;
}

async function loadPrices({ refresh = false } = {}) {
  const sequence = ++requestSequence;
  setLoading(true);
  elements.notice.classList.add("hidden");

  const params = new URLSearchParams({
    q: elements.search.value.trim(),
    category: elements.category.value,
    limit: "80"
  });
  if (refresh) params.set("refresh", "1");

  try {
    const response = await fetch(`/api/prices?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || "读取失败");
    if (sequence !== requestSequence) return;

    renderProducts(data.products);
    populateCategories(data.categories);
    elements.totalProducts.textContent = new Intl.NumberFormat("zh-HK").format(data.totalProducts);
    elements.updatedAt.textContent = formatDate(data.updatedAt);
    elements.resultSummary.textContent = `目前显示 ${data.resultCount} 项 · 最多显示 80 项`;

    const officialCount = data.sources?.find((source) => source.id === "wellcome")?.matchedProducts || 0;
    const statusText = officialCount > 0
      ? `消委会 + 惠康官网 · ${officialCount}项`
      : data.source === "live" ? "官方数据已同步" : data.source === "cache" ? "使用本机缓存" : "使用较早缓存";
    setStatus(data.source === "stale-cache" ? "error" : "ready", statusText);

    if (data.warning) {
      elements.notice.textContent = `最新数据暂时无法连接，现正显示本机缓存：${data.warning}`;
      elements.notice.classList.remove("hidden");
    }
  } catch (error) {
    if (sequence !== requestSequence) return;
    setStatus("error", "数据暂时离线");
    elements.resultSummary.textContent = "无法载入价格";
    elements.priceRows.innerHTML = `<tr class="loading-row"><td colspan="5">${escapeHtml(error.message)}。请稍后点击“更新数据”重试。</td></tr>`;
    elements.notice.textContent = "页面已经正常运行，但目前无法连接消委会数据。";
    elements.notice.classList.remove("hidden");
  } finally {
    if (sequence === requestSequence) setLoading(false);
  }
}

elements.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadPrices(), 280);
});

elements.category.addEventListener("change", () => loadPrices());
elements.syncButton.addEventListener("click", () => loadPrices({ refresh: true }));

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
});

loadPrices();
