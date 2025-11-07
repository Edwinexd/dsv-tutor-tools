import os
import time
import threading
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import List, Dict
from dotenv import load_dotenv
from login import handledning_login, get_planned_schedules

load_dotenv()

assert "SU_USERNAME" in os.environ, "SU_USERNAME is missing"
assert "SU_PASSWORD" in os.environ, "SU_PASSWORD is missing"

su_username = os.environ["SU_USERNAME"]
su_password = os.environ["SU_PASSWORD"]

# Global variable to store the latest ICS content
latest_ics_content = ""
last_update_time = None


def generate_ics(schedules: List[Dict]) -> str:
    """
    Generate an ICS calendar file from scheduled sessions

    Args:
        schedules: List of schedule dictionaries with start_time, end_time, course, etc.

    Returns:
        ICS formatted string
    """
    lines = []

    # ICS header
    lines.append("BEGIN:VCALENDAR")
    lines.append("VERSION:2.0")
    lines.append("PRODID:-//DSV Tutor Calendar//EN")
    lines.append("CALSCALE:GREGORIAN")
    lines.append("METHOD:PUBLISH")
    lines.append("X-WR-CALNAME:DSV Tutoring Schedule")
    lines.append("X-WR-TIMEZONE:Europe/Stockholm")
    lines.append("X-WR-CALDESC:Automatically generated tutoring schedule from DSV handledning system")

    # Add timezone definition for Europe/Stockholm
    lines.append("BEGIN:VTIMEZONE")
    lines.append("TZID:Europe/Stockholm")
    lines.append("BEGIN:STANDARD")
    lines.append("DTSTART:19701025T030000")
    lines.append("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU")
    lines.append("TZOFFSETFROM:+0200")
    lines.append("TZOFFSETTO:+0100")
    lines.append("END:STANDARD")
    lines.append("BEGIN:DAYLIGHT")
    lines.append("DTSTART:19700329T020000")
    lines.append("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU")
    lines.append("TZOFFSETFROM:+0100")
    lines.append("TZOFFSETTO:+0200")
    lines.append("END:DAYLIGHT")
    lines.append("END:VTIMEZONE")

    # Add events
    for schedule in schedules:
        start_time = schedule["start_time"]
        end_time = schedule["end_time"]
        course = schedule.get("course", "Tutoring Session")
        location = schedule.get("location", "")
        list_id = schedule.get("list_id", "")

        # Generate unique ID
        uid = f"{start_time.strftime('%Y%m%dT%H%M%S')}-{list_id}@dsv.su.se"

        # Format timestamps for ICS (YYYYMMDDTHHMMSS)
        dtstart = start_time.strftime("%Y%m%dT%H%M%S")
        dtend = end_time.strftime("%Y%m%dT%H%M%S")
        dtstamp = datetime.now().strftime("%Y%m%dT%H%M%SZ")

        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{uid}")
        lines.append(f"DTSTAMP:{dtstamp}")
        lines.append(f"DTSTART;TZID=Europe/Stockholm:{dtstart}")
        lines.append(f"DTEND;TZID=Europe/Stockholm:{dtend}")
        lines.append(f"SUMMARY:{course}")
        if location:
            lines.append(f"LOCATION:{location}")
        if list_id:
            lines.append(f"DESCRIPTION:List ID: {list_id}")
            lines.append(f"URL:https://handledning.dsv.su.se/servlet/teacher/GetListServlet?listid={list_id}")
        lines.append("STATUS:CONFIRMED")
        lines.append("TRANSP:OPAQUE")
        lines.append("END:VEVENT")

    # ICS footer
    lines.append("END:VCALENDAR")

    return "\r\n".join(lines)


def update_calendar():
    """Periodically fetch and update the calendar"""
    global latest_ics_content, last_update_time

    while True:
        try:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Updating calendar...")

            # Login to handledning
            handledning_jsessionid = handledning_login(su_username, su_password)
            handledning_cookies = {"JSESSIONID": handledning_jsessionid}

            # Fetch schedules
            schedules = get_planned_schedules(handledning_cookies)
            print(f"Found {len(schedules)} scheduled sessions")

            # Generate ICS
            latest_ics_content = generate_ics(schedules)
            last_update_time = datetime.now()

            print(f"Calendar updated successfully at {last_update_time.strftime('%Y-%m-%d %H:%M:%S')}")

        except Exception as e:
            print(f"Error updating calendar: {e}")

        # Update every 15 minutes
        time.sleep(15 * 60)


class CalendarHandler(BaseHTTPRequestHandler):
    """HTTP request handler for serving the ICS feed"""

    def do_GET(self):
        if self.path == "/calendar.ics" or self.path == "/":
            # Serve the ICS file
            self.send_response(200)
            self.send_header("Content-Type", "text/calendar; charset=utf-8")
            self.send_header("Content-Disposition", "inline; filename=dsv-tutoring.ics")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()

            self.wfile.write(latest_ics_content.encode("utf-8"))

        elif self.path == "/status":
            # Status page
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()

            status_html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>DSV Tutoring Calendar Status</title>
                <meta charset="utf-8">
            </head>
            <body>
                <h1>DSV Tutoring Calendar Feed</h1>
                <p>Last updated: {last_update_time.strftime('%Y-%m-%d %H:%M:%S') if last_update_time else 'Never'}</p>
                <p><a href="/calendar.ics">Download Calendar (calendar.ics)</a></p>
                <p>Subscribe URL: <code>http://localhost:8080/calendar.ics</code></p>
            </body>
            </html>
            """

            self.wfile.write(status_html.encode("utf-8"))

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        """Override to customize logging"""
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {format % args}")


def main():
    """Main entry point"""
    port = int(os.environ.get("CALENDAR_PORT", "8080"))

    print("Starting DSV Tutoring Calendar Server...")
    print(f"Server will run on http://localhost:{port}")
    print(f"Calendar feed: http://localhost:{port}/calendar.ics")
    print(f"Status page: http://localhost:{port}/status")

    # Start the calendar update thread
    update_thread = threading.Thread(target=update_calendar, daemon=True)
    update_thread.start()

    # Give the update thread a moment to fetch initial data
    print("Fetching initial calendar data...")
    time.sleep(2)

    # Start the HTTP server
    server = HTTPServer(("", port), CalendarHandler)
    print(f"Server started on port {port}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.shutdown()


if __name__ == "__main__":
    main()
