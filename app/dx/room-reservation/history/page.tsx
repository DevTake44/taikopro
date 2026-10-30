import RoomReservationLogs from "@/components/RoomReservationLogs";

export const dynamic = "force-dynamic";
export const metadata = { title: "会議室予約 履歴" };

export default function RoomReservationHistoryPage() {
  return <RoomReservationLogs />;
}
