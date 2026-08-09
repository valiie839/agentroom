import { Watch } from "@/components/Watch";

export default async function WatchPage({
  params,
}: PageProps<"/watch/[roomId]">) {
  const { roomId } = await params;
  return <Watch roomId={roomId} />;
}
