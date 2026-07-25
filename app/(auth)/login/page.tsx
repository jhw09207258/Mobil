import "../auth.css";
import { LoginScreen } from "./login-screen";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;

  return <LoginScreen redirectTo={redirect} />;
}
