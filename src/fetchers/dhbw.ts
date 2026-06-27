const DHBW_API_BASE = "https://api.dhbw.app";

export const DHBW_COURSE_CODE = "HDH-WWI2025B";

interface DhbwCourse {
  id: number;
  name: string;
  site: string;
  faculty: string;
  year: number;
  courseIdentifier: string;
  specialization: string | null;
  verified: boolean;
  public: boolean;
  hidden: boolean;
  degree: {
    id: number;
    abbreviation: string;
    name: string;
    faculty: string;
    sites: string[];
    global: boolean;
  };
}

interface DhbwLectureEvent {
  entityType: string;
  date: string;
  site: string;
  startTime: string;
  endTime: string;
  name: string;
  type: string;
  lecturer: string;
  rooms: string[];
  course: string;
  id: number;
}

interface DhbwCourseResponse {
  source: string;
  courseCode: string;
  urls: {
    course: string;
    events: string;
  };
  course: DhbwCourse | null;
  eventCount: number;
  events: DhbwLectureEvent[];
  errors?: string[];
}

export async function fetchDhbwCourse(
  courseCode = DHBW_COURSE_CODE,
): Promise<DhbwCourseResponse> {
  const courseUrl = `${DHBW_API_BASE}/course/${courseCode}`;
  const eventsUrl = `${DHBW_API_BASE}/rapla/lectures/${courseCode}/events`;

  const [courseResult, eventsResult] = await Promise.allSettled([
    fetchJson<DhbwCourse>(courseUrl),
    fetchJson<DhbwLectureEvent[]>(eventsUrl),
  ]);

  const errors: string[] = [];

  if (courseResult.status === "rejected") {
    errors.push(`Failed to fetch course: ${courseResult.reason}`);
  }

  if (eventsResult.status === "rejected") {
    errors.push(`Failed to fetch events: ${eventsResult.reason}`);
  }

  const events =
    eventsResult.status === "fulfilled"
      ? eventsResult.value
          .map((event) => ({
            ...event,
            name: event.name.trim().replace(/\s+/g, " "),
            lecturer: event.lecturer.trim(),
          }))
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
      : [];

  return {
    source: "DHBW API",
    courseCode,
    urls: {
      course: courseUrl,
      events: eventsUrl,
    },
    course: courseResult.status === "fulfilled" ? courseResult.value : null,
    eventCount: events.length,
    events,
    ...(errors.length ? { errors } : {}),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
