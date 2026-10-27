import type { Metadata } from "next";
import LoginPage from "@/components/account/LoginPage";

export const metadata: Metadata = {
  title: "Sign in | College Timetable",
};

export default function Page() {
  return <LoginPage />;
}
