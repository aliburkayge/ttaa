import { redirect } from "next/navigation";
import { getAdminSession } from "../../lib/auth";
import AyTercumeStudio from "./studio";

export default async function AyTercumeWorkspace() {
  const session = await getAdminSession();
  if (!session) redirect("/");

  return <AyTercumeStudio email={session.email} />;
}
