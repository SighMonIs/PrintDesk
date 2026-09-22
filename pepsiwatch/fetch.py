"""Scrape Pepsi Max prices from Coles, Woolworths and Amazon AU into prices.json.
Stdlib only so it runs on a bare GitHub Actions runner."""
import html, json, os, re, subprocess, sys, time

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
JAR = "cookies.txt"


def get(url, data=None, headers=None):
    # ponytail: curl, not urllib - Coles' bot wall (Imperva) rejects Python's TLS fingerprint but lets curl through
    cmd = ["curl", "-sS", "--fail", "--compressed", "--max-time", "30", "-A", UA, "-c", JAR, "-b", JAR, url]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    if data is not None:
        cmd += ["--data-binary", data]
    return subprocess.run(cmd, check=True, capture_output=True).stdout.decode("utf-8", "replace")


def litres(text):
    """Total litres from a product name/size like '30 x 375ml', '375mL x 30 pack', '1.25L', '2 Litre (Pack of 3)'."""
    t = text.lower()
    m = re.search(r"(\d+(?:\.\d+)?)\s*(ml|l|litre)\b", t)
    if not m:
        return None
    vol = float(m.group(1)) / (1000 if m.group(2) == "ml" else 1)
    pk = re.search(r"(\d+)[\s-]*(?:x|pack|pk)\b|\bx\s*(\d+)|pack of (\d+)", t)
    return round(vol * (int(next(g for g in pk.groups() if g)) if pk else 1), 3)


def is_pepsi_max(name):
    n = name.lower()
    return "pepsi" in n and "max" in n and not re.search(r"sodastream|soda mix|syrup|combo|flavour|[+|]", n)


def coles():
    home = get("https://www.coles.com.au/")
    bid = re.search(r'"buildId":"([^"]+)"', home).group(1)
    d = json.loads(get(f"https://www.coles.com.au/_next/data/{bid}/en/search/products.json?q=pepsi%20max"))
    for p in d["pageProps"]["searchResults"]["results"]:
        if p.get("_type") != "PRODUCT" or not p.get("pricing"):
            continue
        yield {"store": "Coles", "name": f"{p['brand']} {p['name']} {p['size']}", "price": p["pricing"]["now"],
               "url": f"https://www.coles.com.au/product/{p['id']}"}


def woolworths():
    get("https://www.woolworths.com.au/")  # cookies
    body = json.dumps({"SearchTerm": "pepsi max", "PageSize": 36, "PageNumber": 1, "SortType": "TraderRelevance",
                       "Location": "/shop/search/products?searchTerm=pepsi%20max", "Filters": []})
    d = json.loads(get("https://www.woolworths.com.au/apis/ui/Search/products", body, {"Content-Type": "application/json", "Accept": "application/json"}))
    for g in d.get("Products", []):
        for p in g["Products"]:
            if p["Price"] is None or not p["IsAvailable"]:
                continue
            yield {"store": "Woolworths", "name": f"{p['Name']} {p['PackageSize']}", "price": p["Price"],
                   "url": f"https://www.woolworths.com.au/shop/productdetails/{p['Stockcode']}"}


def amazon():
    s = get("https://www.amazon.com.au/s?k=pepsi+max", headers={"Accept-Language": "en-AU,en;q=0.9"})
    for blk in re.split(r'(?=<div[^>]*data-component-type="s-search-result")', s)[1:]:
        asin = re.search(r'data-asin="([A-Z0-9]{10})"', blk)
        h2s = re.findall(r"<h2[^>]*>(.*?)</h2>", blk, re.S)
        price = re.search(r'class="a-offscreen">\$([\d,.]+)</span>', blk)
        if not (asin and h2s and price):
            continue
        name = " ".join(html.unescape(re.sub("<[^>]+>", "", h)).strip() for h in h2s)
        yield {"store": "Amazon", "name": name, "price": float(price.group(1).replace(",", "")),
               "url": f"https://www.amazon.com.au/dp/{asin.group(1)}"}


def scrape(fn):
    for attempt in range(3):  # bot walls are intermittent; a short pause and fresh cookies usually clear them
        if os.path.exists(JAR):
            os.remove(JAR)
        try:
            found = [{**r, "litres": l, "per_litre": round(r["price"] / l, 2)}
                     for r in fn() if is_pepsi_max(r["name"]) and (l := litres(r["name"]))]
            if not found:
                raise ValueError("no products parsed (bot wall / blank page?)")
            return found
        except Exception as e:
            err = e
            time.sleep(10)
    raise err


try:
    prev = json.load(open("prices.json"))["rows"]
except Exception:
    prev = []
rows, errors = [], {}
for fn in (coles, woolworths, amazon):
    store = fn.__name__.capitalize()
    try:
        rows += scrape(fn)
    except Exception as e:  # one store down shouldn't kill the others: keep its last good rows
        errors[store] = repr(e)
        rows += [r for r in prev if r["store"] == store]
        print(f"{store}: {e!r}", file=sys.stderr)

if os.path.exists(JAR):
    os.remove(JAR)
rows.sort(key=lambda r: r["per_litre"])
iv = re.fullmatch(r"(\d+)([smhd])", os.environ.get("INTERVAL", "6h"))  # same INTERVAL run.sh sleeps on
secs = int(iv.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[iv.group(2)]
stamp = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
json.dump({"updated": stamp(time.time()), "next": stamp(time.time() + secs), "errors": errors, "rows": rows}, open("prices.json", "w"), indent=1)
print(f"{len(rows)} rows, errors={errors}")

if __name__ == "__main__" and "--test" in sys.argv:
    assert litres("Pepsi Max No Sugar Soft Drink Cans 375mL x 30 pack") == 11.25
    assert litres("Pepsi Max Zero Sugar Cola Soft Drink, 30 x 375ml") == 11.25
    assert litres("Pepsi Max No Sugar Cola Soft Drink Bottle 1.25L") == 1.25
    assert litres("Pepsi Max Soft Drink No Sugar Cans Multipack 375ml 10 Pack") == 3.75
    assert litres("Pepsi Max No Sugar Soft Drink Can 375 ml (Pack of 24)") == 9
    assert litres("Pepsi Max Manta Soft Drink 2 Litre (Pack of 3)") == 6
    assert litres("Pepsi Max 24-pack 375mL") == 9
    assert not is_pepsi_max("Pepsi Max 24-pack 375mL | Red Rock Deli Chips")
    assert not is_pepsi_max("Sodastream Pepsi Max Flavour 440mL")
    print("ok")
