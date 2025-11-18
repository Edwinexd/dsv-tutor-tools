import os
import time
from typing import Optional, List, Dict
from datetime import datetime, timedelta
import requests
from dotenv import load_dotenv
from login import mobil_handledning_login, activate_all_lists, daisy_staff_login, daisy_search_student, handledning_login, get_list_info_for_student, get_mobile_schedules

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

def is_in_active_session(schedules: List[Dict], buffer_minutes: int = 15) -> bool:
    """
    Check if we're currently in an active tutoring session (with buffer time before/after)

    Args:
        schedules: List of schedule dictionaries with start_time and end_time
        buffer_minutes: Buffer time in minutes before and after each session (default: 15)

    Returns:
        True if we're currently in an active session (or within buffer), False otherwise
    """
    now = datetime.now()
    buffer = timedelta(minutes=buffer_minutes)

    for schedule in schedules:
        start_time = schedule["start_time"]
        end_time = schedule["end_time"]

        # Check if current time is within session (with buffer)
        if start_time - buffer <= now <= end_time + buffer:
            return True

    return False

def get_next_session_time(schedules: List[Dict]) -> Optional[datetime]:
    """
    Get the start time of the next upcoming session

    Args:
        schedules: List of schedule dictionaries with start_time

    Returns:
        Datetime of next session start, or None if no upcoming sessions
    """
    now = datetime.now()
    upcoming_sessions = [s["start_time"] for s in schedules if s["start_time"] > now]

    if upcoming_sessions:
        return min(upcoming_sessions)

    return None

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
        last_schedule_fetch_time = 0.0
        ACTIVATION_INTERVAL = 15 * 60  # 15 minutes in seconds
        SCHEDULE_FETCH_INTERVAL = 15 * 60  # 15 minutes in seconds
        SLOW_POLL_INTERVAL = 15 * 60  # 15 minutes when no active session
        FAST_POLL_INTERVAL = 1  # 1 second when in active session

        # Fetch initial schedule from mobile site
        print("Fetching initial schedule...")
        schedules = []
        try:
            schedules = get_mobile_schedules(cookies_dict)
            print(f"Found {len(schedules)} scheduled sessions")
            if schedules:
                for schedule in schedules[:3]:  # Show first 3
                    print(f"  - {schedule['course']}: {schedule['start_time'].strftime('%Y-%m-%d %H:%M')} - {schedule['end_time'].strftime('%H:%M')}")
                if len(schedules) > 3:
                    print(f"  ... and {len(schedules) - 3} more")
            last_schedule_fetch_time = time.time()
        except Exception as e:
            print(f"Failed to fetch schedule: {e}")

        print("Starting queue monitoring with adaptive polling...")
        last_polling_mode = None  # Track polling mode to avoid duplicate logging

        while True:
            # Check if it's time to refetch schedule
            current_time = time.time()
            if current_time - last_schedule_fetch_time >= SCHEDULE_FETCH_INTERVAL:
                print("Refreshing schedule...")
                try:
                    schedules = get_mobile_schedules(cookies_dict)
                    print(f"Found {len(schedules)} scheduled sessions")
                    last_schedule_fetch_time = current_time
                except Exception as e:
                    print(f"Failed to refresh schedule: {e}")

            # Determine polling interval based on whether we're in an active session
            in_active_session = is_in_active_session(schedules)
            poll_interval = FAST_POLL_INTERVAL if in_active_session else SLOW_POLL_INTERVAL

            # Log status change only when mode changes
            current_mode = "fast" if in_active_session else "slow"
            if current_mode != last_polling_mode:
                if in_active_session:
                    print(f"Entering active session period - switching to fast polling ({FAST_POLL_INTERVAL}s interval)")
                else:
                    next_session = get_next_session_time(schedules)
                    if next_session:
                        print(f"No active session - switching to slow polling ({SLOW_POLL_INTERVAL // 60} min interval). Next session: {next_session.strftime('%Y-%m-%d %H:%M')}")
                    else:
                        print(f"No active session - switching to slow polling ({SLOW_POLL_INTERVAL // 60} min interval). No upcoming sessions today.")
                last_polling_mode = current_mode

            # If not in active session, sleep and skip queue checking
            if not in_active_session:
                time.sleep(poll_interval)
                continue

            time.sleep(FAST_POLL_INTERVAL)

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
