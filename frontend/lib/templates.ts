import type { CollegeData, RoomType, Settings } from "./types";

export const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const MON_SAT = WEEK_DAYS.slice(0, 6);

function emptyCollege(settings: Settings, roomTypes: RoomType[]): CollegeData {
  return {
    name: "",
    settings,
    room_types: roomTypes,
    departments: [],
    sections: [],
    subjects: [],
    teachers: [],
    assignments: [],
    rooms: [],
  };
}

export interface StartTemplate {
  id: string;
  title: string;
  description: string;
  build: () => CollegeData;
}

export const START_TEMPLATES: StartTemplate[] = [
  {
    id: "engineering",
    title: "Engineering college",
    description:
      "Mon–Sat, 8 periods of 50 minutes, tea break after period 2, lunch after period 4. Computer labs and other labs.",
    build: () =>
      emptyCollege(
        {
          days: MON_SAT,
          periods_per_day: 8,
          day_start: "09:00",
          period_minutes: 50,
          period_lengths: null,
          breaks: [
            { name: "Tea break", after_period: 2, minutes: 10, labs_continue: true },
            { name: "Lunch", after_period: 4, minutes: 40, labs_continue: false },
          ],
        },
        [
          { id: "classroom", name: "Classroom", use: "lecture" },
          { id: "computer_lab", name: "Computer lab", use: "lab" },
          { id: "lab", name: "Engineering lab", use: "lab" },
          { id: "seminar_hall", name: "Seminar hall", use: "event" },
          { id: "auditorium", name: "Auditorium", use: "event" },
        ],
      ),
  },
  {
    id: "arts-science",
    title: "Arts & Science college",
    description:
      "Mon–Sat, 6 periods of 55 minutes, lunch after period 3. Science labs, a computer lab and a seminar hall.",
    build: () =>
      emptyCollege(
        {
          days: MON_SAT,
          periods_per_day: 6,
          day_start: "09:30",
          period_minutes: 55,
          period_lengths: null,
          breaks: [{ name: "Lunch", after_period: 3, minutes: 45, labs_continue: false }],
        },
        [
          { id: "classroom", name: "Classroom", use: "lecture" },
          { id: "science_lab", name: "Science lab", use: "lab" },
          { id: "computer_lab", name: "Computer lab", use: "lab" },
          { id: "seminar_hall", name: "Seminar hall", use: "event" },
          { id: "auditorium", name: "Auditorium", use: "event" },
        ],
      ),
  },
  {
    id: "scratch",
    title: "Start from scratch",
    description:
      "Mon–Sat, 8 periods, lunch after period 4, and the basic room types. Change anything.",
    build: () =>
      emptyCollege(
        {
          days: MON_SAT,
          periods_per_day: 8,
          day_start: "09:00",
          period_minutes: 50,
          period_lengths: null,
          breaks: [{ name: "Lunch", after_period: 4, minutes: 40, labs_continue: false }],
        },
        [
          { id: "classroom", name: "Classroom", use: "lecture" },
          { id: "lab", name: "Lab", use: "lab" },
          { id: "seminar_hall", name: "Seminar hall", use: "event" },
          { id: "auditorium", name: "Auditorium", use: "event" },
        ],
      ),
  },
];
