import os
import time
import json
from playwright.sync_api import sync_playwright

COOKIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "taaft_cookies.json")

def peek():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        if os.path.exists(COOKIES_FILE):
            with open(COOKIES_FILE, "r") as f:
                context.add_cookies(json.load(f))
        page = context.new_page()
        page.goto("https://theresanaiforthat.com/@niltonjr/epic-comic-book-portrait-in-striking-detail/")
        
        # skip community warning
        try:
            page.locator("#agree_community_tools_tos").click(timeout=3000)
        except: pass

        time.sleep(2)
        page.fill("textarea#user_input", "A fast runner")
        page.locator("button#generate").click()
        
        print("Waiting 25 seconds for generation...")
        time.sleep(25)
        
        # get all frames
        results = []
        for frame in page.frames:
            try:
                js = """
                () => {
                    let res = [];
                    let imgs = document.querySelectorAll('img');
                    for (let i = 0; i < imgs.length; i++) {
                        let rect = imgs[i].getBoundingClientRect();
                        res.push({
                            src: imgs[i].src,
                            width: rect.width,
                            height: rect.height,
                            x: rect.x,
                            y: rect.y
                        });
                    }
                    return res;
                }
                """
                imgs = frame.evaluate(js)
                results.extend(imgs)
            except Exception as e:
                pass
                
        # write to file
        with open("taaft_imgs.json", "w") as f:
            json.dump(results, f, indent=2)

if __name__ == "__main__":
    peek()
