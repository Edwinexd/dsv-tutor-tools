export function generateICS(schedules) {
  const lines = [];

  // ICS header
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//DSV Tutor Calendar//EN');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push('X-WR-CALNAME:DSV Tutoring Schedule');
  lines.push('X-WR-TIMEZONE:Europe/Stockholm');
  lines.push('X-WR-CALDESC:Automatically generated tutoring schedule from DSV handledning system');

  // Add timezone definition for Europe/Stockholm
  lines.push('BEGIN:VTIMEZONE');
  lines.push('TZID:Europe/Stockholm');
  lines.push('BEGIN:STANDARD');
  lines.push('DTSTART:19701025T030000');
  lines.push('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU');
  lines.push('TZOFFSETFROM:+0200');
  lines.push('TZOFFSETTO:+0100');
  lines.push('END:STANDARD');
  lines.push('BEGIN:DAYLIGHT');
  lines.push('DTSTART:19700329T020000');
  lines.push('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU');
  lines.push('TZOFFSETFROM:+0100');
  lines.push('TZOFFSETTO:+0200');
  lines.push('END:DAYLIGHT');
  lines.push('END:VTIMEZONE');

  // Add events
  for (const schedule of schedules) {
    const startTime = schedule.start_time;
    const endTime = schedule.end_time;
    const course = schedule.course || 'Tutoring Session';
    const location = schedule.location || '';
    const listId = schedule.list_id || '';

    // Generate unique ID
    const uid = `${formatDateTime(startTime)}-${listId}@dsv.su.se`;

    // Format timestamps
    const dtstart = formatDateTime(startTime);
    const dtend = formatDateTime(endTime);
    const dtstamp = formatDateTime(new Date()) + 'Z';

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=Europe/Stockholm:${dtstart}`);
    lines.push(`DTEND;TZID=Europe/Stockholm:${dtend}`);
    lines.push(`SUMMARY:${course}`);

    if (location) {
      lines.push(`LOCATION:${location}`);
    }

    if (listId) {
      lines.push(`DESCRIPTION:List ID: ${listId}`);
      lines.push(`URL:https://handledning.dsv.su.se/servlet/teacher/GetListServlet?listid=${listId}`);
    }

    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }

  // ICS footer
  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

function formatDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}T${hour}${minute}${second}`;
}
