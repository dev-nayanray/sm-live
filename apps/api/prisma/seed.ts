/**
 * Seed: roles + permissions, super_admin, 2 markets, 3-agency tree,
 * 20 funded users, 6 games (2 Pro) with configs, 30 gifts, brand config,
 * a mock game provider + API access key, feature flags, sample rooms.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from "@sm-live/shared";

const prisma = new PrismaClient();

const env = {
  SUPER_ADMIN_USERNAME: process.env.SUPER_ADMIN_USERNAME ?? "superadmin",
  SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD ?? "SuperAdmin123!",
  SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL ?? "admin@sm-live.local",
};

async function main() {
  console.log("seeding…");

  // --- Permissions & roles ---
  const permRows = new Map<string, number>();
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({ where: { key: p }, create: { key: p }, update: {} });
    permRows.set(p, row.id);
  }
  for (const [roleKey, perms] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      create: { key: roleKey, name: roleKey.replace(/_/g, " "), isSystem: true },
      update: {},
    });
    const have = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    const haveKeys = new Set(have.map((h) => h.permissionId));
    for (const p of perms) {
      const pid = permRows.get(p)!;
      if (!haveKeys.has(pid)) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: pid } });
    }
  }

  // --- Super admin ---
  const superRole = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  const superAdmin = await prisma.adminUser.upsert({
    where: { username: env.SUPER_ADMIN_USERNAME },
    create: {
      username: env.SUPER_ADMIN_USERNAME,
      email: env.SUPER_ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(env.SUPER_ADMIN_PASSWORD, 10),
      displayName: "Super Admin",
      roleId: superRole.id,
    },
    update: {},
  });
  console.log(`  super admin: ${superAdmin.username} / ${env.SUPER_ADMIN_PASSWORD}`);

  // a read-only viewer role for the RBAC check
  const viewerRole = await prisma.role.upsert({
    where: { key: "viewer" },
    create: { key: "viewer", name: "Viewer (read-only)", description: "Sees dashboards, no write buttons" },
    update: {},
  });
  await prisma.adminUser.upsert({
    where: { username: "viewer" },
    create: {
      username: "viewer",
      email: "viewer@sm-live.local",
      passwordHash: await bcrypt.hash("Viewer123!", 10),
      displayName: "Read-only Viewer",
      roleId: viewerRole.id,
    },
    update: {},
  });

  // --- Markets + brand ---
  const defaultMarket = await prisma.market.upsert({
    where: { code: "default" },
    create: { code: "default", name: "Global (virtual coins)", realMoneyEnabled: false },
    update: {},
  });
  const bdMarket = await prisma.market.upsert({
    where: { code: "bd" },
    create: { code: "bd", name: "Bangladesh (virtual coins)", realMoneyEnabled: false },
    update: {},
  });
  await prisma.brandConfig.upsert({
    where: { marketId: defaultMarket.id },
    create: {
      marketId: defaultMarket.id,
      appName: "SM Live",
      logoUrl: "",
      primaryColor: "#7c3aed",
      accentColor: "#f43f5e",
      // Prompt 13 default 5-tab navigation: Home, Discover, Live, Messages,
      // Profile. Games is reachable from Home + Discover (not a primary
      // tab). Admins can override via the BrandConfig editor without a
      // release — the bottom-tabs array drives the mobile tab bar.
      bottomTabs: [
        { key: "home", label: "Home", icon: "home", visible: true },
        { key: "discover", label: "Discover", icon: "compass", visible: true },
        { key: "live", label: "Live", icon: "radio", visible: true },
        { key: "messages", label: "Messages", icon: "message", visible: true },
        { key: "me", label: "Profile", icon: "user", visible: true },
      ],
    },
    update: {},
  });
  await prisma.countryFilter.upsert({
    where: { marketId_country: { marketId: bdMarket.id, country: "PK" } },
    create: { marketId: bdMarket.id, country: "PK", blocked: true },
    update: {},
  });

  // --- Feature flags ---
  const flags = [
    { key: "games.enabled", description: "Games tab visible", enabled: true },
    { key: "gifting.enabled", description: "Gift sending enabled", enabled: true },
    { key: "party_rooms.enabled", description: "Party rooms (9 users)", enabled: true },
    { key: "short_video.enabled", description: "Short video feed", enabled: true },
    { key: "pk_battle.enabled", description: "PK battles (stub)", enabled: false },
    { key: "real_money.enabled", description: "Master real-money switch (lawful-market gated)", enabled: false },
  ];
  for (const f of flags) await prisma.featureFlag.upsert({ where: { key: f.key }, create: f, update: { enabled: f.enabled } });

  // --- Settings ---
  const settings = [
    { key: "provider.monthly_service_fee", value: "100", description: "Monthly service fee per provider (coins)" },
    { key: "gift.agency_commission_default", value: "0.10", description: "Default agency commission on gifts" },
    { key: "wallet.min_recharge", value: "10", description: "Minimum recharge in coins" },
  ];
  for (const s of settings) await prisma.setting.upsert({ where: { key: s.key }, create: s, update: {} });

  // --- Game provider + api key ---
  const provider = await prisma.gameProvider.upsert({
    where: { code: "mockcorp" },
    create: {
      name: "MockCorp Games",
      code: "mockcorp",
      apiBase: process.env.PROVIDER_MOCK_BASE ?? "http://localhost:4100",
      apiKey: "mockcorp-key-1",
      apiSecret: "mockcorp-secret-please-rotate",
      commissionPct: 15,
      enabled: true,
    },
    update: {},
  });
  await prisma.apiAccessKey.upsert({
    where: { key: provider.apiKey },
    create: { label: "MockCorp primary", providerId: provider.id, key: provider.apiKey, ipAllowList: "127.0.0.1,::1,172.16.0.0/12,*", enabled: true },
    update: {},
  });

  // --- Games (6 demo, 2 Pro) ---
  const gameDefs = [
    { code: "crash-x", name: "Crash X", isPro: false, thumbnailUrl: "", sortOrder: 1 },
    { code: "dice-duel", name: "Dice Duel", isPro: false, thumbnailUrl: "", sortOrder: 2 },
    { code: "lucky-wheel", name: "Lucky Wheel", isPro: false, thumbnailUrl: "", sortOrder: 3 },
    { code: "mines-pro", name: "Mines Pro", isPro: true, thumbnailUrl: "", sortOrder: 4 },
    { code: "dragon-tower", name: "Dragon Tower", isPro: false, thumbnailUrl: "", sortOrder: 5 },
    { code: "royal-aviator", name: "Royal Aviator", isPro: true, thumbnailUrl: "", sortOrder: 6 },
  ];
  for (const g of gameDefs) {
    const game = await prisma.game.upsert({ where: { code: g.code }, create: { ...g, providerId: provider.id, status: "active" }, update: {} });
    for (const m of [defaultMarket, bdMarket]) {
      const isBd = m.code === "bd";
      await prisma.gameConfig.upsert({
        where: { gameId_marketId: { gameId: game.id, marketId: m.id } },
        create: {
          gameId: game.id, marketId: m.id,
          minBet: isBd ? 2 : 1,
          maxBet: isBd ? 5000 : 10000,
          bettingSeconds: g.isPro ? 20 : 30,
          timeoutSeconds: 120,
          stuckPolicy: "refund",
        },
        update: {},
      });
    }
  }

  // --- Agency tree: root → 2 children ---
  const rootAgency = await prisma.agency.upsert({
    where: { code: "AG-ROOT" },
    create: { name: "Global Agency", code: "AG-ROOT", commissionRate: 0.10 },
    update: {},
  });
  const subA = await prisma.agency.upsert({
    where: { code: "AG-DHAKA" },
    create: { name: "Dhaka Agency", code: "AG-DHAKA", commissionRate: 0.15, parentId: rootAgency.id },
    update: {},
  });
  const subB = await prisma.agency.upsert({
    where: { code: "AG-CHITTAGONG" },
    create: { name: "Chattogram Agency", code: "AG-CHITTAGONG", commissionRate: 0.12, parentId: rootAgency.id },
    update: {},
  });

  // --- 20 users with funded wallets (through the ledger) ---
  const { postLedgerEntries } = await import("../src/services/ledger.service.js");
  const agencies = [rootAgency, subA, subB];
  const users = [] as { id: number }[];
  for (let i = 1; i <= 20; i++) {
    const phone = `+8801700000${String(i).padStart(2, "0")}`;
    const agency = agencies[i % 3]!;
    const user = await prisma.user.upsert({
      where: { phone },
      create: {
        phone,
        email: i <= 10 ? `user${i}@sm-live.local` : null,
        passwordHash: await bcrypt.hash("User123!", 10),
        displayName: `Player ${i}`,
        marketCode: i % 2 === 0 ? "bd" : "default",
        country: "BD",
        vipLevel: i % 5,
        nobleLevel: i % 3,
        agencyId: agency.id,
      },
      update: {},
    });
    await prisma.wallet.upsert({ where: { userId: user.id }, create: { userId: user.id, balance: 0 }, update: {} });
    await prisma.agencyMember.upsert({
      where: { agencyId_userId: { agencyId: agency.id, userId: user.id } },
      create: { agencyId: agency.id, userId: user.id },
      update: {},
    });
    // fund through the ledger — no direct wallet writes
    const fund = 1000 + i * 100;
    await postLedgerEntries([
      { userId: user.id, kind: "recharge", amount: fund, txKey: `seed:fund:${user.id}`, refType: "seed", meta: { seed: true } },
    ]);
    await prisma.recharge.upsert({
      where: { externalId: `seed-recharge-${user.id}` },
      create: { userId: user.id, amount: fund, provider: "fake", externalId: `seed-recharge-${user.id}`, status: "succeeded" },
      update: {},
    });
    users.push({ id: user.id });
  }
  console.log(`  users: player1..player20 / User123! (e.g. +880170000001 / User123!)`);

  // --- 30 gifts ---
  const giftNames = [
    "Rose", "Tulip", "Daisy", "Sunflower", "Heart", "Candy", "Lollipop", "Donut", "Ice Cream", "Coffee",
    "Beer", "Cocktail", "Pizza Slice", "Burger", "Cake", "Teddy Bear", "Ring", "Crown", "Angel Wings", "Butterfly",
    "Fireworks", "Lamp", "Microphone", "Guitar", "Sports Car", "Yacht", "Airplane", "Rocket", "Castle", "Universe",
  ];
  for (let i = 0; i < giftNames.length; i++) {
    const price = (i + 1) * 10;
    await prisma.gift.upsert({
      where: { id: i + 1 },
      create: {
        name: giftNames[i]!,
        price,
        category: price < 100 ? "basic" : price < 500 ? "premium" : "luxury",
        animation: price >= 300 ? "full" : price >= 100 ? "small" : "none",
        sortOrder: i,
      },
      update: {},
    });
  }
  // (upsert-by-id is brittle across reseeds; make gifts idempotent by name too)
  const giftCount = await prisma.gift.count();
  if (giftCount < giftNames.length) {
    for (let i = 0; i < giftNames.length; i++) {
      const exists = await prisma.gift.findFirst({ where: { name: giftNames[i]! } });
      if (!exists) {
        await prisma.gift.create({
          data: {
            name: giftNames[i]!,
            price: (i + 1) * 10,
            category: (i + 1) * 10 < 100 ? "basic" : (i + 1) * 10 < 500 ? "premium" : "luxury",
            animation: (i + 1) * 10 >= 300 ? "full" : (i + 1) * 10 >= 100 ? "small" : "none",
            sortOrder: i,
          },
        });
      }
    }
  }

  // --- Sample rooms + content ---
  const host = users[0]!;
  const existingRooms = await prisma.room.count();
  if (existingRooms === 0) {
    await prisma.room.create({
      data: { title: "Late Night Vibes 🎤", type: "voice", slots: 10, country: "BD", hostId: host.id, livekitRoom: `room_seed_voice_${crypto.randomUUID().slice(0, 8)}` },
    });
    await prisma.room.create({
      data: { title: "PK Battle Arena", type: "live", slots: 3, country: "BD", hostId: users[1]!.id, livekitRoom: `room_seed_live_${crypto.randomUUID().slice(0, 8)}` },
    });
    await prisma.room.create({
      data: { title: "Party House 🎉", type: "party", slots: 9, country: "BD", hostId: users[2]!.id, livekitRoom: `room_seed_party_${crypto.randomUUID().slice(0, 8)}` },
    });
  }
  const videoCount = await prisma.shortVideo.count();
  if (videoCount === 0) {
    for (let i = 0; i < 5; i++) {
      await prisma.shortVideo.create({
        data: { authorId: users[i + 3]!.id, title: `Clip #${i + 1}`, videoUrl: `https://cdn.example.invalid/clip${i + 1}.mp4`, coverUrl: "", likes: 100 * (i + 1), country: "BD" },
      });
      await prisma.moment.create({
        data: { authorId: users[i + 3]!.id, text: `Moment #${i + 1}`, imageUrl: "", likes: 10 * (i + 1), country: "BD" },
      });
    }
  }

  console.log("seed done ✔");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
