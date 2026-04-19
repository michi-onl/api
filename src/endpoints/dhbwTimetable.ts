import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { cached } from "../cache";
import { DHBW_COURSE_CODE, fetchDhbwCourse } from "../fetchers/dhbw";

const DegreeSchema = z.object({
  id: z.number(),
  abbreviation: z.string(),
  name: z.string(),
  faculty: z.string(),
  sites: z.array(z.string()),
  global: z.boolean(),
});

const CourseSchema = z.object({
  id: z.number(),
  name: z.string(),
  site: z.string(),
  faculty: z.string(),
  year: z.number(),
  courseIdentifier: z.string(),
  specialization: z.string().nullable(),
  verified: z.boolean(),
  public: z.boolean(),
  hidden: z.boolean(),
  degree: DegreeSchema,
});

const LectureEventSchema = z.object({
  entityType: z.string(),
  date: z.string().describe("ISO 8601 date"),
  site: z.string(),
  startTime: z.string().describe("ISO 8601 start time"),
  endTime: z.string().describe("ISO 8601 end time"),
  name: z.string(),
  type: z.string(),
  lecturer: z.string(),
  rooms: z.array(z.string()),
  course: z.string(),
  id: z.number(),
});

const DhbwTimetableResponseSchema = z.object({
  source: z.string(),
  courseCode: z.string(),
  urls: z.object({
    course: z.string(),
    events: z.string(),
  }),
  course: CourseSchema.nullable(),
  eventCount: z.number(),
  events: z.array(LectureEventSchema),
  errors: z.array(z.string()).optional(),
});

export class DhbwTimetable extends OpenAPIRoute {
  schema = {
    tags: ["Knowledge & Education"],
    summary: `DHBW timetable for ${DHBW_COURSE_CODE}`,
    responses: {
      "200": {
        description: "Course metadata and lecture schedule merged into one cached response",
        ...contentJson(DhbwTimetableResponseSchema),
      },
    },
  };

  async handle(c: AppContext) {
    const data = await cached(
      c.env.API_CACHE,
      `dhbw-timetable:${DHBW_COURSE_CODE}:v1`,
      1800,
      () => fetchDhbwCourse(),
      (result) => !result.errors?.length,
    );

    return c.json(data);
  }
}
