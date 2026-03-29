"""
AUTO TIMELINE — Backend Server
Flask API + async Playwright engine for TAAFT image generation.
Supports 1 Browser with 4 parallel tabs (contexts) and proxy fetching.
"""

import os
import sys
import json
import time
import glob
import base64
import logging
import threading
import traceback
import asyncio
from datetime import datetime
from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS

try:
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    print("WARNING: Playwright not installed. pip install playwright && playwright install chromium")

# ==========================================
# CONFIGURATION
# ==========================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
OUTPUT_BASE = os.path.join(PROJECT_DIR, "generated_images")
COOKIES_DIR = os.path.join(PROJECT_DIR, "cookies")
LOG_FILE = os.path.join(PROJECT_DIR, "backend_server.log")
TOOL_URL = "https://theresanaiforthat.com/@niltonjr/epic-comic-book-portrait-in-striking-detail/"
HEADLESS = True  # Keep false to see the 4 tabs running
PORT = 5050
NUM_TABS = 4  # 4 Parallel processing tabs
USE_FREE_PROXIES = False  # Set to True to fetch and use free proxies (often unstable)

# ==========================================
# LOGGING
# ==========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ==========================================
# FLASK APP & STATE
# ==========================================
app = Flask(__name__, static_folder='.', static_url_path='/static')
CORS(app)

engine_state = {
    "status": "idle",
    "current_chapter": None,
    "current_prompt_index": -1,
    "chapters": {},
    "activity_log": [],
    "browser_ready": False,
    "start_time": None,
}

browser_instance = {
    "playwright": None,
    "browser": None,
    "contexts": {},  # Keep track of active validation contexts
}

state_lock = threading.Lock()

# ==========================================
# ASYNC PLAYWRIGHT EVENT LOOP
# ==========================================
pw_loop = None
pw_thread = None
pw_thread_ready = threading.Event()

def pw_worker():
    global pw_loop
    pw_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(pw_loop)
    pw_thread_ready.set()
    logger.info("Asyncio Playwright loop started.")
    try:
        pw_loop.run_forever()
    except Exception as e:
        logger.error(f"Event loop crashed: {e}")

def run_on_pw_thread(coro_fn, *args, timeout=300):
    """Run an async function on the pw_loop and wait for the result."""
    if not pw_loop:
        raise Exception("Playwright engine is not running!")
    future = asyncio.run_coroutine_threadsafe(coro_fn(*args), pw_loop)
    return future.result(timeout=timeout)

def start_pw_thread():
    global pw_thread, pw_loop
    if pw_thread and pw_thread.is_alive():
        return
    pw_thread_ready.clear()
    pw_thread = threading.Thread(target=pw_worker, daemon=True, name="PlaywrightAsyncThread")
    pw_thread.start()
    pw_thread_ready.wait(timeout=5)

# ==========================================
# HELPERS
# ==========================================
def ensure_dir(d):
    os.makedirs(d, exist_ok=True)

def add_log(msg_type, message, chapter_id=None):
    with state_lock:
        timestamp_sec = time.time()
        # Formatted time for frontend
        formatted_time = datetime.fromtimestamp(timestamp_sec).strftime("%H:%M")
        
        entry = {
            "timestamp": timestamp_sec,
            "time": formatted_time, # Added this to fix "undefined" in frontend
            "type": msg_type.upper(),
            "message": message,
            "chapter_id": chapter_id,
        }
        engine_state["activity_log"].append(entry)
        if len(engine_state["activity_log"]) > 500:
            engine_state["activity_log"] = engine_state["activity_log"][-500:]
            
    log_msg = f"[{msg_type.upper()}] {message}"
    if msg_type.lower() == "error": logger.error(log_msg)
    elif msg_type.lower() == "warning": logger.warning(log_msg)
    else: logger.info(log_msg)

# ==========================================
# COOKIE MANAGEMENT
# ==========================================
def validate_cookie_data(cookie_string):
    try:
        data = json.loads(cookie_string)
        if isinstance(data, list): return data
        elif isinstance(data, dict): return [data]
    except: pass
    c = str(cookie_string).strip()
    if c:
        return [{"name": "token", "value": c, "domain": ".theresanaiforthat.com", "path": "/", "secure": True}]
    return None

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

# ==========================================
# ASYNC PLAYWRIGHT LOGIC
# ==========================================

