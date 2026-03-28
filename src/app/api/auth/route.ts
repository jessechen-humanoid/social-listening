export async function POST(request: Request) {
  const { password } = await request.json();
  const correct = process.env.SITE_PASSWORD;

  if (!correct) {
    // No password set, allow access
    return Response.json({ success: true });
  }

  if (password === correct) {
    return Response.json({ success: true });
  }

  return Response.json({ success: false, error: '密碼錯誤' }, { status: 401 });
}
