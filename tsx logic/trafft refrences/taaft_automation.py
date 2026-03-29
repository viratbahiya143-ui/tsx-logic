import os
import time
import random
import logging
import json
import glob
import urllib.request
from datetime import datetime
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError, Page

# ==========================================
# CONFIGURATION
# ==========================================
EMAIL = "clairem.y.ers7.0.8.8@gmail.com"
PASSWORD = "clairem.y.ers7.0.8.8@gmail.com"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "taaft_comic_output")
COOKIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "taaft_cookies.json")
HEADLESS = True
MAX_RETRIES = 2
GENERATION_TIMEOUT_SEC = 60
WAIT_BETWEEN_PROMPTS = (10, 15)

# ==========================================
# PROXY CONFIG — Webshare Free Tier
# ==========================================
# Option 1: Webshare API key (sign up free at webshare.io → get API key)
# Free tier = 10 datacenter proxies, 1GB/month
WEBSHARE_API_KEY = ""  # Paste your Webshare API key here

# Option 2: Manual proxy list (if you don't use Webshare)
# Format: "http://ip:port" or "http://user:pass@ip:port" or "socks5://ip:port"
MANUAL_PROXIES = [
    # "http://103.152.112.120:80",
    # "http://51.79.135.131:3128",
    # "http://139.180.138.220:8080",
]

# ==========================================
# CHAPTER-ACCOUNT MAPPING
# ==========================================
# Each chapter = 1 cookie file + 1 proxy IP + 1 output folder
# Proxy is auto-assigned from Webshare or MANUAL_PROXIES
# Leave empty [] to use single-account mode (no proxy)
ACCOUNTS = [
    {
        "label": "Chapter 1",
        "cookies_file": "taaft_cookies.json",
        "output_dir": "taaft_comic_output_ch1",
        # "proxy" is auto-assigned below if using Webshare/manual list
    },
    # Add more chapters as needed:
    # {
    #     "label": "Chapter 2",
    #     "cookies_file": "taaft_cookies_2.json",
    #     "output_dir": "taaft_comic_output_ch2",
    # },
]

TOOL_URL = "https://theresanaiforthat.com/@niltonjr/epic-comic-book-portrait-in-striking-detail/"

# ==========================================
# PROMPTS LIST
# ==========================================
PROMPTS = [
    "A legendary comic book hero with an energy sword, standing on a futuristic skyscraper, neon rain, vibrant colors, cyberpunk.",
    "A female protagonist in a classic comic style, fighting a giant dark creature, magic spells, dynamic action pose, intense lighting.",
]

# ==========================================
# LOGGING
# ==========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[
        logging.FileHandler(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "taaft_automation.log"),
            encoding='utf-8'
        ),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ==========================================
# HELPERS
# ==========================================
def random_delay(min_s=1.0, max_s=2.5):
    time.sleep(random.uniform(min_s, max_s))

def normalize_cookies(cookies_raw):
    if not cookies_raw: return []
    if isinstance(cookies_raw, str):
        cookies_raw = [{"name": "token", "value": cookies_raw.strip(), "domain": ".theresanaiforthat.com", "path": "/"}]
    
    valid_keys = {"name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite", "url"}
    norm = []
    for raw in cookies_raw:
        if not isinstance(raw, dict) or "name" not in raw or "value" not in raw: continue
        c = {k: raw[k] for k in valid_keys if k in raw and raw[k] is not None}
        c.setdefault("domain", ".theresanaiforthat.com")
        c.setdefault("path", "/")
        c.setdefault("secure", True)
        if c.get("sameSite") not in {"Strict", "Lax", "None"}:
            c["sameSite"] = "Lax"
        if "expires" not in c and "expirationDate" in raw and raw["expirationDate"]:
            c["expires"] = float(raw["expirationDate"])
        norm.append(c)
    return norm

def save_cookies(context, path):
    cookies = context.cookies()
    with open(path, "w") as f:
        json.dump(cookies, f)

