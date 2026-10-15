#!/usr/bin/env python3
"""Refresh Consumer Council prices and selected retailer website observations."""

from __future__ import annotations

import difflib
import html
import json
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "pricewatch-cache.json"
SOURCE_URL = "https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json"
TARGET_RETAILERS = {"PARKNSHOP", "WELLCOME", "JASONS"}
WELLCOME_CATEGORY_URL = "https://www.wellcome.com.hk/zh-hant/category/100002-100063/{page}.html"
WELLCOME_ORIGIN = "https://www.wellcome.com.hk"
WELLCOME_PAGES = 8
WELLCOME_PRODUCT_PATTERN = re.compile(
    r'<a href="(?P<url>/zh-hant/wellcome/p/[^"]+\.html)"[^>]*>'
    r'.*?<div class="promo"[^>]*>(?P<name>.*?)</div>.*?</a>\s*'
    r'<div class="price-container"[^>]*>.*?'
    r'<div class="line-price"[^>]*>(?P<list_price>.*?)</div>\s*'
    r'<div class="current-price"[^>]*>\s*'
    r'<div class="price"[^>]*>\$(?P<major>[^<]+)</div>\s*'
    r'<div class="small-price"[^>]*>(?P<minor>[^<]*)</div>',
    re.DOTALL,
)


def localized(value, key="zh-Hant", fallback="en"):
    if not isinstance(value, dict):
        return ""
    return value.get(key) or value.get(fallback) or ""


def normalize(product):
    offers = {
        offer.get("supermarketCode"): offer
        for offer in product.get("offers", [])
        if offer.get("supermarketCode") in TARGET_RETAILERS
    }
    prices = []
    for price in product.get("prices", []):
        retailer = price.get("supermarketCode")
        if retailer not in TARGET_RETAILERS:
            continue
        try:
            amount = float(price.get("price"))
        except (TypeError, ValueError):
            continue
        prices.append(
            {
                "retailer": retailer,
                "price": amount,
                "offer": localized(offers.get(retailer, {})),
            }
        )
    if not prices:
        return None
    return {
        "code": product.get("code", ""),
        "brand": localized(product.get("brand", {})),
        "brandEn": localized(product.get("brand", {}), "en", "zh-Hant"),
        "name": localized(product.get("name", {})) or "未命名商品",
        "nameEn": localized(product.get("name", {}), "en", "zh-Hant"),
        "category": localized(product.get("cat1Name", {})) or "其他",
        "subcategory": localized(product.get("cat2Name", {})),
        "prices": prices,
    }


def strip_html(value):
    value = re.sub(r"<[^>]+>", " ", html.unescape(value or ""))
    return re.sub(r"\s+", " ", value.replace("\u200b", " ")).strip()


def normalized_text(value):
    value = unicodedata.normalize("NFKC", value or "").lower()
    value = value.replace("鮮奶", "鮮牛奶").replace("奶飲品", "牛奶飲品")
    value = re.sub(r"\([^)]*(?:包裝|隨機)[^)]*\)", "", value)
    value = value.replace("公升", "l").replace("毫升", "ml")
    value = value.replace("公斤", "kg").replace("克", "g")
    value = value.replace("ltr", "l").replace("lt", "l")
    return re.sub(r"[^0-9a-z\u4e00-\u9fff.%]+", "", value)


def package_sizes(value):
    normalized = normalized_text(value)
    matches = re.findall(r"(\d+(?:\.\d+)?)(ml|l|kg|g)", normalized)
    sizes = set()
    for amount, unit in matches:
        number = float(amount)
        if unit == "l":
            number *= 1000
            unit = "ml"
        elif unit == "kg":
            number *= 1000
            unit = "g"
        sizes.add((round(number, 3), unit))
    return sizes


def fetch_wellcome_products(observed_at):
    products = []
    seen_urls = set()
    for page in range(1, WELLCOME_PAGES + 1):
        source_url = WELLCOME_CATEGORY_URL.format(page=page)
        request = urllib.request.Request(
            source_url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; HK-Price-Benchmark/1.1)"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            document = response.read().decode("utf-8")

        page_products = list(WELLCOME_PRODUCT_PATTERN.finditer(document))
        if not page_products:
            break
        for match in page_products:
            major = strip_html(match.group("major"))
            minor = strip_html(match.group("minor"))
            try:
                price = float(f"{major}{minor}")
            except ValueError:
                continue

            list_price_text = strip_html(match.group("list_price")).replace("$", "")
            try:
                list_price = float(list_price_text) if list_price_text else None
            except ValueError:
                list_price = None

            product_url = urljoin(WELLCOME_ORIGIN, html.unescape(match.group("url")))
            if product_url in seen_urls:
                continue
            seen_urls.add(product_url)
            products.append(
                {
                    "name": strip_html(match.group("name")),
                    "price": price,
                    "listPrice": list_price,
                    "url": product_url,
                    "observedAt": observed_at,
                }
            )
    return products


