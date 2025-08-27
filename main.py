import os
import time
from typing import Optional
import requests
from dotenv import load_dotenv

load_dotenv()

URL = "https://mobil.handledning.dsv.su.se/servlet/GetPersonalQueueStatusServlet"

cookies = input("Dump cookies: ")

cookies_dict = {}
for cookie in cookies.split("; "):
    key, value = cookie.split("=")
    if key != "JSESSIONID":
        continue
    cookies_dict[key] = value

assert "JSESSIONID" in cookies_dict, "JSESSIONID cookie is missing"
assert "PUSHOVER_KEY" in os.environ, "PUSHOVER_KEY is missing"
assert "PUSHOVER_USER" in os.environ, "PUSHOVER_USER is missing"

pushover_key = os.environ["PUSHOVER_KEY"]
pushover_user = os.environ["PUSHOVER_USER"]

def send_notification(token, user, message):
    url = "https://api.pushover.net/1/messages.json"
    data = {"token": token, "user": user, "message": message, "priority": 1, "sound": "gamelan", "ttl": 60*60}
    return requests.post(url, data=data, timeout=5)

failures = 0
last_name: Optional[str] = None
while True:
    time.sleep(1)
    response = requests.get(URL, cookies=cookies_dict, timeout=5, headers={"X-Powered-By": "dsv-tutor-pushover (https://github.com/Edwinexd/dsv-tutor-pushover); Contact (edwinsu@dsv.su.se)"})
    if response.status_code != 200 or "Log in" in response.text:
        print(f"Status code: {response.status_code}, contains 'Log in': {'Log in' in response.text}")
        time.sleep(min(2**failures, 32))
        failures += 1
        continue
    
    if "Du är inte aktiv på någon lista." in response.text:
        print("You are not active on any list")
        break


    failures = 0

    if "Kön är just nu tom" in response.text:
        last_name = None
        continue

    if "Nästa i kön" in response.text:
        name = ' '.join(response.text.split("Nästa i kön")[1].split("</td>")[0].split("<br />")[1].strip().replace("\n", "").split())
        if last_name == name:
            continue
        last_name = name
        send_notification(pushover_key, pushover_user, f"Next in queue: {name}")
        print(f"Next in queue: {name}")
        time.sleep(5)
        continue

    if any(val in response.text for val in ["Du är på väg till", "Du är hos"]):
        # Busy
        time.sleep(3)
        continue

    print("Unknown state, dumping response")
    print(response.text)
    time.sleep(5)

print(response.text)
send_notification(pushover_key, pushover_user, "Bye!")
