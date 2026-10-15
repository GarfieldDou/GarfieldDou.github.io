#!/usr/bin/env python3
"""Refresh the portable supermarket dataset from Consumer Council open data."""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "pricewatch-cache.json"
SOURCE_URL = "https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json"
TARGET_RETAILERS = {"PARKNSHOP", "WELLCOME", "JASONS"}


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


request = urllib.request.Request(
    SOURCE_URL,
    headers={"User-Agent": "HK-Price-Benchmark/1.0 (GitHub Pages updater)"},
)
with urllib.request.urlopen(request, timeout=60) as response:
    raw = json.loads(response.read().decode("utf-8"))

products = [item for product in raw if (item := normalize(product))]
payload = {
    "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "sourceUrl": SOURCE_URL,
    "products": products,
}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(
    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)
print(f"Refreshed {len(products)} products")
