export function checkTimeConflict(newStart, newEnd, existingSessions) {
  if (!existingSessions || existingSessions.length === 0) {
    return null;
  }

  for (const session of existingSessions) {
    const existingStart = session.start_time;
    const existingEnd = session.end_time;

    if (newStart < existingEnd && newEnd > existingStart) {
      return {
        id: session.id,
        start_time: existingStart,
        end_time: existingEnd,
      };
    }
  }

  return null;
}

export function toTimeStr(date) {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function parseTimeStr(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date;
}

export function calculateDuration(startStr, endStr) {
  const start = parseTimeStr(startStr);
  const end = parseTimeStr(endStr);
  let diff = (end - start) / 60000;
  if (diff < 0) diff += 1440;
  return Math.round(diff);
}