async def _init_browser_async():
    if not PLAYWRIGHT_AVAILABLE: return False
    if browser_instance["browser"]: return True
    
    try:
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(
            headless=HEADLESS,
            args=["--disable-blink-features=AutomationControlled"]
        )
        browser_instance["playwright"] = pw
        browser_instance["browser"] = browser
        engine_state["browser_ready"] = True
        add_log("success", "Browser engine started successfully!")
        return True
    except Exception as e:
        add_log("error", f"Failed to start browser: {e}")
        return False

async def _fetch_proxies(count=10):
    add_log("info", "Fetching free proxies from GitHub...")
    if not browser_instance["playwright"]: return []
    try:
        # Use playwright APIRequest to fetch directly
        ctx = await browser_instance["playwright"].request.new_context()
        resp = await ctx.get("https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt", timeout=10000)
        text = await resp.text()
        await ctx.dispose()
        
        proxies = [p.strip() for p in text.split('\n') if p.strip()]
        add_log("info", f"Fetched {len(proxies)} proxies. Using top {count}.")
        return proxies[:count]
    except Exception as e:
        add_log("warning", f"Failed to fetch proxies: {e}")
        return []

async def _verify_login(page):
    try:
        await page.goto(TOOL_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)
        if "login" in page.url or "signin" in page.url:
            return False
        return True
    except:
        return False

async def _find_image_url(page):
    return await page.evaluate("""
        () => {
            const imgs = document.querySelectorAll('img');
            let bestUrl = null; let bestArea = 0;
            for (const img of imgs) {
                const src = img.src || '';
                if (src.includes('.svg') || src.includes('logo') || src.includes('icon')) continue;
                if (!src.startsWith('http') && !src.startsWith('blob') && !src.startsWith('data')) continue;
                const rect = img.getBoundingClientRect();
                const area = rect.width * rect.height;
                if (rect.width > 200 && area > bestArea) { bestArea = area; bestUrl = src; }
            }
            return { url: bestUrl, area: bestArea };
        }
    """)

async def _generate_single_image(page, prompt, output_dir, file_number, chapter_id, prompt_index, tab_id, model_url=None):
    start_time = time.time()
    url_to_use = model_url if model_url else TOOL_URL
    if url_to_use and not url_to_use.startswith("http"):
        # Handle cases where user might only provide the slug or @user/slug
        if url_to_use.startswith("@"):
            url_to_use = f"https://theresanaiforthat.com/{url_to_use}"
        else:
            url_to_use = f"https://theresanaiforthat.com/{url_to_use}"
    
    try:
        await page.goto(url_to_use, wait_until="domcontentloaded", timeout=45000)
        try: await page.wait_for_load_state("networkidle", timeout=5000)
        except: pass
        
        # Dismiss warnings
        agree_btn = page.locator("#agree_community_tools_tos")
        if await agree_btn.count() > 0 and await agree_btn.is_visible():
            await agree_btn.click()
            await asyncio.sleep(0.5)
            
        # Fill prompt
        await page.locator("textarea#user_input").click(timeout=10000)
        await page.keyboard.press("Control+A")
        await page.keyboard.press("Backspace")
        await page.fill("textarea#user_input", prompt)
        
        # 16:9
        try:
            await page.locator("select#aspect_ratio").select_option(label="Landscape(16:9)", timeout=2000)
        except: pass
        
        # Generate
        await page.locator("button#generate").click()
        add_log("info", f"[Tab {tab_id}] Generating: {prompt[:30]}...", chapter_id)
        gen_start = time.time()
        
        max_wait = 120
        while True:
            elapsed = time.time() - gen_start
            if elapsed > max_wait:
                add_log("warning", f"[Tab {tab_id}] Generate timeout.", chapter_id)
                return "TIMEOUT", None, time.time() - start_time
                
            dl_link = page.locator("span:has-text('Download')")
            if await dl_link.count() > 0 and await dl_link.first.is_visible():
                break
                
            # Smart retry: if > 45s, probably stuck in TAAFT
            if elapsed > 45:
                add_log("warning", f"[Tab {tab_id}] Image stuck at {elapsed:.0f}s. Will refresh.", chapter_id)
                return "RETRY_STUCK", None, time.time() - start_time
                
            await asyncio.sleep(2)
            
        # ---- CLICK DOWNLOAD BUTTON ----
        filepath = os.path.join(output_dir, f"{file_number}.png")
        try:
            # Look for the "Download" button in the button group shown in screenshot
            # It's usually a link or button with text "Download"
            download_btn = page.locator("a:has-text('Download'), button:has-text('Download'), span:has-text('Download')").first
            
            if await download_btn.is_visible():
                add_log("info", f"[Tab {tab_id}] Clicking Download button...", chapter_id)
                async with page.expect_download(timeout=30000) as download_info:
                    await download_btn.click()
                download = await download_info.value
                await download.save_as(filepath)
            else:
                # Fallback to the old method if button not found
                add_log("warning", f"[Tab {tab_id}] Download button not visible. Trying URL fallback.", chapter_id)
                res = await _find_image_url(page)
                img_url = res.get("url")
                if img_url:
                    resp = await page.request.get(img_url, timeout=30000)
                    img_bytes = await resp.body()
                    with open(filepath, "wb") as f:
                        f.write(img_bytes)
                else:
                    return False, None, time.time() - start_time
        except Exception as e:
            add_log("error", f"[Tab {tab_id}] Download failed: {e}", chapter_id)
            return False, None, time.time() - start_time
            
        if os.path.getsize(filepath) > 5000:
            add_log("success", f"[Tab {tab_id}] Saved {file_number}.png in {time.time()-start_time:.1f}s", chapter_id)
            return True, filepath, time.time() - start_time
        return False, None, time.time() - start_time
        
    except PlaywrightTimeoutError:
        add_log("error", f"[Tab {tab_id}] Page timeout (proxy slow?).", chapter_id)
        return "PROXY_FAIL", None, time.time() - start_time
    except Exception as e:
        add_log("error", f"[Tab {tab_id}] Error: {e}", chapter_id)
        return False, None, time.time() - start_time

