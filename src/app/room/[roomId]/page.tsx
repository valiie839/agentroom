import { RoomGate } from "@/components/RoomGate";

export default async function RoomPage({
  params,
}: PageProps<"/room/[roomId]">) {
  const { roomId } = await params;
  return <RoomGate roomId={roomId} />;
}
