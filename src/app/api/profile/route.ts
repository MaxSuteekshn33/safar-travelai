import { cleanProfile, ProfileSchema } from "@/lib/profile";
import { PrismaStore } from "@/lib/store-prisma";

const store = new PrismaStore();

/** The traveller profile: read it, replace it with an edited version, or delete it all. */
export async function GET() {
  return Response.json({ profile: cleanProfile(await store.getProfile()) });
}

export async function PUT(request: Request) {
  const parsed = ProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That profile could not be saved. Check the field lengths." }, { status: 400 });
  const profile = cleanProfile(parsed.data);
  await store.saveProfile(profile);
  return Response.json({ profile });
}

export async function DELETE() {
  await store.saveProfile({});
  return Response.json({ profile: {} });
}