async def _process_chapter_coro(chapter_data):
    chapter_id = chapter_data["id"]
    chapter_name = chapter_data.get("name", f"CH {chapter_id}")
    prompts = chapter_data.get("prompts", [])
    cookie_data = chapter_data.get("cookie_data")
    max_retries = chapter_data.get("max_retries", 2)
    model_url = chapter_data.get("model_url")
    
    # State update
    with state_lock:
        engine_state["chapters"][chapter_id] = {
            "status": "running", "total_prompts": len(prompts), "current_prompt": 0,
            "success_count": 0, "failed_count": 0, "prompt_times": [],
            "prompt_results": [], "start_time": time.time(),
            "estimated_remaining": None
        }
        engine_state["status"] = "running"
        engine_state["current_chapter"] = chapter_id
        
    out_dir = os.path.join(OUTPUT_BASE, chapter_name.replace(" ", "_"))
    ensure_dir(out_dir)
    
    # Queue setup
    prompt_q = asyncio.Queue()
    for idx, p in enumerate(prompts):
        await prompt_q.put({"idx": idx, "text": p if isinstance(p, str) else p.get("text", "")})
        
    file_num_counter = max([int(os.path.splitext(f)[0]) for f in os.listdir(out_dir) if f.endswith('.png')] + [0]) + 1
    
    # Fetch Proxies
    proxies = await _fetch_proxies(count=NUM_TABS + 5) if USE_FREE_PROXIES else []
    
    # Load all 4 saved accounts to use one per tab
    acc_pool = []
    for i in range(1, 5):
        try:
            p = os.path.join(COOKIES_DIR, f"cookie_acc{i}.json")
            if os.path.exists(p):
                with open(p, "r") as f: acc_pool.append(json.load(f))
        except: pass
    
    contexts = []
    add_log("info", f"Initializing {NUM_TABS} parallel tabs with {len(acc_pool)} accounts...", chapter_id)
    for i in range(NUM_TABS):
        proxy = {"server": f"http://{proxies[i]}"} if i < len(proxies) else None
        # Use a different account for each tab if possible
        current_acc = acc_pool[i % len(acc_pool)] if acc_pool else cookie_data
        norm_cookies = normalize_cookies(current_acc)
        
        try:
            ctx = await browser_instance["browser"].new_context(
                proxy=proxy,
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            )
            # Spoof navigator.webdriver
            await ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            
            if norm_cookies: 
                await ctx.add_cookies(norm_cookies)
            
            page = await ctx.new_page()
            
            # Navigate to domain and wait to ensure cookies stick
            await page.goto("https://theresanaiforthat.com/", wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(2)
            
            # Verify login status
            is_logged_in = await page.evaluate("() => !document.body.innerText.includes('Sign in') && !document.body.innerText.includes('Log in')")
            if not is_logged_in:
                add_log("warning", f"[Tab {i+1}] Login verification failed! Re-attempting cookies.", chapter_id)
                # Sometimes navigating directly to login page triggers it
                await page.goto("https://theresanaiforthat.com/login/", timeout=30000)
                if norm_cookies: await ctx.add_cookies(norm_cookies)
                await page.goto("https://theresanaiforthat.com/", timeout=30000)

            contexts.append({"id": i+1, "ctx": ctx, "page": page, "proxy": proxy})
        except Exception as e:
            add_log("error", f"Failed to create Tab {i+1}: {e}", chapter_id)
            
    if not contexts:
        add_log("error", "No tabs could be created. Aborting.", chapter_id)
        with state_lock: engine_state["chapters"][chapter_id]["status"] = "error"
        return
        
    add_log("success", f"Processing {len(prompts)} prompts across {len(contexts)} tabs!", chapter_id)
    
    async def worker_task(tab):
        nonlocal file_num_counter
        while not prompt_q.empty():
            with state_lock:
                if engine_state["chapters"][chapter_id].get("status") in ("paused", "stopped"):
                    break
            
            job = await prompt_q.get()
            idx, text = job["idx"], job["text"]
            
            with state_lock:
                engine_state["chapters"][chapter_id]["current_prompt"] = idx
                
            success = False
            image_path = None
            prompt_time = 0
            
            # retry loop
            for attempt in range(max_retries + 1):
                f_num = file_num_counter
                file_num_counter += 1
                
                res, path, t = await _generate_single_image(tab["page"], text, out_dir, f_num, chapter_id, idx, tab["id"], model_url=model_url)
                prompt_time = t
                
                if res is True:
                    success = True
                    image_path = path
                    break
                elif res == "RETRY_STUCK":
                    # Stuck in generation. Refresh the page!
                    try: await tab["page"].reload(wait_until="domcontentloaded")
                    except: pass
                    continue
                elif res == "PROXY_FAIL":
                    # Proxy is dead. Maybe try to use a new proxy? For now just retry.
                    continue
                else:
                    break
                    
            # update results
            with state_lock:
                ch = engine_state["chapters"][chapter_id]
                ch["prompt_results"].append({
                    "index": idx, "prompt": text, "status": "success" if success else "failed",
                    "time_taken": prompt_time, "image_path": image_path,
                    "image_filename": os.path.basename(image_path) if image_path else None
                })
                ch["prompt_times"].append(prompt_time)
                if success: ch["success_count"] += 1
                else: ch["failed_count"] += 1
                
                avg_time = sum(ch["prompt_times"]) / len(ch["prompt_times"])
                # Since 4 parallel tabs, ETA is remaining / 4
                remain = ch["total_prompts"] - (ch["success_count"] + ch["failed_count"])
                ch["estimated_remaining"] = (avg_time * remain) / len(contexts)
                
            prompt_q.task_done()

    # Run 4 workers concurrently
    tasks = [asyncio.create_task(worker_task(c)) for c in contexts]
    await asyncio.gather(*tasks)
    
    # Cleanup
    for c in contexts:
        try: await c["ctx"].close()
        except: pass

    with state_lock:
        ch = engine_state["chapters"][chapter_id]
        ch["status"] = "done"
        ch["end_time"] = time.time()
        engine_state["status"] = "idle"
        engine_state["current_chapter"] = None
        
    total_t = ch["end_time"] - ch["start_time"]
    add_log("success", f"Chapter DONE! Time: {total_t:.0f}s", chapter_id)

# ==========================================
# API ROUTES
# ==========================================
@app.route('/')
def serve_index(): return send_file(os.path.join(BASE_DIR, 'index.html'))
@app.route('/style.css')
def serve_css(): return send_file(os.path.join(BASE_DIR, 'style.css'))
@app.route('/script.js')
def serve_js(): return send_file(os.path.join(BASE_DIR, 'script.js'))

@app.route('/api/status')
def api_status():
    with state_lock:
        return jsonify({
            "engine_status": engine_state["status"],
            "browser_ready": engine_state["browser_ready"],
            "current_chapter": engine_state["current_chapter"],
            "playwright_available": PLAYWRIGHT_AVAILABLE,
        })

@app.route('/api/engine/start', methods=['POST'])
def api_engine_start():
    start_pw_thread()
    success = run_on_pw_thread(_init_browser_async)
    return jsonify({"success": success})

@app.route('/api/cookies', methods=['GET'])
def api_get_cookies():
    # Return directly from the files created by setup
    cookies = []
    for f in glob.glob(os.path.join(COOKIES_DIR, "cookie_*.json")):
        cid = os.path.basename(f).replace("cookie_", "").replace(".json", "")
        try:
            with open(f, 'r') as fh: data = json.load(fh)
            cookies.append({"id": cid, "label": f"Account {cid.replace('acc', '')}", "value": json.dumps(data), "status": "not verified"})
        except: pass
    return jsonify(cookies)

@app.route('/api/cookies', methods=['POST'])
def api_add_cookie():
    return jsonify({"success": True})

@app.route('/api/cookies/validate/<cookie_id>', methods=['POST'])
def api_validate_cookie(cookie_id):
    start_pw_thread()
    fpath = os.path.join(COOKIES_DIR, f"cookie_{cookie_id}.json")
    if not os.path.exists(fpath): return jsonify({"success": False})
    with open(fpath, "r") as f: cookie_data = json.load(f)
    
    async def _do_validate():
        if not browser_instance["browser"]: await _init_browser_async()
        ctx = await browser_instance["browser"].new_context()
        if cookie_data: await ctx.add_cookies(normalize_cookies(cookie_data))
        page = await ctx.new_page()
        res = await _verify_login(page)
        await ctx.close()
        return res
        
    try:
        ok = run_on_pw_thread(_do_validate)
        return jsonify({"success": ok, "message": "Valid" if ok else "Invalid"})
    except: return jsonify({"success": False})

@app.route('/api/chapter/start', methods=['POST'])
def api_start_chapter():
    data = request.json
    start_pw_thread()
    # We submit the async job to run in background. We do not wait for it.
    asyncio.run_coroutine_threadsafe(_process_chapter_coro(data), pw_loop)
    return jsonify({"success": True, "chapter_id": data.get("id")})

@app.route('/api/chapters/status')
def api_all_chapters_status():
    with state_lock:
        res = {}
        for cid, ch in engine_state["chapters"].items():
            elapsed = time.time() - ch["start_time"] if ch.get("start_time") else 0
            avg = sum(ch["prompt_times"])/len(ch["prompt_times"]) if ch["prompt_times"] else 0
            res[cid] = {
                "status": ch["status"], "total": ch["total_prompts"], "current": ch["current_prompt"],
                "success": ch["success_count"], "failed": ch["failed_count"],
                "elapsed": elapsed, "avg_per_prompt": avg,
                "eta": ch.get("estimated_remaining", 0), "results": ch.get("prompt_results", [])
            }
        return jsonify(res)

@app.route('/api/logs')
def api_logs():
    since = request.args.get("since", 0, type=float)
    with state_lock: return jsonify([l for l in engine_state["activity_log"] if l["timestamp"] > since])

@app.route('/api/images/<chapter_name>/<filename>')
def api_serve_image(chapter_name, filename):
    return send_from_directory(os.path.join(OUTPUT_BASE, chapter_name), filename)

@app.route('/api/images/<chapter_name>')
def api_list_images(chapter_name):
    img_dir = os.path.join(OUTPUT_BASE, chapter_name)
    if not os.path.exists(img_dir): return jsonify([])
    imgs = []
    for f in sorted(glob.glob(os.path.join(img_dir, "*.png"))):
        imgs.append({"filename": os.path.basename(f), "size_kb": round(os.path.getsize(f)/1024,1), "url": f"/api/images/{chapter_name}/{os.path.basename(f)}"})
    return jsonify(imgs)

@app.route('/api/chapter/<chapter_id>/pause', methods=['POST'])
def api_pause_chapter(chapter_id):
    with state_lock:
        if chapter_id in engine_state["chapters"]: engine_state["chapters"][chapter_id]["status"] = "paused"
    return jsonify({"success": True})

@app.route('/api/chapter/<chapter_id>/stop', methods=['POST'])
def api_stop_chapter(chapter_id):
    with state_lock:
        if chapter_id in engine_state["chapters"]: engine_state["chapters"][chapter_id]["status"] = "stopped"
    return jsonify({"success": True})

if __name__ == '__main__':
    ensure_dir(OUTPUT_BASE)
    ensure_dir(COOKIES_DIR)
    start_pw_thread()
    print(f"\n>>> Server starting at http://localhost:{PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
