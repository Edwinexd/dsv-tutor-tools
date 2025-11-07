import json
import os
from datetime import datetime, timedelta
from typing import Optional


CACHE_FILE = ".cookie_cache.json"
CACHE_DURATION = timedelta(hours=1)  # Cookies expire after 1 hour


def get_cached_cookie(service_name: str) -> Optional[str]:
    """
    Get cached cookie for a service if it exists and hasn't expired

    Args:
        service_name: Name of the service (e.g., "mobil_handledning", "daisy_staff")

    Returns:
        Cached JSESSIONID cookie value or None if not cached or expired
    """
    if not os.path.exists(CACHE_FILE):
        return None

    try:
        with open(CACHE_FILE, "r") as f:
            cache = json.load(f)

        if service_name not in cache:
            return None

        entry = cache[service_name]
        cached_time = datetime.fromisoformat(entry["timestamp"])
        cookie_value = entry["cookie"]

        # Check if expired
        if datetime.now() - cached_time > CACHE_DURATION:
            return None

        return cookie_value

    except (json.JSONDecodeError, KeyError, ValueError):
        return None


def save_cookie_to_cache(service_name: str, cookie_value: str):
    """
    Save cookie to cache file

    Args:
        service_name: Name of the service (e.g., "mobil_handledning", "daisy_staff")
        cookie_value: JSESSIONID cookie value to cache
    """
    cache = {}

    # Load existing cache
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r") as f:
                cache = json.load(f)
        except (json.JSONDecodeError, ValueError):
            pass

    # Update cache
    cache[service_name] = {
        "cookie": cookie_value,
        "timestamp": datetime.now().isoformat()
    }

    # Save cache
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def clear_cache(service_name: Optional[str] = None):
    """
    Clear cached cookies

    Args:
        service_name: Name of service to clear, or None to clear all
    """
    if not os.path.exists(CACHE_FILE):
        return

    if service_name is None:
        # Clear all
        os.remove(CACHE_FILE)
        return

    # Clear specific service
    try:
        with open(CACHE_FILE, "r") as f:
            cache = json.load(f)

        if service_name in cache:
            del cache[service_name]

        with open(CACHE_FILE, "w") as f:
            json.dump(cache, f, indent=2)

    except (json.JSONDecodeError, ValueError, KeyError):
        pass
