import os
import time
from typing import Optional
from datetime import datetime, timedelta
import requests
from dotenv import load_dotenv
from login import mobil_handledning_login, activate_all_lists, daisy_staff_login, daisy_search_student, handledning_login, get_list_info_for_student

load_dotenv()

URL = "https://mobil.handledning.dsv.su.se/servlet/GetPersonalQueueStatusServlet"

assert "SU_USERNAME" in os.environ, "SU_USERNAME is missing"
assert "SU_PASSWORD" in os.environ, "SU_PASSWORD is missing"
assert "PUSHOVER_KEY" in os.environ, "PUSHOVER_KEY is missing"
assert "PUSHOVER_USER" in os.environ, "PUSHOVER_USER is missing"

su_username = os.environ["SU_USERNAME"]
su_password = os.environ["SU_PASSWORD"]
pushover_key = os.environ["PUSHOVER_KEY"]
pushover_user = os.environ["PUSHOVER_USER"]

def send_notification(token, user, message):
    url = "https://api.pushover.net/1/messages.json"
    data = {"token": token, "user": user, "message": message, "priority": 1, "sound": "gamelan", "ttl": 60*60}
    return requests.post(url, data=data, timeout=5)

def calculate_next_retry_time():
    """Calculate next retry time: either next midnight or in 1 hour, whichever comes first"""
    now = datetime.now()

    # Next midnight
    next_midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)

    # In 1 hour
    in_one_hour = now + timedelta(hours=1)

    # Return whichever comes first
    if in_one_hour < next_midnight:
        return in_one_hour, "1 hour"
    else:
        return next_midnight, "midnight"

def wait_until_retry():
    """Wait until next retry time (midnight or 1 hour, whichever comes first)"""
    retry_time, retry_reason = calculate_next_retry_time()

    print(f"Waiting until {retry_time.strftime('%Y-%m-%d %H:%M:%S')} ({retry_reason}) to retry...")

    # Sleep in 10-minute intervals and check if we've reached the target time
    # This handles laptop sleep/wake cycles properly
    while datetime.now() < retry_time:
        remaining = (retry_time - datetime.now()).total_seconds()
        if remaining <= 0:
            break
        # Sleep for at most 10 minutes (600 seconds) at a time
        sleep_duration = min(600, remaining)
        time.sleep(sleep_duration)

# Main loop - runs indefinitely
while True:
    try:
        print("Logging in to mobil.handledning.dsv.su.se...")
        jsessionid = mobil_handledning_login(su_username, su_password)
        print("Successfully logged in!")

        cookies_dict = {"JSESSIONID": jsessionid}

        # Login to Daisy for student lookups
        print("Logging in to Daisy (staff)...")
        daisy_jsessionid = daisy_staff_login(su_username, su_password)
        daisy_cookies = {"JSESSIONID": daisy_jsessionid}
        print("Successfully logged in to Daisy!")

        # Login to desktop handledning for list information
        print("Logging in to handledning.dsv.su.se (desktop)...")
        handledning_jsessionid = handledning_login(su_username, su_password)
        handledning_cookies = {"JSESSIONID": handledning_jsessionid}
        print("Successfully logged in to handledning!")

        # Activate lists immediately on startup
        print("Activating all lists...")
        try:
            activated_count = activate_all_lists(cookies_dict)
            print(f"Activated {activated_count} list(s)")
            if activated_count > 0:
                print("Waiting 3 seconds for activation to take effect...")
                time.sleep(3)
        except Exception as e:
            print(f"Failed to activate lists: {e}")

        last_name: Optional[str] = None
        last_activation_time = time.time()
        ACTIVATION_INTERVAL = 15 * 60  # 15 minutes in seconds

        print("Starting queue monitoring...")
        while True:
            time.sleep(1)

            # Check if it's time to reactivate lists
            current_time = time.time()
            if current_time - last_activation_time >= ACTIVATION_INTERVAL:
                print("Re-activating all lists (15-minute check)...")
                try:
                    activated_count = activate_all_lists(cookies_dict)
                    print(f"Activated {activated_count} list(s)")
                    last_activation_time = current_time
                except Exception as e:
                    print(f"Failed to activate lists (will retry on next check): {e}")

            response = requests.get(URL, cookies=cookies_dict, timeout=5, headers={"X-Powered-By": "dsv-tutor-pushover (https://github.com/Edwinexd/dsv-tutor-pushover); Contact (edwinsu@dsv.su.se)"})

            if "Du är inte aktiv på någon lista." in response.text or "Log in" in response.text:
                if "Du är inte aktiv på någon lista." in response.text:
                    print("You are not active on any list - will retry later")
                else:
                    print("Session invalid (not active on any list) - will retry later")
                wait_until_retry()
                break  # Break inner loop to re-login

            if "Kön är just nu tom" in response.text:
                last_name = None
                continue

            if "Nästa i kön" in response.text:
                full_text = ' '.join(response.text.split("Nästa i kön")[1].split("</td>")[0].split("<br />")[1].strip().replace("\n", "").split())

                if last_name == full_text:
                    continue
                last_name = full_text

                # Parse name and location quickly from the text
                if " i " in full_text:
                    name = full_text.split(" i ")[0].strip()
                    location = full_text.split(" i ")[1].strip()
                else:
                    name = full_text
                    location = None

                # Search for student email in Daisy using clean name
                email = None
                try:
                    students = daisy_search_student(daisy_cookies, name)
                    if students:
                        email = students[0].get("email", None)
                except Exception as e:
                    print(f"Failed to lookup student email: {e}")

                # Build and send notification immediately (without list info to be fast)
                notification_message = f"Next in queue: {name}"
                if location:
                    notification_message += f"\nLocation: {location}"

                send_notification(pushover_key, pushover_user, notification_message)

                # Print basic info immediately
                print(f"\n{'='*60}")
                print(f"Next in queue: {name}")
                if location:
                    print(f"Location: {location}")
                if email:
                    print(f"Email: {email}")

                # Now fetch list information (slower, doesn't block notification)
                try:
                    list_info = get_list_info_for_student(handledning_cookies, full_text)
                    if list_info:
                        if list_info.get("course"):
                            print(f"Course: {list_info['course']}")
                        if list_info.get("other_teachers"):
                            print(f"Other teachers on list: {', '.join(list_info['other_teachers'])}")
                        if list_info.get("recent_activity"):
                            print(f"Recent activity: {list_info['recent_activity']}")
                        print(f"List ID: {list_info.get('listid')}")
                except Exception as e:
                    print(f"Failed to get list information: {e}")

                print(f"{'='*60}\n")

                time.sleep(5)
                continue

            if any(val in response.text for val in ["Du är på väg till", "Du är hos"]):
                # Busy
                time.sleep(3)
                continue

            print("Unknown state, dumping response")
            print(response.text)
            time.sleep(5)

    except Exception as e:
        print(f"Error occurred: {e}")
        print("Waiting 5 minutes before retry...")
        time.sleep(5 * 60)
