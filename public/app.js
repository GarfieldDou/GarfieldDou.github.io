const RETAILERS = ["PARKNSHOP", "WELLCOME", "JASONS"];

const elements = {
  search: document.querySelector("#search"),
  category: document.querySelector("#category"),
  sort: document.querySelector("#sort"),
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

function effectivePrice(price) {
  if (Number.isFinite(price?.official?.effectivePrice)) return price.official.effectivePrice;
  return price?.price ?? Infinity;
}

function parseUnitInfo(name) {
  const text = String(name || "").normalize("NFKC");
  let count = null;
  let countLabel = "件";
  let amount = null;
  let measure = null;

  const forward = text.match(/(\d+)\s*(罐|盒|包|袋|支|樽|瓶)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(kg|公斤|gm|g|克|ml|l|公升|毫升)(?![a-z])/i);
  const reverse = text.match(/(\d+(?:\.\d+)?)\s*(kg|公斤|gm|g|克|ml|l|公升|毫升)(?![a-z])\s*[x×*]\s*(\d+)\s*(罐|盒|包|袋|支|樽|瓶)?/i);
  if (forward) {
    count = Number(forward[1]);
    countLabel = forward[2] || countLabel;
    amount = Number(forward[3]);
    measure = forward[4];
  } else if (reverse) {
    count = Number(reverse[3]);
    countLabel = reverse[4] || countLabel;
    amount = Number(reverse[1]);
    measure = reverse[2];
  } else {
    const packageMatch = text.match(/(\d+)\s*(罐|盒|包|袋|支|樽|瓶)(?:裝)?/);
    if (packageMatch) {
      count = Number(packageMatch[1]);
      countLabel = packageMatch[2];
    }
    const measureMatch = text.match(/(\d+(?:\.\d+)?)\s*(kg|公斤|gm|g|克|ml|l|公升|毫升)(?![a-z])/i);
    if (measureMatch) {
      amount = Number(measureMatch[1]);
      measure = measureMatch[2];
    }
  }

  if (measure) {
    const normalizedMeasure = measure.toLowerCase();
    if (["kg", "公斤"].includes(normalizedMeasure)) {
      amount *= 1000;
      measure = "g";
    } else if (["l", "公升"].includes(normalizedMeasure)) {
      amount *= 1000;
      measure = "ml";
    } else if (["g", "gm", "克"].includes(normalizedMeasure)) {
      measure = "g";
    } else {
      measure = "ml";
    }
  }
  return { count, countLabel, amount, measure };
}

function unitPriceLines(price, productName) {
  const unit = parseUnitInfo(productName);
  const amount = effectivePrice(price);
  if (!Number.isFinite(amount)) return "";
  const lines = [];

  if (price.official?.promotionQuantity > 1) {
    const promoUnit = /罐頭|罐头|罐裝|罐装/.test(productName) ? "罐" : unit.countLabel;
    lines.push(`<small class="unit-price promo-unit">优惠后 $${amount.toFixed(2)}/${escapeHtml(promoUnit)}</small>`);
  } else if (unit.count > 1) {
    lines.push(`<small class="unit-price">$${(amount / unit.count).toFixed(2)}/${escapeHtml(unit.countLabel)}</small>`);
  }

  if (unit.amount && unit.measure) {
    const packageCount = unit.count > 1 ? unit.count : 1;
    const weightBase = price.official?.promotionQuantity > 1 ? unit.amount : unit.amount * packageCount;
    const perHundred = amount / weightBase * 100;
    const label = unit.measure === "g" ? "100克" : "100毫升";
    lines.push(`<small class="unit-price">约 $${perHundred.toFixed(2)}/${label}</small>`);
  }
  return lines.join("");
}

function priceCell(price, minimum, product) {
  if (!price) return '<span class="price-missing">—</span>';
  const official = price.official;
  const currentPrice = official?.price ?? price.price;
  const currentEffectivePrice = effectivePrice(price);
  const isCheapest = Math.abs(currentEffectivePrice - minimum) < 0.001;
  const offer = official?.offer || price.offer;
  const sourceLine = official
    ? `<a class="official-link" href="${escapeHtml(official.url)}" target="_blank" rel="noreferrer">惠康官网 ↗</a>
       <small class="source-time">${formatDate(official.observedAt)}</small>
       ${product.sourceOnly ? "" : `<small class="benchmark-price">消委会基准 $${price.price.toFixed(2)}</small>`}`
    : `<small class="source-time">消委会 · 每日更新</small>`;
  return `
    <span class="price ${isCheapest ? "cheapest" : ""}">$${currentPrice.toFixed(2)}</span>
    ${offer ? `<small class="offer">${official?.offer ? "官网优惠 · " : ""}${escapeHtml(offer)}</small>` : ""}
    ${unitPriceLines(price, product.name)}
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
    const values = product.prices.map(effectivePrice);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const spread = maximum - minimum;

    return `
      <tr>
        <td>
          <div class="product-brand">${escapeHtml(product.brand || "未标示品牌")}</div>
          <div class="product-name">${escapeHtml(product.name)}</div>
          ${product.sourceOnly ? '<span class="source-only-badge">仅惠康官网</span>' : ""}
          <div class="product-meta">${escapeHtml(product.subcategory)} · ${escapeHtml(product.code)}</div>
        </td>
        ${RETAILERS.map((retailer) => `<td>${priceCell(byRetailer.get(retailer), minimum, product)}</td>`).join("")}
        <td><span class="spread ${spread > 0 ? "has-saving" : ""}">${values.length < 2 ? "仅一店" : spread > 0 ? `省 $${spread.toFixed(2)}` : "同价"}</span></td>
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
    sort: elements.sort.value,
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

    const wellcomeSource = data.sources?.find((source) => source.id === "wellcome");
    const officialCount = wellcomeSource?.observedProducts || 0;
    const officialOnlyCount = wellcomeSource?.officialOnlyProducts || 0;
    const statusText = officialCount > 0
      ? `惠康官网 ${officialCount}项 · 独有${officialOnlyCount}项`
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
elements.sort.addEventListener("change", () => loadPrices());
elements.syncButton.addEventListener("click", () => loadPrices({ refresh: true }));

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
});

loadPrices();
