import json
import os

COOKIES_DIR = r"c:\Users\kunal\OneDrive\Desktop\TRAAFT TEST\cookies"
os.makedirs(COOKIES_DIR, exist_ok=True)

acc1 = [
    {
        "domain": ".theresanaiforthat.com",
        "expirationDate": 1803789521.766868,
        "hostOnly": False,
        "httpOnly": False,
        "name": "token",
        "path": "/",
        "sameSite": None,
        "secure": True,
        "session": False,
        "storeId": None,
        "value": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjo5NDAxMzQ1LCJleHAiOjE4MDM3ODk0OTV9.vXPOStZ2Z3PjyAXTKr6hPeGYYwcDsZKCQD4bp2y-jqU"
    }
]

acc2 = [
    {
        "domain": ".theresanaiforthat.com",
        "expirationDate": 1802235317.27192,
        "hostOnly": False,
        "httpOnly": False,
        "name": "token",
        "path": "/",
        "sameSite": None,
        "secure": True,
        "session": False,
        "storeId": None,
        "value": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjo5MTYxNDc5LCJleHAiOjE4MDIyMzUzMDV9.8SXg0FcnoLsVfW5JA9foO8dZqqlSs_w6Ki3atXGidH4"
    }
]

acc3 = [
    {
        "domain": ".theresanaiforthat.com",
        "expirationDate": 1787890912.650226,
        "hostOnly": False,
        "httpOnly": False,
        "name": "token",
        "path": "/",
        "sameSite": None,
        "secure": True,
        "session": False,
        "storeId": None,
        "value": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjo1Mzc2Nzc1LCJleHAiOjE4MDM4NzQ4ODV9.spVbKOjYJZQMBhcPGaBFVy0H-oZime6ESR_XFngKRP8"
    }
]

acc4 = [
    {
        "domain": ".theresanaiforthat.com",
        "expirationDate": 1798111149.732718,
        "hostOnly": False,
        "httpOnly": False,
        "name": "token",
        "path": "/",
        "sameSite": None,
        "secure": True,
        "session": False,
        "storeId": None,
        "value": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjo4NDc0MTQxLCJleHAiOjE3OTgxMTExNDB9.Bg-4qr8veh5p9nXSyJLY4Yi_ujkFd3ShA-VD4cSmAeI"
    }
]

with open(os.path.join(COOKIES_DIR, "cookie_acc1.json"), "w") as f: json.dump(acc1, f)
with open(os.path.join(COOKIES_DIR, "cookie_acc2.json"), "w") as f: json.dump(acc2, f)
with open(os.path.join(COOKIES_DIR, "cookie_acc3.json"), "w") as f: json.dump(acc3, f)
with open(os.path.join(COOKIES_DIR, "cookie_acc4.json"), "w") as f: json.dump(acc4, f)

print("Saved all 4 accounts.")