def load_cookies(context, path):
    if os.path.exists(path):
        with open(path, "r") as f:
            cookies = json.load(f)
        context.add_cookies(normalize_cookies(cookies))
        return True
    return False

def get_next_number():
    existing = glob.glob(os.path.join(OUTPUT_DIR, "*.png"))
    numbers = []
    for f in existing:
        try:
            numbers.append(int(os.path.basename(f).replace(".png", "")))
        except ValueError:
            pass
    return max(numbers, default=0) + 1

# ==========================================
# LOGIN
# ==========================================
def ensure_logged_in(page, context):
    if load_cookies(context, COOKIES_FILE):
        page.goto("https://theresanaiforthat.com/", wait_until="domcontentloaded")
        random_delay(2, 3)
        # Check if we see "Sign in"
        is_logged_in = page.evaluate("() => !document.body.innerText.includes('Sign in') && !document.body.innerText.includes('Log in')")
        if is_logged_in:
            logger.info("Logged in via saved cookies!")
            return
    logger.info("MANUAL LOGIN NEEDED")
    page.goto("https://theresanaiforthat.com/login/", wait_until="domcontentloaded")
    try:
        page.wait_for_selector("input[type='email']", timeout=10000)
        page.fill("input[type='email']", EMAIL)
        page.fill("input[type='password']", PASSWORD)
    except Exception:
        pass
    input("\n>>> Press ENTER after you've logged in... ")
    save_cookies(context, COOKIES_FILE)

# ==========================================
# FIND THE GENERATED IMAGE URL (using JavaScript)
# ==========================================
def find_generated_image_url(page):
    """
    Uses JavaScript to scan ALL images on the page, 
    find the LARGEST one by pixel dimensions.
    The generated comic image is always the biggest image on the page.
    Filters out SVGs, icons, logos, tiny images.
    Returns the src URL of the largest image.
    """
    result = page.evaluate("""
        () => {
            const imgs = document.querySelectorAll('img');
            let bestUrl = null;
            let bestArea = 0;
            
            for (const img of imgs) {
                const src = img.src || '';
                if (src.includes('.svg') || src.includes('logo') || src.includes('icon') || src.includes('avatar') || src.includes('emoji') || src.includes('favicon')) continue;
                if (!src.startsWith('http') && !src.startsWith('blob') && !src.startsWith('data')) continue;
                
                const rect = img.getBoundingClientRect();
                const w = rect.width;
                const h = rect.height;
                const area = w * h;
                
                // Only consider images bigger than 200x200 VISIBLE pixels on screen
                if (w > 200 && h > 200 && area > bestArea) {
                    bestArea = area;
                    bestUrl = src;
                }
            }
            return { url: bestUrl, area: bestArea };
        }
    """)
    return result

