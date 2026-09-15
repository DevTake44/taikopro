import UpdatePage from "@/components/UpdatePage";
import { fetchAllDataStatuses } from "@/lib/fetchDataStatus";

export const dynamic = "force-dynamic";

export default async function DxUploadPage() {
  let statuses: Awaited<ReturnType<typeof fetchAllDataStatuses>> = [];
  let statusError: string | null = null;
  try {
    statuses = await fetchAllDataStatuses();
  } catch (e) {
    statusError = e instanceof Error ? e.message : String(e);
  }

  return <UpdatePage statuses={statuses} statusError={statusError} />;
}