def match_wellcome_product(official_product, products):
    official_text = normalized_text(official_product["name"])
    official_sizes = package_sizes(official_product["name"])
    candidates = []

    for product in products:
        wellcome_price = next(
            (price for price in product["prices"] if price["retailer"] == "WELLCOME"),
            None,
        )
        if not wellcome_price:
            continue

        brand = normalized_text(product["brand"])
        if brand and brand not in official_text:
            continue
        if official_sizes and package_sizes(product["name"]) != official_sizes:
            continue

        official_name = official_text.replace(brand, "", 1) if brand else official_text
        benchmark_name = normalized_text(product["name"])
        for amount, unit in official_sizes:
            amount_text = str(int(amount)) if float(amount).is_integer() else str(amount)
            official_name = official_name.replace(f"{amount_text}{unit}", "")
            benchmark_name = benchmark_name.replace(f"{amount_text}{unit}", "")
        score = difflib.SequenceMatcher(None, official_name, benchmark_name).ratio()
        candidates.append((score, product, wellcome_price))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    best = candidates[0]
    runner_up = candidates[1][0] if len(candidates) > 1 else 0
    if best[0] < 0.70 or (best[0] - runner_up) < 0.08:
        return None
    return best[1], best[2], round(best[0], 3)


request = urllib.request.Request(
    SOURCE_URL,
    headers={"User-Agent": "HK-Price-Benchmark/1.0 (GitHub Pages updater)"},
)
with urllib.request.urlopen(request, timeout=60) as response:
    raw = json.loads(response.read().decode("utf-8"))

products = [item for product in raw if (item := normalize(product))]
observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
sources = [
    {
        "id": "consumer-council",
        "label": "香港消费者委员会",
        "url": SOURCE_URL,
        "updatedAt": observed_at,
        "status": "connected",
        "matchedProducts": len(products),
    }
]

try:
    wellcome_products = fetch_wellcome_products(observed_at)
    milk_benchmark_products = [
        product for product in products if product["subcategory"] == "牛奶 / 牛奶飲品"
    ]
    milk_benchmark_wellcome_products = [
        product
        for product in milk_benchmark_products
        if any(price["retailer"] == "WELLCOME" for price in product["prices"])
    ]
    matched = 0
    for official_product in wellcome_products:
        result = match_wellcome_product(official_product, products)
        if not result:
            continue
        _, price, confidence = result
        price["official"] = {
            **official_product,
            "source": "wellcome.com.hk",
            "sourceLabel": "惠康官网",
            "scope": "未设送货地址的官网公开价",
            "matchConfidence": confidence,
        }
        matched += 1
    sources.append(
        {
            "id": "wellcome",
            "label": "惠康官网",
            "url": WELLCOME_ORIGIN,
            "updatedAt": observed_at,
            "status": "connected",
            "matchedProducts": matched,
            "observedProducts": len(wellcome_products),
            "unmatchedOfficialProducts": max(len(wellcome_products) - matched, 0),
            "benchmarkCategoryProducts": len(milk_benchmark_products),
            "benchmarkWellcomeProducts": len(milk_benchmark_wellcome_products),
            "scope": "鲜奶分类试运行",
        }
    )
except Exception as error:  # The benchmark must still refresh if a retailer blocks a request.
    sources.append(
        {
            "id": "wellcome",
            "label": "惠康官网",
            "url": WELLCOME_ORIGIN,
            "updatedAt": observed_at,
            "status": "unavailable",
            "warning": str(error),
        }
    )

sources.append(
    {
        "id": "parknshop",
        "label": "百佳官网",
        "url": "https://www.pns.hk/zh-hk/",
        "updatedAt": None,
        "status": "adapter-pending",
        "warning": "官网访问防护暂时拒绝无人值守抓取",
    }
)
payload = {
    "updatedAt": observed_at,
    "sourceUrl": SOURCE_URL,
    "sources": sources,
    "products": products,
}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(
    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)
wellcome_source = next(source for source in sources if source["id"] == "wellcome")
print(
    f"Refreshed {len(products)} benchmark products; "
    f"matched {wellcome_source.get('matchedProducts', 0)} Wellcome website prices"
)