# ==========================================
# CORE: GENERATE & DOWNLOAD
# ==========================================
def generate_one_image(page, prompt, file_number):
    """
    1. Navigate to tool
    2. Fill prompt, set 16:9
    3. Click Generate
    4. Poll until "Download" link appears (= image ready)
    5. Use JavaScript to find the biggest image (= generated result)
    6. Open that URL in new tab -> download -> save as {number}.png
    """
    logger.info(f"Navigating to tool...")
    page.goto(TOOL_URL, wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    random_delay(2, 3)

    try:
        # Community warning modal
        agree_btn = page.locator("#agree_community_tools_tos")
        if agree_btn.count() > 0 and agree_btn.is_visible():
            agree_btn.click()
            logger.info("Dismissed community warning.")
            random_delay(1, 2)

        # Fill prompt
        page.wait_for_selector("textarea#user_input", state="visible", timeout=10000)
        page.locator("textarea#user_input").click()
        page.keyboard.press("Control+A")
        page.keyboard.press("Backspace")
        random_delay(0.5, 1)
        page.fill("textarea#user_input", prompt)
        logger.info(f"Prompt: {prompt[:50]}...")
        random_delay(1, 2)

        # Aspect ratio 16:9
        try:
            page.locator("select#aspect_ratio").select_option(label="Landscape(16:9)")
            logger.info("Aspect ratio: 16:9")
        except Exception:
            pass
        random_delay(0.5, 1)

        # Click Generate
        gen_btn = page.locator("button#generate")
        gen_btn.click()
        logger.info("Generate clicked! Waiting...")
        start_time = time.time()

        # ---- POLL until image is ready ----
        while True:
            elapsed = time.time() - start_time

            if elapsed > GENERATION_TIMEOUT_SEC:
                logger.warning(f">{GENERATION_TIMEOUT_SEC}s timeout. Aborting.")
                return False

            # Check for "Download" link (appears only after image generated)
            download_link = page.locator("span:has-text('Download')")
            if download_link.count() > 0 and download_link.first.is_visible():
                logger.info(f"Image ready in {elapsed:.0f}s!")
                break

            # Also check button text
            try:
                btn_text = gen_btn.inner_text()
                if elapsed > 8 and "Generat" not in btn_text and "generat" not in btn_text.lower():
                    # Button stopped saying "Generating" — might be done
                    time.sleep(3)
                    break
            except Exception:
                pass

            time.sleep(2)

        # ---- Extra wait for image to fully render ----
        logger.info("Waiting 5s for image to fully load...")
        time.sleep(5)
        
        # ---- Scroll to make sure image is visible ----
        page.evaluate("window.scrollTo(0, 0)")
        random_delay(1, 2)

        # ---- CLICK DOWNLOAD BUTTON ----
        try:
            # The user provided screenshot shows "Download" button next to "Public"
            download_btn = page.locator("a:has-text('Download'), button:has-text('Download'), span:has-text('Download')").first
            
            if download_btn.is_visible():
                logger.info("Clicking the Download button...")
                with page.expect_download(timeout=30000) as download_info:
                    download_btn.click()
                
                download = download_info.value
                filepath = os.path.join(OUTPUT_DIR, f"{file_number}.png")
                download.save_as(filepath)
                
                size_kb = os.path.getsize(filepath) / 1024
                logger.info(f"SUCCESS! {file_number}.png saved ({size_kb:.0f} KB)")
                return True
            else:
                logger.error("Download button not visible! Capturing debug screenshot.")
                page.screenshot(path=os.path.join(OUTPUT_DIR, f"debug_{file_number}.png"), full_page=True)
                return False
        except Exception as e:
            logger.error(f"Download failed: {e}")
            page.screenshot(path=os.path.join(OUTPUT_DIR, f"debug_{file_number}.png"), full_page=True)
            return False

    except PlaywrightTimeoutError:
        logger.error("Timeout.")
        return False
    except Exception as e:
        logger.error(f"Error: {e}")
        return False

# ==========================================
# PROXY FETCHING & FAILOVER
# ==========================================
def fetch_webshare_proxies(api_key):
    """Fetch free proxies from Webshare.io API."""
    if not api_key:
        return []
    try:
        url = "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=25"
        req = urllib.request.Request(url, headers={"Authorization": f"Token {api_key}"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        proxies = []
        for p in data.get("results", []):
            proxy_url = f"http://{p['username']}:{p['password']}@{p['proxy_address']}:{p['port']}"
            proxies.append(proxy_url)
            logger.info(f"Webshare proxy: {p['proxy_address']}:{p['port']} ({p.get('country_code','??')})")
        logger.info(f"Fetched {len(proxies)} proxies from Webshare")
        return proxies
    except Exception as e:
        logger.warning(f"Webshare fetch failed: {e}")
        return []


def get_proxy_pool():
    """Build proxy pool from Webshare API + manual list."""
    pool = []
    if WEBSHARE_API_KEY:
        pool.extend(fetch_webshare_proxies(WEBSHARE_API_KEY))
    pool.extend(MANUAL_PROXIES)
    if pool:
        logger.info(f"Proxy pool ready: {len(pool)} proxies available")
    else:
        logger.info("No proxies configured — using direct connection")
    return pool


def test_proxy(browser, proxy_url):
    """Quick test if a proxy works by loading a simple page."""
    try:
        ctx = browser.new_context(proxy={'server': proxy_url})
        page = ctx.new_page()
        page.goto("https://httpbin.org/ip", timeout=15000)
        ip = page.inner_text("body")
        ctx.close()
        logger.info(f"Proxy OK: {proxy_url} -> {ip.strip()[:50]}")
        return True
    except Exception as e:
        logger.warning(f"Proxy FAILED: {proxy_url} -> {e}")
        try:
            ctx.close()
        except:
            pass
        return False


def assign_proxies_to_accounts(accounts, proxy_pool):
    """Assign unique proxy to each account. Auto failover: if one fails, try next."""
    assigned = []
    used = set()
    for acct in accounts:
        if acct.get("proxy"):
            # Already has manually assigned proxy
            assigned.append(acct)
            continue
        # Find an unused proxy from pool
        proxy_assigned = None
        for proxy in proxy_pool:
            if proxy not in used:
                proxy_assigned = proxy
                used.add(proxy)
                break
        acct["proxy"] = proxy_assigned
        assigned.append(acct)
    return assigned


# ==========================================
# MAIN
# ==========================================
def create_context(browser, proxy_server=None):
    """Create a browser context with optional proxy."""
    ctx_opts = {
        'viewport': {'width': 1920, 'height': 1080},
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'locale': 'en-US',
        'accept_downloads': True,
    }
    if proxy_server:
        ctx_opts['proxy'] = {'server': proxy_server}
        logger.info(f"Context proxy: {proxy_server}")
    context = browser.new_context(**ctx_opts)
    context.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
    return context


def run_single_account(browser, cookies_file, output_dir, proxy_server=None, backup_proxies=None, label="Default"):
    """Run automation for a single account with proxy + auto failover."""
    ensure_dir(output_dir)
    logger.info(f"\n{'='*50}")
    logger.info(f"ACCOUNT: {label}")
    logger.info(f"Cookies: {cookies_file}")
    logger.info(f"Proxy: {proxy_server or 'Direct'}")
    logger.info(f"Output: {output_dir}")
    logger.info(f"{'='*50}")

    # Auto failover: try primary proxy, if fails try backups
    proxies_to_try = [proxy_server] if proxy_server else [None]
    if backup_proxies:
        proxies_to_try.extend(backup_proxies)

    context = None
    page = None
    for px in proxies_to_try:
        try:
            context = create_context(browser, px)
            page = context.new_page()

            # Load cookies
            if os.path.exists(cookies_file):
                with open(cookies_file, "r") as f:
                    cookies = json.load(f)
                context.add_cookies(normalize_cookies(cookies))
                logger.info(f"Loaded {len(cookies)} cookies")

            # Navigate to domain first to ensure cookies are active
            page.goto("https://theresanaiforthat.com/", wait_until="domcontentloaded", timeout=30000)
            random_delay(2, 3)

            page.goto(TOOL_URL, wait_until="domcontentloaded", timeout=30000)
            random_delay(2, 3)

            if "login" in page.url or "signin" in page.url:
                logger.warning(f"[{label}] Not logged in! Check cookies.")
                context.close()
                return 0, 0

            logger.info(f"[{label}] Connected OK via {'proxy ' + px if px else 'direct'}")
            break  # Success! Use this connection

        except Exception as e:
            logger.warning(f"[{label}] Proxy {px} failed: {e}")
            if context:
                try: context.close()
                except: pass
            context = None
            page = None
            continue

    if not page:
        logger.error(f"[{label}] All proxies failed! Skipping.")
        return 0, 0

    try:
        # Get next file number for this output dir
        existing = glob.glob(os.path.join(output_dir, "*.png"))
        numbers = []
        for f_path in existing:
            try:
                numbers.append(int(os.path.basename(f_path).replace(".png", "")))
            except ValueError:
                pass
        file_num = max(numbers, default=0) + 1

        total = len(PROMPTS)
        ok = 0
        fail = 0

        for idx, prompt in enumerate(PROMPTS, 1):
            logger.info(f"\n[{label}] PROMPT {idx}/{total} -> {file_num}.png")

            success = False
            for attempt in range(MAX_RETRIES + 1):
                if attempt > 0:
                    logger.info(f"Retry #{attempt}...")
                    random_delay(3, 5)
                global OUTPUT_DIR
                old_output = OUTPUT_DIR
                OUTPUT_DIR = output_dir
                success = generate_one_image(page, prompt, file_num)
                OUTPUT_DIR = old_output
                if success:
                    break

            if success:
                ok += 1
                file_num += 1
            else:
                fail += 1
                logger.error(f"[{label}] Prompt #{idx} FAILED.")

            if idx < total:
                w = random.uniform(*WAIT_BETWEEN_PROMPTS)
                logger.info(f"Wait {w:.0f}s...")
                time.sleep(w)

        save_cookies(context, cookies_file)
        logger.info(f"[{label}] DONE! Success: {ok}/{total}, Failed: {fail}/{total}")
        return ok, fail

    except Exception as e:
        logger.error(f"[{label}] Error: {e}")
        return 0, 0
    finally:
        if context:
            context.close()


def main():
    logger.info("=" * 50)
    logger.info("TAAFT Comic Automation — Proxy Edition")
    logger.info(f"Prompts: {len(PROMPTS)}")
    logger.info("=" * 50)

    # Step 1: Build proxy pool (Webshare API + manual list)
    proxy_pool = get_proxy_pool()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=HEADLESS,
            args=["--disable-blink-features=AutomationControlled"]
        )

        try:
            if ACCOUNTS:
                # MULTI-ACCOUNT MODE
                # Auto-assign proxies from pool to accounts that don't have one
                accounts = assign_proxies_to_accounts(ACCOUNTS.copy(), proxy_pool)

                logger.info(f"\nChapter-Account Mapping:")
                for i, acct in enumerate(accounts):
                    logger.info(f"  {acct['label']} -> Proxy: {acct.get('proxy','Direct')} | Cookie: {acct.get('cookies_file')}")

                total_ok, total_fail = 0, 0
                for acct in accounts:
                    base = os.path.dirname(os.path.abspath(__file__))
                    # Build backup proxy list (all other proxies)
                    acct_proxy = acct.get("proxy")
                    backups = [px for px in proxy_pool if px != acct_proxy]

                    ok, fail = run_single_account(
                        browser,
                        cookies_file=os.path.join(base, acct.get("cookies_file", COOKIES_FILE)),
                        output_dir=os.path.join(base, acct.get("output_dir", "taaft_comic_output")),
                        proxy_server=acct_proxy,
                        backup_proxies=backups,
                        label=acct.get("label", "Account")
                    )
                    total_ok += ok
                    total_fail += fail
                logger.info(f"\nALL DONE! Total: {total_ok} ok, {total_fail} failed")
            else:
                # SINGLE-ACCOUNT MODE (use first proxy from pool or direct)
                proxy = proxy_pool[0] if proxy_pool else None
                backups = proxy_pool[1:] if len(proxy_pool) > 1 else []
                run_single_account(
                    browser,
                    cookies_file=COOKIES_FILE,
                    output_dir=OUTPUT_DIR,
                    proxy_server=proxy,
                    backup_proxies=backups,
                    label="Default"
                )

        except KeyboardInterrupt:
            logger.warning("Stopped by user.")
        except Exception as e:
            logger.critical(f"Fatal: {e}")
        finally:
            browser.close()


if __name__ == "__main__":
    main()


